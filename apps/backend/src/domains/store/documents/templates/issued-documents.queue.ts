import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WorkflowDefinitionV1, findStage } from '@common/workflows/contract';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DossiersService } from '../dossiers.service';
import { StoredFilesService } from '../stored-files.service';
import { snapshotScope } from './issued-snapshot';
import { TemplateRenderService } from './template-render.service';
import { MissingTokenError, TokenSyntaxError, TokenValueError } from './template-tokens';

/** Render attempts before the document is marked `failed`. */
export const MAX_RENDER_ATTEMPTS = 3;
/** A `rendering` row untouched this long is picked up by the sweep. */
const STALE_SECONDS = 60;
const SWEEP_BATCH = 20;

export type RenderOutcome = 'issued' | 'failed' | 'retry' | 'skipped';

export interface QueuedDocument {
  id: number;
  store_id: number;
  organization_id: number;
}

/**
 * Render queue of issued documents (P4.1). The `rendering` rows of
 * `issued_documents` ARE the queue: durable, claimed by a compare-and-swap on
 * `render_attempts`, retried by the sweep (worker cron, once a minute) up to
 * {@link MAX_RENDER_ATTEMPTS} times and then `failed` with a readable reason
 * and a timeline event. `kick` renders right after the emission so the person
 * does not wait for the next sweep. Same claim rule for both, so a row is
 * never rendered twice at once.
 */
