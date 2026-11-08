import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import type { WorkflowTx } from '../engine/workflow-engine.types';
import {
  auditCategoryOf,
  WorkflowAuditAction,
  WorkflowAuditActorType,
  WorkflowAuditCategory,
} from './workflow-audit.catalog';
import { WorkflowAuditRequestContext } from './workflow-audit.context';

/**
 * Namespace of the per-store advisory lock that serializes appends to the
 * audit chain (`pg_advisory_xact_lock(namespace, store_id)`). Arbitrary but
 * fixed: changing it would let an old and a new writer interleave.
 */
export const WORKFLOW_AUDIT_LOCK_NAMESPACE = 7207;

const VERIFY_BATCH = 1000;
const MAX_DETAIL_DEPTH = 6;
const MAX_DETAIL_ARRAY = 200;
const MAX_DETAIL_STRING = 2000;
/** Keys whose value never reaches the trail, whatever the caller passes. */
const REDACTED_KEYS =
  /^(value|value_enc|secret_value|token|token_hash|password|authorization|api_key|signing_secret|secret)$/i;

export interface WorkflowAuditActor {
  type: WorkflowAuditActorType;
  id?: number | null;
  label?: string | null;
}

export interface WorkflowAuditInput {
  action: WorkflowAuditAction;
  /** definition | instance | task | file | issued_document | secret | export | audit */
  target_type: string;
  target_id?: string | number | bigint | null;
  definition_id?: number | null;
  instance_id?: number | null;
  /** One line in Spanish, as the screen shows it. */
  summary: string;
  details?: Record<string, unknown>;
  /** Defaults to the authenticated user of the request, else `system`. */
  actor?: WorkflowAuditActor;
}

/** The columns that enter the hash, in their stored form. */
export interface WorkflowAuditHashable {
  store_id: number;
  seq: bigint | number | string;
  category: string;
  action: string;
  actor_type: string;
  actor_id: number | null;
  actor_label: string | null;
  target_type: string;
  target_id: string | null;
  definition_id: number | null;
  instance_id: number | null;
  summary: string;
  details: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date | string;
}

export interface WorkflowAuditRow extends WorkflowAuditHashable {
  prev_hash: string | null;
  entry_hash: string;
}

export interface WorkflowAuditVerification {
  valid: boolean;
  count: number;
  /** `seq` of the first row whose link or hash does not match. */
  broken_at_seq: string | null;
  last_hash: string | null;
}

