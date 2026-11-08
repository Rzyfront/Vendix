import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { S3PathHelper } from '../../../../common/helpers/s3-path.helper';
import { S3Service } from '../../../../common/services/s3.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { WorkflowAuditService } from '../audit/workflow-audit.service';
import type { WorkflowTx } from '../engine/workflow-engine.types';
import { WorkflowExportBuilder } from './workflow-export.builder';
import { S3MultipartWritable } from './s3-multipart-writable';
import { ZipWriter } from './zip-archive';

export const EXPORT_LIST_LIMIT = 20;
export const EXPORT_LIFETIME_DAYS = 7;
/** A `running` export older than this lost its process; it is marked failed. */
export const EXPORT_STALE_HOURS = 2;
export const EXPORT_DOWNLOAD_SECONDS = 300;
export const EXPORT_READY_TITLE = 'Tu exportación de Flujos está lista';
export const EXPORT_FAILED_MESSAGE = 'No se pudo generar la exportación. Intenta de nuevo.';
export const EXPORT_INTERRUPTED_MESSAGE = 'La exportación se interrumpió. Solicita una nueva.';
/** Namespace of the per-store advisory lock that makes "one export at a time" atomic. */
export const WORKFLOW_EXPORT_LOCK_NAMESPACE = 7208;

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_BATCH = 50;

export type WorkflowExportStatus = 'pending' | 'running' | 'ready' | 'failed' | 'expired';

interface ExportRow {
  id: number;
  store_id: number;
  requested_by_user_id: number | null;
  status: string;
  s3_key: string | null;
  size_bytes: bigint | number | null;
  file_count: number;
  counts: unknown;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  expires_at: Date | null;
}

/** What the screen sees; never the storage key. */
export interface WorkflowExportDto {
  id: number;
  status: WorkflowExportStatus;
  size_bytes: number | null;
  file_count: number;
  counts: Record<string, number>;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
}

export interface WorkflowExportDownload {
  url: string;
  file_name: string;
  expires_in: number;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Full Flows export per store (flujos-adm P7.6): the request, the list, the
 * audited signed download, the background build into S3 and the expiry.
 */
@Injectable()
export class WorkflowExportService {
  private readonly logger = new Logger(WorkflowExportService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3: S3Service,
    private readonly paths: S3PathHelper,
    private readonly audit: WorkflowAuditService,
    private readonly notifications: NotificationsService,
    private readonly builder: WorkflowExportBuilder,
  ) {}

  private storeId(): number {
    const id = RequestContextService.getStoreId();
    if (!id) throw new VendixHttpException(ErrorCodes.WORKFLOW_EXPORT_NOT_FOUND);
    return id;
  }

  private toDto(row: ExportRow, now = new Date()): WorkflowExportDto {
    const lapsed = row.status === 'ready' && row.expires_at !== null && row.expires_at.getTime() <= now.getTime();
    return {
      id: row.id,
      status: (lapsed ? 'expired' : row.status) as WorkflowExportStatus,
      size_bytes: row.size_bytes === null ? null : Number(row.size_bytes),
      file_count: row.file_count,
      counts: (row.counts ?? {}) as Record<string, number>,
      error: row.error,
      created_at: row.created_at.toISOString(),
      started_at: iso(row.started_at),
      completed_at: iso(row.completed_at),
      expires_at: iso(row.expires_at),
    };
  }