@Injectable()
export class IssuedDocumentsRenderQueue {
  private readonly logger = new Logger(IssuedDocumentsRenderQueue.name);
  private sweeping = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly renderer: TemplateRenderService,
    private readonly files: StoredFilesService,
    private readonly dossiers: DossiersService,
  ) {}

  /** Renders soon, outside the caller's request. Never throws. */
  kick(doc: QueuedDocument): void {
    setImmediate(() => {
      void this.inStore(doc, () => this.renderById(doc.id)).catch((e) =>
        this.logger.error(`Render kick of document ${doc.id} failed: ${(e as Error)?.message}`),
      );
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const cutoff = new Date(Date.now() - STALE_SECONDS * 1000);
      const rows = await this.prisma.withoutScope().issued_documents.findMany({
        where: { status: 'rendering', updated_at: { lte: cutoff } },
        orderBy: { id: 'asc' },
        take: SWEEP_BATCH,
        select: { id: true, store_id: true, organization_id: true },
      });
      for (const row of rows) {
        try {
          await this.inStore(row, () => this.renderById(row.id));
        } catch (e) {
          this.logger.error(`Render sweep of document ${row.id} failed: ${(e as Error)?.message}`);
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  private inStore<T>(doc: QueuedDocument, fn: () => Promise<T>): Promise<T> {
    return RequestContextService.runIsolated(
      { store_id: doc.store_id, organization_id: doc.organization_id, is_super_admin: false, is_owner: false },
      fn,
    );
  }

  /** One render attempt of a document of the current store. */
  async renderById(id: number): Promise<RenderOutcome> {
    const storeId = RequestContextService.getStoreId() as number;
    const doc = await this.prisma.issued_documents.findFirst({
      where: { id, store_id: storeId },
      include: { template_version: true },
    });
    if (!doc || doc.status !== 'rendering') return 'skipped';
    // Every attempt was claimed and none finished (the worker died mid-render):
    // stop retrying instead of rendering forever.
    if (doc.render_attempts >= MAX_RENDER_ATTEMPTS) {
      await this.markFailed(doc, `No se pudo generar el PDF de '${doc.title}'. Reemítelo para intentarlo de nuevo.`);
      return 'failed';
    }
    const claimed = await this.prisma.issued_documents.updateMany({
      where: { id, store_id: storeId, status: 'rendering', render_attempts: doc.render_attempts },
      data: { render_attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return 'skipped';
    const attempt = doc.render_attempts + 1;

    try {
      const pdf = await this.renderer.render({
        kind: doc.template_version.kind,
        body: doc.template_version.body,
        base_file_id: doc.template_version.base_file_id,
        scope: snapshotScope(doc.data_snapshot),
        title: `${doc.reference} ${doc.title}`,
      });
      const file = await this.files.upload({
        buffer: pdf,
        mimeType: 'application/pdf',
        originalName: `${doc.reference} ${doc.title}.pdf`,
        folder: 'documents/issued',
        source: 'generated',
        actor: { type: 'system', id: null },
      });
      try {
        const done = await this.prisma.$transaction((tx: any) => this.finish(tx, doc, file));
        if (!done) await this.files.discardObject(file.s3_key);
        return done ? 'issued' : 'skipped';
      } catch (e) {
        await this.files.discardObject(file.s3_key);
        throw e;
      }
    } catch (e) {
      const permanent = isPermanent(e);
      if (!permanent && attempt < MAX_RENDER_ATTEMPTS) {
        this.logger.warn(`Document ${doc.reference} render attempt ${attempt} failed: ${(e as Error)?.message}`);
        return 'retry';
      }
      this.logger.error(`Document ${doc.reference} failed: ${(e as Error)?.message}`);
      await this.markFailed(doc, readableError(e, doc.title));
      return 'failed';
    }
  }

  /** Marks issued, files it in the dossier, wakes an automatic stage. False when it was voided meanwhile. */
  private async finish(
    tx: any,
    doc: {
      id: number;
      store_id: number;
      reference: string;
      requirement_key: string | null;
      stage_key: string | null;
      dossier_id: number | null;
      workflow_instance_id: number | null;
      supersedes_id: number | null;
    },
    file: { id: number; sha256: string },
  ): Promise<boolean> {
    const done = await tx.issued_documents.updateMany({
      where: { id: doc.id, store_id: doc.store_id, status: 'rendering' },
      data: { status: 'issued', file_id: file.id, pdf_sha256: file.sha256, issued_at: new Date(), error: null },
    });
    if (done.count === 0) return false;
    if (doc.supersedes_id) {
      await tx.issued_documents.updateMany({
        where: { id: doc.supersedes_id, store_id: doc.store_id, status: { in: ['issued', 'failed', 'signed'] } },
        data: { status: 'superseded' },
      });
    }
    if (doc.dossier_id) {
      await this.dossiers.addDocumentItem(tx, {
        dossier_id: doc.dossier_id,
        kind: 'issued_document',
        issued_document_id: doc.id,
        file_id: file.id,
        stage_key: doc.stage_key,
        requirement_key: doc.requirement_key,
        actor: { type: 'system', id: null },
      });
    }
    if (doc.workflow_instance_id) {
      await this.appendEvent(tx, doc.store_id, doc.workflow_instance_id, 'document_issued', {
        issued_document_id: doc.id,
        reference: doc.reference,
        requirement_key: doc.requirement_key,
      });
      await this.wakeAutomaticStage(tx, doc);
    }
    return true;
  }

  private async markFailed(
    doc: { id: number; store_id: number; reference: string; requirement_key: string | null; workflow_instance_id: number | null },
    message: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      const done = await tx.issued_documents.updateMany({
        where: { id: doc.id, store_id: doc.store_id, status: 'rendering' },
        data: { status: 'failed', error: message.slice(0, 500) },
      });
      if (done.count === 0 || !doc.workflow_instance_id) return;
      await this.appendEvent(tx, doc.store_id, doc.workflow_instance_id, 'document_failed', {
        issued_document_id: doc.id,
        reference: doc.reference,
        requirement_key: doc.requirement_key,
        error: message.slice(0, 500),
      });
    });
  }

  /**
   * Timeline entry of the request (actor `system`). Same `seq = last + 1`
   * rule as the engine; the instance row is touched first so writers of one
   * request queue up.
   */
  async appendEvent(
    tx: any,
    storeId: number,
    instanceId: number,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.workflow_instances.updateMany({
      where: { id: instanceId, store_id: storeId },
      data: { updated_at: new Date() },
    });
    const instance = await tx.workflow_instances.findFirst({
      where: { id: instanceId, store_id: storeId },
      select: { current_stage_key: true },
    });
    if (!instance) return;
    const last = await tx.workflow_instance_events.findFirst({
      where: { store_id: storeId, instance_id: instanceId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    await tx.workflow_instance_events.create({
      data: {
        store_id: storeId,
        instance_id: instanceId,
        seq: (last?.seq ?? 0) + 1,
        type,
        from_stage_key: instance.current_stage_key,
        to_stage_key: instance.current_stage_key,
        actor_type: 'system',
        actor_id: null,
        payload,
      },
    });
  }

  /**
   * An automatic stage waits (tick) while its documents are pending: queue the
   * `advance` row now that one is ready. A different stage or a closed request
   * needs nothing.
   */
  private async wakeAutomaticStage(
    tx: any,
    doc: { store_id: number; stage_key: string | null; workflow_instance_id: number | null },
  ): Promise<void> {
    if (!doc.workflow_instance_id) return;
    const instance = await tx.workflow_instances.findFirst({
      where: { id: doc.workflow_instance_id, store_id: doc.store_id },
      select: { id: true, status: true, current_stage_key: true, stage_entry_seq: true, version_id: true },
    });
    if (!instance || instance.status !== 'active' || instance.current_stage_key !== doc.stage_key) return;
    const version = await tx.workflow_versions.findFirst({
      where: { id: instance.version_id, store_id: doc.store_id },
      select: { definition: true },
    });
    const stage = version
      ? findStage(version.definition as WorkflowDefinitionV1, instance.current_stage_key)
      : undefined;
    if (stage?.type !== 'automatic') return;
    await tx.workflow_outbox.create({
      data: {
        store_id: doc.store_id,
        instance_id: instance.id,
        kind: 'advance',
        payload: { instance_id: instance.id, stage_key: stage.key, stage_entry_seq: instance.stage_entry_seq },
        status: 'pending',
        available_at: new Date(),
      },
    });
  }
}

/** Input rules fail the same way again: no retries. */
function isPermanent(e: unknown): boolean {
  if (e instanceof MissingTokenError || e instanceof TokenValueError || e instanceof TokenSyntaxError) return true;
  if (e instanceof VendixHttpException) return e.getStatus() < 500;
  return false;
}

function readableError(e: unknown, title: string): string {
  if (e instanceof MissingTokenError) return `Falta el dato '${e.path}' para emitir '${title}'`;
  if (e instanceof TokenValueError) return `El dato '${e.path}' no es válido para emitir '${title}': ${e.detail}`;
  if (e instanceof TokenSyntaxError) return `La plantilla de '${title}' tiene una variable inválida: ${e.message}`;
  if (e instanceof VendixHttpException) {
    const body = e.getResponse() as { message?: string };
    return body.message || ErrorCodes.DOCTPL_INVALID.devMessage;
  }
  return 'No se pudo generar el PDF del documento después de varios intentos. Vuelve a emitirlo; si sigue fallando, avisa a soporte.';
}