/** JSON with sorted keys, so the same row always hashes the same. */
export function auditCanonicalJson(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(auditCanonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${auditCanonicalJson(obj[k])}`).join(',')}}`;
}

/** `sha256(prev_hash || canonical row)`; the first row has an empty previous hash. */
export function auditEntryHash(prevHash: string | null, row: WorkflowAuditHashable): string {
  const body = auditCanonicalJson({
    store_id: row.store_id,
    seq: String(row.seq),
    category: row.category,
    action: row.action,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    actor_label: row.actor_label,
    target_type: row.target_type,
    target_id: row.target_id,
    definition_id: row.definition_id,
    instance_id: row.instance_id,
    summary: row.summary,
    details: row.details,
    ip_address: row.ip_address,
    user_agent: row.user_agent,
    created_at: new Date(row.created_at).toISOString(),
  });
  return createHash('sha256')
    .update((prevHash ?? '') + body)
    .digest('hex');
}

/**
 * JSON-safe copy of the caller's details: dates as ISO strings, bigints as
 * strings, undefined dropped, bounded depth and size, and any secret-looking
 * key replaced by a marker. What is stored is exactly what is hashed.
 */
export function sanitizeAuditDetails(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return cutText(value, MAX_DETAIL_STRING);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return null;
  if (depth >= MAX_DETAIL_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_DETAIL_ARRAY).map((v) => sanitizeAuditDetails(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined || typeof v === 'function') continue;
    out[k] = REDACTED_KEYS.test(k) ? '[redactado]' : sanitizeAuditDetails(v, depth + 1);
  }
  return out;
}

/** Recomputes every hash and link of a store's rows (ordered by `seq`). */
export function verifyAuditChain(
  rows: WorkflowAuditRow[],
  start: { prev_hash: string | null; seq: bigint } = { prev_hash: null, seq: 0n },
): WorkflowAuditVerification & { next_seq: bigint } {
  let prev = start.prev_hash;
  let expected = start.seq;
  for (const row of rows) {
    expected += 1n;
    const linked = (row.prev_hash ?? null) === prev && BigInt(row.seq) === expected;
    if (!linked || auditEntryHash(prev, row) !== row.entry_hash) {
      return {
        valid: false,
        count: Number(expected - 1n),
        broken_at_seq: String(row.seq),
        last_hash: prev,
        next_seq: expected,
      };
    }
    prev = row.entry_hash;
  }
  return { valid: true, count: Number(expected), broken_at_seq: null, last_hash: prev, next_seq: expected };
}

/**
 * At most `max` UTF-16 units, never half of a surrogate pair: a lone half
 * would be stored as U+FFFD (or refused by jsonb), so the stored row would
 * no longer match its hash.
 */
export function cutText(value: string, max: number): string {
  if (value.length <= max) return value;
  const code = value.charCodeAt(max - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

function clip(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  return cutText(value, max);
}

/**
 * Append-only, hash-chained audit trail of Flows (flujos-adm P7.2).
 *
 * The table only accepts inserts (trigger for UPDATE, DELETE and TRUNCATE).
 * Appends of one store are serialized by a transaction-scoped advisory lock,
 * so `seq` and `prev_hash` never fork.
 *
 * - `append(tx, …)` writes inside the caller's business transaction: the
 *   decision and its audit row commit or roll back together. Call it as the
 *   LAST statement of that transaction, after every row lock, so the store
 *   lock is held for the shortest time and never waits on a row lock.
 * - `recordNow(…)` opens its own short transaction. It is fail-closed: when
 *   the row cannot be written it throws `WORKFLOW_AUDIT_UNAVAILABLE`, so a
 *   document or secret access never happens unaudited.
 */
@Injectable()
export class WorkflowAuditService {
  private readonly logger = new Logger(WorkflowAuditService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  private storeId(): number {
    const id = RequestContextService.getStoreId();
    if (!id) throw new VendixHttpException(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE);
    return id;
  }

  private actorOf(input: WorkflowAuditInput): Required<WorkflowAuditActor> {
    if (input.actor) {
      return { type: input.actor.type, id: input.actor.id ?? null, label: input.actor.label ?? null };
    }
    const ctx = RequestContextService.getContext();
    if (ctx?.user_id) return { type: 'user', id: ctx.user_id, label: ctx.email ?? null };
    return { type: 'system', id: null, label: null };
  }

  /** Appends one row inside `tx`. Returns the stored row. */
  async append(tx: WorkflowTx, input: WorkflowAuditInput): Promise<WorkflowAuditRow> {
    const storeId = this.storeId();
    const category: WorkflowAuditCategory = auditCategoryOf(input.action);
    const actor = this.actorOf(input);
    const origin = WorkflowAuditRequestContext.current();

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WORKFLOW_AUDIT_LOCK_NAMESPACE}::int, ${storeId}::int)`;
    const last: { seq: bigint; entry_hash: string } | null = await tx.workflow_audit_log.findFirst({
      where: { store_id: storeId },
      orderBy: { seq: 'desc' },
      select: { seq: true, entry_hash: true },
    });

    const row: WorkflowAuditHashable = {
      store_id: storeId,
      seq: BigInt(last?.seq ?? 0) + 1n,
      category,
      action: input.action,
      actor_type: actor.type,
      actor_id: actor.id,
      actor_label: clip(actor.label, 160),
      target_type: cutText(input.target_type, 40),
      target_id: input.target_id === null || input.target_id === undefined ? null : clip(String(input.target_id), 64),
      definition_id: input.definition_id ?? null,
      instance_id: input.instance_id ?? null,
      summary: cutText(input.summary, 500),
      details: sanitizeAuditDetails(input.details ?? {}) ?? {},
      ip_address: clip(origin?.ip_address, 64),
      user_agent: clip(origin?.user_agent, 300),
      created_at: new Date(),
    };
    const prev_hash = last?.entry_hash ?? null;
    const entry_hash = auditEntryHash(prev_hash, row);
    await tx.workflow_audit_log.create({ data: { ...row, prev_hash, entry_hash } });
    return { ...row, prev_hash, entry_hash };
  }

  /** Own transaction, fail-closed (see class doc). */
  async recordNow(input: WorkflowAuditInput): Promise<WorkflowAuditRow> {
    try {
      return await this.prisma.$transaction((tx: WorkflowTx) => this.append(tx, input));
    } catch (e) {
      if (e instanceof VendixHttpException) throw e;
      this.logger.error(`audit append failed (${input.action}): ${(e as Error).message}`);
      throw new VendixHttpException(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE);
    }
  }

  /** Walks the whole chain of the current store in `seq` order. */
  async verify(): Promise<WorkflowAuditVerification> {
    const storeId = this.storeId();
    let cursor = { prev_hash: null as string | null, seq: 0n };
    for (;;) {
      const rows: WorkflowAuditRow[] = await this.prisma.workflow_audit_log.findMany({
        where: { store_id: storeId, seq: { gt: cursor.seq } },
        orderBy: { seq: 'asc' },
        take: VERIFY_BATCH,
      });
      const result = verifyAuditChain(rows, cursor);
      if (!result.valid || rows.length < VERIFY_BATCH) {
        return {
          valid: result.valid,
          count: result.count,
          broken_at_seq: result.broken_at_seq,
          last_hash: result.last_hash,
        };
      }
      cursor = { prev_hash: result.last_hash, seq: result.next_seq };
    }
  }
}
