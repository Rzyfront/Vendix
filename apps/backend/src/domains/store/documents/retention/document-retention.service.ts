import type { document_purge_items, document_purge_runs } from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { S3Service } from '@common/services/s3.service';
import { AuditAction, AuditService } from '@common/audit/audit.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  CreateRetentionPolicyDto,
  UpdateRetentionPolicyDto,
} from './document-retention.dto';

const DAY_MS = 86_400_000;
/** A run older than this that never finished no longer blocks a new one. */
const STALE_RUN_MS = 60 * 60 * 1000;
const CHUNK = 1000;

export interface RetentionPolicyRow {
  id: number;
  key: string;
  name: string;
  subject_type: string | null;
  doc_type: string | null;
  retain_days: number;
  is_active: boolean;
}

export interface PurgeCandidate {
  file_id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  s3_key: string;
  dossier_id: number;
  dossier_reference: string;
  subject_type: string | null;
  closed_at: Date;
  policy_id: number;
  policy_name: string;
  retain_days: number;
  /** `closed_at + retain_days`. */
  due_at: Date;
  legal_hold: boolean;
  reason: string;
}

export type PurgeTrigger = 'schedule' | 'manual';

const chunks = <T>(list: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
};

export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'politica';
}

const sameText = (a: string | null, b: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

const outranks = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/**
 * Most specific applicable policy: subject+type beats one of the two, which
 * beats none. Ties prefer the file-type match, then the longest retention (the
 * conservative one), then the oldest policy.
 */
export function pickPolicy(
  policies: RetentionPolicyRow[],
  subjectType: string | null,
  docType: string | null,
): RetentionPolicyRow | null {
  let best: { p: RetentionPolicyRow; rank: [number, number, number, number] } | null = null;
  for (const p of policies) {
    if (!p.is_active) continue;
    if (p.subject_type !== null && !sameText(p.subject_type, subjectType)) continue;
    if (p.doc_type !== null && !sameText(p.doc_type, docType)) continue;
    const rank: [number, number, number, number] = [
      (p.subject_type !== null ? 1 : 0) + (p.doc_type !== null ? 1 : 0),
      p.doc_type !== null ? 1 : 0,
      p.retain_days,
      -p.id,
    ];
    if (!best || outranks(rank, best.rank)) {
      best = { p, rank };
    }
  }
  return best?.p ?? null;
}

/** Retention policies, the purge engine and its run reports (P4.4). */
@Injectable()
export class DocumentRetentionService {
  private readonly logger = new Logger(DocumentRetentionService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3: S3Service,
    private readonly audit: AuditService,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    }
    return { store_id: c.store_id, organization_id: c.organization_id, user_id: c.user_id ?? null };
  }

  // ---------------------------------------------------------------- policies

  async listPolicies(): Promise<RetentionPolicyRow[]> {
    const c = this.ctx();
    return this.prisma.document_retention_policies.findMany({
      where: { store_id: c.store_id },
      orderBy: [{ id: 'asc' }],
    });
  }

  async createPolicy(dto: CreateRetentionPolicyDto): Promise<RetentionPolicyRow> {
    const c = this.ctx();
    const key = dto.key ?? slugify(dto.name);
    const taken = await this.prisma.document_retention_policies.findFirst({
      where: { store_id: c.store_id, key },
      select: { id: true },
    });
    if (taken) throw new VendixHttpException(ErrorCodes.DOCRET_POLICY_KEY_TAKEN);
    try {
      return await this.prisma.document_retention_policies.create({
        data: {
          organization_id: c.organization_id,
          store_id: c.store_id,
          key,
          name: dto.name.trim(),
          subject_type: dto.subject_type?.trim() || null,
          doc_type: dto.doc_type?.trim() || null,
          retain_days: dto.retain_days,
          is_active: dto.is_active ?? true,
          created_by_user_id: c.user_id ?? 0,
        },
      });
    } catch (e: unknown) {
      if ((e as { code?: string } | null)?.code === 'P2002') throw new VendixHttpException(ErrorCodes.DOCRET_POLICY_KEY_TAKEN);
      throw e;
    }
  }

  async updatePolicy(id: number, dto: UpdateRetentionPolicyDto): Promise<RetentionPolicyRow> {
    const c = this.ctx();
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data['name'] = dto.name.trim();
    if (dto.subject_type !== undefined) data['subject_type'] = dto.subject_type?.trim() || null;
    if (dto.doc_type !== undefined) data['doc_type'] = dto.doc_type?.trim() || null;
    if (dto.retain_days !== undefined) data['retain_days'] = dto.retain_days;
    if (dto.is_active !== undefined) data['is_active'] = dto.is_active;
    const { count } = await this.prisma.document_retention_policies.updateMany({
      where: { id, store_id: c.store_id },
      data,
    });
    if (count === 0) throw new VendixHttpException(ErrorCodes.DOCRET_POLICY_NOT_FOUND);
    return (await this.prisma.document_retention_policies.findFirst({
      where: { id, store_id: c.store_id },
    })) as RetentionPolicyRow;
  }

  async removePolicy(id: number): Promise<void> {
    const c = this.ctx();
    const { count } = await this.prisma.document_retention_policies.deleteMany({
      where: { id, store_id: c.store_id },
    });
    if (count === 0) throw new VendixHttpException(ErrorCodes.DOCRET_POLICY_NOT_FOUND);
  }

  // -------------------------------------------------------------- candidates

  /**
   * Files due for purge. A dossier is closed when `closed_at` is set or when
   * its request finished (`workflow_instances.completed_at`: set on completion
   * and on cancellation); a file also kept by an open dossier is never due.
   * Must run inside the store context.
   */
  async findCandidates(now: Date): Promise<PurgeCandidate[]> {
    const c = this.ctx();
    const policies: RetentionPolicyRow[] = await this.prisma.document_retention_policies.findMany({
      where: { store_id: c.store_id, is_active: true },
    });
    if (policies.length === 0) return [];

    const dossiers: Array<{
      id: number;
      reference: string;
      subject_type: string | null;
      closed_at: Date | null;
      workflow_instance_id: number | null;
    }> = await this.prisma.dossiers.findMany({
      where: {
        store_id: c.store_id,
        OR: [{ closed_at: { not: null } }, { instance: { completed_at: { not: null } } }],
      },
    });
    if (dossiers.length === 0) return [];
    const instanceIds = dossiers
      .map((d) => d.workflow_instance_id)
      .filter((v): v is number => v !== null);
    const completed = new Map<number, Date>();
    for (const part of chunks(instanceIds)) {
      const rows: Array<{ id: number; completed_at: Date | null }> =
        await this.prisma.workflow_instances.findMany({
          where: { store_id: c.store_id, id: { in: part }, completed_at: { not: null } },
          select: { id: true, completed_at: true },
        });
      for (const r of rows) if (r.completed_at) completed.set(r.id, r.completed_at);
    }
    const closed = new Map<number, { d: (typeof dossiers)[number]; at: Date }>();
    for (const d of dossiers) {
      const at = d.closed_at ?? (d.workflow_instance_id ? completed.get(d.workflow_instance_id) : undefined);
      if (at) closed.set(d.id, { d, at });
    }
    if (closed.size === 0) return [];

    // File → its closed dossier (the latest closure), unless an open dossier also holds it.
    const closedIds = [...closed.keys()];
    const fileDossier = new Map<number, number>();
    for (const part of chunks(closedIds)) {
      const items: Array<{ file_id: number; dossier_id: number }> =
        await this.prisma.dossier_items.findMany({
          where: { store_id: c.store_id, dossier_id: { in: part }, file_id: { not: null } },
          select: { file_id: true, dossier_id: true },
        });
      for (const it of items) {
        const prev = fileDossier.get(it.file_id);
        if (prev === undefined || closed.get(it.dossier_id)!.at > closed.get(prev)!.at) {
          fileDossier.set(it.file_id, it.dossier_id);
        }
      }
    }
    const fileIds = [...fileDossier.keys()];
    const closedSet = new Set(closedIds);
    const heldOpen = new Set<number>();
    for (const part of chunks(fileIds)) {
      const items: Array<{ file_id: number; dossier_id: number }> =
        await this.prisma.dossier_items.findMany({
          where: { store_id: c.store_id, file_id: { in: part } },
          select: { file_id: true, dossier_id: true },
        });
      for (const it of items) if (!closedSet.has(it.dossier_id)) heldOpen.add(it.file_id);
    }

    const out: PurgeCandidate[] = [];
    for (const part of chunks(fileIds.filter((id) => !heldOpen.has(id)))) {
      const files: Array<{
        id: number;
        original_name: string;
        mime_type: string;
        size_bytes: number;
        sha256: string;
        s3_key: string;
        legal_hold: boolean;
      }> = await this.prisma.stored_files.findMany({
        where: {
          store_id: c.store_id,
          id: { in: part },
          deleted_at: null,
          purged_at: null,
          OR: [{ retention_until: null }, { retention_until: { lte: now } }],
        },
      });
      const profiles: Array<{ file_id: number; doc_type: string | null }> =
        files.length > 0
          ? await this.prisma.document_file_profiles.findMany({
              where: { store_id: c.store_id, file_id: { in: files.map((f) => f.id) } },
              select: { file_id: true, doc_type: true },
            })
          : [];
      const docTypes = new Map(profiles.map((p) => [p.file_id, p.doc_type]));
      for (const f of files) {
        const { d, at } = closed.get(fileDossier.get(f.id)!)!;
        const policy = pickPolicy(policies, d.subject_type, docTypes.get(f.id) ?? null);
        if (!policy) continue;
        const dueAt = new Date(at.getTime() + policy.retain_days * DAY_MS);
        if (dueAt.getTime() >= now.getTime()) continue;
        out.push({
          file_id: f.id,
          original_name: f.original_name,
          mime_type: f.mime_type,
          size_bytes: f.size_bytes,
          sha256: f.sha256,
          s3_key: f.s3_key,
          dossier_id: d.id,
          dossier_reference: d.reference,
          subject_type: d.subject_type,
          closed_at: at,
          policy_id: policy.id,
          policy_name: policy.name,
          retain_days: policy.retain_days,
          due_at: dueAt,
          legal_hold: f.legal_hold,
          reason: `Política ${policy.name}: ${policy.retain_days} días desde el cierre`.slice(0, 200),
        });
      }
    }
    return out.sort((a, b) => a.due_at.getTime() - b.due_at.getTime() || a.file_id - b.file_id);
  }

  /** What a run would do now. Deletes nothing. */
  async preview(now = new Date()) {
    const all = await this.findCandidates(now);
    const strip = ({ s3_key: _key, ...rest }: PurgeCandidate) => rest;
    const toPurge = all.filter((x) => !x.legal_hold);
    const held = all.filter((x) => x.legal_hold);
    return {
      to_purge: toPurge.map(strip),
      skipped_legal_hold: held.map(strip),
      totals: {
        files: toPurge.length,
        bytes: toPurge.reduce((n, x) => n + x.size_bytes, 0),
        skipped_legal_hold: held.length,
      },
    };
  }

  // -------------------------------------------------------------------- runs

  /**
   * Purges what is due. Per file: claim the row (`purged_at`, guarded by
   * `legal_hold = false` so a hold set meanwhile wins), delete the S3 object,
   * write the item. The row, its hash and every other column stay as
   * evidence. A file whose object could not be deleted is released again.
   */
  async run(trigger: PurgeTrigger, now = new Date()) {
    const c = this.ctx();
    const open = await this.prisma.document_purge_runs.findFirst({
      where: {
        store_id: c.store_id,
        status: 'running',
        started_at: { gte: new Date(now.getTime() - STALE_RUN_MS) },
      },
      select: { id: true },
    });
    if (open) throw new VendixHttpException(ErrorCodes.DOCRET_RUN_IN_PROGRESS);

    const run = await this.prisma.document_purge_runs.create({
      data: {
        organization_id: c.organization_id,
        store_id: c.store_id,
        trigger,
        status: 'running',
        started_by_user_id: trigger === 'manual' ? c.user_id : null,
        started_at: now,
      },
    });
    let purged = 0;
    let bytes = 0;
    let skipped = 0;
    let failures = 0;
    let firstError: string | null = null;
    try {
      for (const cand of await this.findCandidates(now)) {
        const base = {
          store_id: c.store_id,
          run_id: run.id,
          file_id: cand.file_id,
          policy_id: cand.policy_id,
          original_name: cand.original_name,
          size_bytes: cand.size_bytes,
          sha256: cand.sha256,
          reason: cand.reason,
        };
        if (cand.legal_hold) {
          await this.prisma.document_purge_items.create({
            data: { ...base, outcome: 'skipped_legal_hold' },
          });
          skipped++;
          continue;
        }
        const claimed = await this.prisma.stored_files.updateMany({
          where: {
            id: cand.file_id,
            store_id: c.store_id,
            purged_at: null,
            legal_hold: false,
            OR: [{ retention_until: null }, { retention_until: { lte: now } }],
          },
          data: { purged_at: now },
        });
        if (claimed.count === 0) {
          // A hold or a retention date arrived after the candidate was read.
          const kept = await this.prisma.stored_files.findFirst({
            where: { id: cand.file_id, store_id: c.store_id, legal_hold: true },
            select: { id: true },
          });
          if (kept) {
            await this.prisma.document_purge_items.create({
              data: { ...base, outcome: 'skipped_legal_hold' },
            });
            skipped++;
          }
          continue;
        }
        try {
          await this.s3.deleteFile(cand.s3_key);
        } catch (e) {
          await this.prisma.stored_files.updateMany({
            where: { id: cand.file_id, store_id: c.store_id },
            data: { purged_at: null },
          });
          failures++;
          firstError ??= `No se pudo borrar ${cand.original_name}: ${(e as Error)?.message ?? 'error de almacenamiento'}`;
          this.logger.error(`Purge of file ${cand.file_id} failed: ${(e as Error)?.message}`);
          continue;
        }
        await this.prisma.document_purge_items.create({ data: { ...base, outcome: 'purged' } });
        purged++;
        bytes += cand.size_bytes;
      }
    } catch (e) {
      firstError = `${(e as Error)?.message ?? 'error'}`;
      failures++;
    }
    const status = failures === 0 ? 'completed' : purged + skipped > 0 ? 'partial' : 'failed';
    await this.prisma.document_purge_runs.updateMany({
      where: { id: run.id, store_id: c.store_id },
      data: {
        status,
        files_purged: purged,
        bytes_purged: bytes,
        skipped_legal_hold: skipped,
        error: firstError ? firstError.slice(0, 500) : null,
        finished_at: new Date(),
      },
    });
    await this.audit.log({
      userId: c.user_id ?? undefined,
      storeId: c.store_id,
      organizationId: c.organization_id,
      action: AuditAction.DELETE,
      resource: 'stored_files',
      resourceId: run.id,
      metadata: { event: 'retention_purge', trigger, run_id: run.id, purged, bytes, skipped_legal_hold: skipped, status },
    });
    return this.getRun(run.id);
  }

  private shapeRun(r: document_purge_runs) {
    return {
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      files_purged: r.files_purged,
      bytes_purged: Number(r.bytes_purged ?? 0),
      skipped_legal_hold: r.skipped_legal_hold,
      error: r.error,
      started_by_user_id: r.started_by_user_id,
      started_at: r.started_at,
      finished_at: r.finished_at,
    };
  }

  async listRuns(input: { page?: number; limit?: number } = {}) {
    const c = this.ctx();
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const where = { store_id: c.store_id };
    const [rows, total] = await Promise.all([
      this.prisma.document_purge_runs.findMany({
        where,
        orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.document_purge_runs.count({ where }),
    ]);
    return { data: rows.map((r: document_purge_runs) => this.shapeRun(r)), total, page, limit };
  }

  async getRun(id: number) {
    const c = this.ctx();
    const run = await this.prisma.document_purge_runs.findFirst({
      where: { id, store_id: c.store_id },
    });
    if (!run) throw new VendixHttpException(ErrorCodes.DOCRET_RUN_NOT_FOUND);
    const items = await this.prisma.document_purge_items.findMany({
      where: { run_id: id, store_id: c.store_id },
      orderBy: [{ id: 'asc' }],
    });
    return {
      ...this.shapeRun(run),
      items: items.map((i: document_purge_items) => ({
        id: i.id,
        file_id: i.file_id,
        policy_id: i.policy_id,
        outcome: i.outcome,
        original_name: i.original_name,
        size_bytes: i.size_bytes,
        sha256: i.sha256,
        reason: i.reason,
        created_at: i.created_at,
      })),
    };
  }
}
