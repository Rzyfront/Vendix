import { Injectable, NotFoundException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

export const CODEMODE_RUNS_MAX_LIMIT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CodeModeRunsQuery {
  page?: number;
  limit?: number;
  store_id?: number;
  outcome?: string;
}

/** Columns read for the audit view: NO source_*, NO args, NO results, NO key id. */
const SAFE_SELECT = {
  id: true,
  store_id: true,
  user_id: true,
  executor: true,
  rounds: true,
  tenant_hash: true,
  cut_reason: true,
  outcome: true,
  returned_bytes: true,
  usage: true,
  calls: true,
  manifest: true,
  created_at: true,
  finished_at: true,
} as const;

interface SafeRow {
  id: string;
  store_id: number;
  user_id: number;
  executor: string | null;
  rounds: number | null;
  tenant_hash: string | null;
  cut_reason: string | null;
  outcome: string;
  returned_bytes: number | null;
  usage: unknown;
  calls: unknown;
  manifest: unknown;
  created_at: Date;
  finished_at: Date | null;
}

export interface CodeModeRunSummary {
  id: string;
  store: { id: number; name: string | null };
  user: { id: number; name: string | null };
  executor: string | null;
  rounds: number | null;
  call_count: number;
  duration_ms: number | null;
  outcome: string;
  cut_reason: string | null;
  tenant_hash: string | null;
  created_at: Date;
}

export interface CodeModeRunDetail extends CodeModeRunSummary {
  returned_bytes: number | null;
  tools: string[];
  calls: Array<{
    seq: number;
    tool: string;
    status: string;
    rows: number | null;
    duration_ms: number | null;
  }>;
}

/** Last entry per seq (a `dispatching` row is followed by the final one). */
function foldCalls(raw: unknown): CodeModeRunDetail['calls'] {
  const bySeq = new Map<number, Record<string, unknown>>();
  if (Array.isArray(raw))
    for (const entry of raw as Array<Record<string, unknown>>)
      if (entry && typeof entry.seq === 'number') bySeq.set(entry.seq, entry);
  return [...bySeq.values()]
    .sort((a, b) => Number(a.seq) - Number(b.seq))
    .map((entry) => ({
      seq: Number(entry.seq),
      tool: String(entry.tool ?? ''),
      status: String(entry.status ?? ''),
      rows: typeof entry.rows === 'number' ? entry.rows : null,
      duration_ms:
        typeof entry.duration_ms === 'number' ? entry.duration_ms : null,
    }));
}

/**
 * Super-admin audit of Code Mode runs (F10 T67). Read-only and cross-store by
 * design, so it projects metadata ONLY: the encrypted source, the argument
 * hashes and any result are never selected.
 */
@Injectable()
export class CodeModeRunsService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async list(
    query: CodeModeRunsQuery,
  ): Promise<{
    items: CodeModeRunSummary[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const limit = Math.min(
      CODEMODE_RUNS_MAX_LIMIT,
      Math.max(1, Math.trunc(query.limit ?? 20)),
    );
    // Code Mode rows only: they are the ones that carry an executor.
    const where = {
      executor: { not: null },
      ...(query.store_id ? { store_id: query.store_id } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.ai_agent_script_runs.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.ai_agent_script_runs.count({ where }),
    ]);
    const names = await this.names(rows as SafeRow[]);
    return {
      items: (rows as SafeRow[]).map((row) => this.summary(row, names)),
      total,
      page,
      limit,
    };
  }

  async get(id: string): Promise<CodeModeRunDetail> {
    if (!UUID.test(id)) throw new NotFoundException('Ejecución no encontrada');
    const row = (await this.prisma.ai_agent_script_runs.findFirst({
      where: { id, executor: { not: null } },
      select: SAFE_SELECT,
    })) as SafeRow | null;
    if (!row) throw new NotFoundException('Ejecución no encontrada');
    const names = await this.names([row]);
    return {
      ...this.summary(row, names),
      returned_bytes: row.returned_bytes,
      tools: Array.isArray(row.manifest) ? (row.manifest as string[]) : [],
      calls: foldCalls(row.calls),
    };
  }

  private async names(rows: SafeRow[]) {
    const storeIds = [...new Set(rows.map((r) => r.store_id))];
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const [stores, users] = await Promise.all([
      storeIds.length
        ? this.prisma.stores.findMany({
            where: { id: { in: storeIds } },
            select: { id: true, name: true },
          })
        : [],
      userIds.length
        ? this.prisma.users.findMany({
            where: { id: { in: userIds } },
            select: { id: true, first_name: true, last_name: true },
          })
        : [],
    ]);
    return {
      stores: new Map<number, string | null>(
        stores.map((s): [number, string | null] => [s.id, s.name]),
      ),
      users: new Map<number, string>(
        users.map(
          (u): [number, string] => [
            u.id,
            `${u.first_name} ${u.last_name}`.trim(),
          ],
        ),
      ),
    };
  }

  private summary(
    row: SafeRow,
    names: Awaited<ReturnType<CodeModeRunsService['names']>>,
  ): CodeModeRunSummary {
    const calls = foldCalls(row.calls);
    return {
      id: row.id,
      store: { id: row.store_id, name: names.stores.get(row.store_id) ?? null },
      user: { id: row.user_id, name: names.users.get(row.user_id) ?? null },
      executor: row.executor,
      rounds: row.rounds,
      call_count: calls.length,
      duration_ms: row.finished_at
        ? row.finished_at.getTime() - row.created_at.getTime()
        : null,
      outcome: row.outcome,
      cut_reason: row.cut_reason,
      tenant_hash: row.tenant_hash,
      created_at: row.created_at,
    };
  }
}