  /** Queues an export; one per store at a time (409 while another is pending or running). */
  async request(): Promise<WorkflowExportDto> {
    const storeId = this.storeId();
    const userId = RequestContextService.getUserId() ?? null;
    const row: ExportRow = await this.prisma.$transaction(async (tx: WorkflowTx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WORKFLOW_EXPORT_LOCK_NAMESPACE}::int, ${storeId}::int)`;
      const open = await tx.workflow_exports.count({
        where: { store_id: storeId, status: { in: ['pending', 'running'] } },
      });
      if (open > 0) throw new VendixHttpException(ErrorCodes.WORKFLOW_EXPORT_IN_PROGRESS);
      const created: ExportRow = await tx.workflow_exports.create({
        data: { store_id: storeId, requested_by_user_id: userId, status: 'pending' },
      });
      await this.audit.append(tx, {
        action: 'export.requested',
        target_type: 'export',
        target_id: created.id,
        summary: 'Solicitó la exportación completa de Flujos',
        details: { export_id: created.id },
      });
      return created;
    });
    return this.toDto(row);
  }

  /** The latest exports of the store, newest first. */
  async list(): Promise<WorkflowExportDto[]> {
    const rows: ExportRow[] = await this.prisma.workflow_exports.findMany({
      where: { store_id: this.storeId() },
      orderBy: { id: 'desc' },
      take: EXPORT_LIST_LIMIT,
    });
    const now = new Date();
    return rows.map((row) => this.toDto(row, now));
  }

  /**
   * Signed URL of a ready export. The access is audited BEFORE the URL exists
   * (fail-closed): when the audit row cannot be written nothing is signed.
   */
  async download(id: number): Promise<WorkflowExportDownload> {
    const storeId = this.storeId();
    const row: ExportRow | null = await this.prisma.workflow_exports.findFirst({
      where: { id, store_id: storeId },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.WORKFLOW_EXPORT_NOT_FOUND);
    const dto = this.toDto(row);
    if (dto.status === 'expired') throw new VendixHttpException(ErrorCodes.WORKFLOW_EXPORT_EXPIRED);
    if (dto.status !== 'ready' || !row.s3_key) throw new VendixHttpException(ErrorCodes.WORKFLOW_EXPORT_NOT_READY);

    await this.audit.recordNow({
      action: 'export.downloaded',
      target_type: 'export',
      target_id: row.id,
      summary: 'Descargó la exportación completa de Flujos',
      details: { export_id: row.id, size_bytes: dto.size_bytes, file_count: row.file_count },
    });
    const fileName = `flujos-exportacion-${row.id}.zip`;
    const url = await this.s3.getPresignedUrl(row.s3_key, EXPORT_DOWNLOAD_SECONDS, { downloadName: fileName });
    return { url, file_name: fileName, expires_in: EXPORT_DOWNLOAD_SECONDS };
  }

  /**
   * Claims the oldest pending export (pending -> running, atomic) and builds
   * it. Returns whether one was processed. Never throws: a failed build ends
   * as a `failed` row.
   */
  async processNext(): Promise<boolean> {
    const db = this.prisma.withoutScope();
    const next: { id: number } | null = await db.workflow_exports.findFirst({
      where: { status: 'pending' },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (!next) return false;
    const claimed: { count: number } = await db.workflow_exports.updateMany({
      where: { id: next.id, status: 'pending' },
      data: { status: 'running', started_at: new Date() },
    });
    if (claimed.count !== 1) return true;
    const row: ExportRow | null = await db.workflow_exports.findFirst({ where: { id: next.id } });
    if (!row) return true;
    await this.run(row);
    return true;
  }

  private async run(row: ExportRow): Promise<void> {
    const db = this.prisma.withoutScope();
    const store: { id: number; name: string; slug: string; organization_id: number } | null =
      await db.stores.findFirst({
        where: { id: row.store_id },
        select: { id: true, name: true, slug: true, organization_id: true },
      });
    const organization: { id: number; slug: string } | null = store
      ? await db.organizations.findFirst({ where: { id: store.organization_id }, select: { id: true, slug: true } })
      : null;
    if (!store || !organization) {
      await this.fail(row, new Error('store or organization not found'));
      return;
    }

    const generatedAt = new Date();
    const key = `${this.paths.buildStorePath(organization, store)}/workflow-exports/export-${row.id}-${randomUUID()}.zip`;
    const sink = new S3MultipartWritable(this.s3, key, 'application/zip');
    const zip = new ZipWriter(sink);
    try {
      const outcome = await RequestContextService.runIsolated(
        {
          store_id: store.id,
          organization_id: store.organization_id,
          user_id: row.requested_by_user_id ?? undefined,
          is_super_admin: false,
          is_owner: false,
        },
        async () => {
          const built = await this.builder.build(
            { exportId: row.id, storeId: store.id, storeName: store.name, generatedAt },
            zip,
          );
          await zip.finalize();
          const completedAt = new Date();
          await this.prisma.workflow_exports.updateMany({
            where: { id: row.id, store_id: store.id, status: 'running' },
            data: {
              status: 'ready',
              s3_key: key,
              size_bytes: BigInt(sink.total),
              file_count: built.fileCount,
              counts: built.counts,
              error: null,
              completed_at: completedAt,
              expires_at: new Date(completedAt.getTime() + EXPORT_LIFETIME_DAYS * DAY_MS),
            },
          });
          return built;
        },
      );
      this.logger.log(`Workflow export ${row.id} ready (${sink.total} bytes, ${outcome.fileCount} files)`);
      await this.notifyReady(row, store.id);
    } catch (e) {
      zip.abort();
      sink.destroy();
      if (sink.isCompleted) await this.s3.deleteFile(key).catch(() => undefined);
      await this.fail(row, e);
    }
  }

  private async fail(row: ExportRow, error: unknown): Promise<void> {
    this.logger.error(`Workflow export ${row.id} of store ${row.store_id} failed: ${(error as Error)?.message}`);
    await this.prisma.withoutScope().workflow_exports.updateMany({
      where: { id: row.id, store_id: row.store_id, status: 'running' },
      data: { status: 'failed', error: EXPORT_FAILED_MESSAGE, completed_at: new Date() },
    });
  }

  private async notifyReady(row: ExportRow, storeId: number): Promise<void> {
    const body = 'Ya puedes descargar el ZIP desde Flujos → Exportación. Estará disponible 7 días.';
    const data = { kind: 'workflow_export', export_id: row.id, url: '/admin/workflows/exports' };
    try {
      if (row.requested_by_user_id) {
        await this.notifications.sendToUser(
          storeId,
          row.requested_by_user_id,
          'workflow_task',
          EXPORT_READY_TITLE,
          body,
          data,
        );
      } else {
        await this.notifications.createAndBroadcast(storeId, 'workflow_task', EXPORT_READY_TITLE, body, data);
      }
    } catch (e) {
      this.logger.warn(`Workflow export ${row.id} notification failed: ${(e as Error)?.message}`);
    }
  }

  /** `running` exports whose process died: failed, so the store can ask again. */
  async failStale(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - EXPORT_STALE_HOURS * 60 * 60 * 1000);
    const res: { count: number } = await this.prisma.withoutScope().workflow_exports.updateMany({
      where: { status: 'running', started_at: { lt: cutoff } },
      data: { status: 'failed', error: EXPORT_INTERRUPTED_MESSAGE, completed_at: now },
    });
    return res.count;
  }

  /**
   * Ready exports past `expires_at`: the object is deleted from S3 and the row
   * becomes `expired`. A failed delete leaves the row `ready` for the next run.
   */
  async expireDue(now: Date): Promise<number> {
    const db = this.prisma.withoutScope();
    const due: ExportRow[] = await db.workflow_exports.findMany({
      where: { status: 'ready', expires_at: { lte: now } },
      orderBy: { id: 'asc' },
      take: EXPIRY_BATCH,
    });
    let expired = 0;
    for (const row of due) {
      try {
        if (row.s3_key) await this.s3.deleteFile(row.s3_key);
        await db.workflow_exports.updateMany({
          where: { id: row.id, store_id: row.store_id, status: 'ready' },
          data: { status: 'expired', s3_key: null },
        });
        expired += 1;
      } catch (e) {
        this.logger.warn(`Workflow export ${row.id} could not be expired: ${(e as Error)?.message}`);
      }
    }
    return expired;
  }
}
