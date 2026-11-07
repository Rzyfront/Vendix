import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { EvidenceEventType, sha256Hex } from './signature.constants';

export interface EvidenceInput {
  request_id: number;
  signer_id?: number | null;
  type: EvidenceEventType;
  ip_address?: string | null;
  user_agent?: string | null;
  payload?: Record<string, unknown>;
  occurred_at?: Date;
}

export interface EvidenceRow {
  request_id: number;
  signer_id: number | null;
  seq: number;
  type: string;
  ip_address: string | null;
  user_agent: string | null;
  payload: unknown;
  prev_hash: string | null;
  event_hash: string;
  occurred_at: Date;
}

export interface ChainVerification {
  valid: boolean;
  count: number;
  /** `seq` of the first event whose link or hash does not match. */
  broken_at_seq: number | null;
  last_hash: string | null;
}

/** JSON with sorted keys, so the same event always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** `sha256(prev_hash || canonical event)`; the first event has an empty previous hash. */
export function evidenceHash(prevHash: string | null, event: Omit<EvidenceRow, 'prev_hash' | 'event_hash'>): string {
  const body = canonicalJson({
    request_id: event.request_id,
    signer_id: event.signer_id,
    seq: event.seq,
    type: event.type,
    ip_address: event.ip_address,
    user_agent: event.user_agent,
    payload: event.payload,
    occurred_at: new Date(event.occurred_at).toISOString(),
  });
  return sha256Hex((prevHash ?? '') + body);
}

/** Recomputes every hash and link of a request's events (ordered by `seq`). */
export function verifyEvidenceChain(rows: EvidenceRow[]): ChainVerification {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  let prev: string | null = null;
  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i];
    const linked = (row.prev_hash ?? null) === prev && row.seq === i + 1;
    if (!linked || evidenceHash(prev, row) !== row.event_hash) {
      return { valid: false, count: ordered.length, broken_at_seq: row.seq, last_hash: prev };
    }
    prev = row.event_hash;
  }
  return { valid: true, count: ordered.length, broken_at_seq: null, last_hash: prev };
}

/**
 * Append-only, hash-chained evidence of a signature request. The table only
 * accepts inserts (trigger); writers of one request are serialized by locking
 * the request row inside the caller's transaction, so `seq` never collides.
 */
@Injectable()
export class SignatureEvidenceService {
  constructor(private readonly prisma: StorePrismaService) {}

  private storeId(): number {
    const id = RequestContextService.getStoreId();
    if (!id) throw new VendixHttpException(ErrorCodes.SIGNATURE_REQUEST_NOT_FOUND);
    return id;
  }

  /** Serializes writers of the request without changing its state. */
  async lock(tx: any, requestId: number): Promise<void> {
    const touched = await tx.signature_requests.updateMany({
      where: { id: requestId, store_id: this.storeId() },
      data: { updated_at: new Date() },
    });
    if (touched.count === 0) throw new VendixHttpException(ErrorCodes.SIGNATURE_REQUEST_NOT_FOUND);
  }

  async append(tx: any, input: EvidenceInput): Promise<EvidenceRow> {
    await this.lock(tx, input.request_id);
    const storeId = this.storeId();
    const last = await tx.signature_evidence_events.findFirst({
      where: { request_id: input.request_id, store_id: storeId },
      orderBy: { seq: 'desc' },
      select: { seq: true, event_hash: true },
    });
    const body = {
      request_id: input.request_id,
      signer_id: input.signer_id ?? null,
      seq: (last?.seq ?? 0) + 1,
      type: input.type,
      ip_address: input.ip_address ?? null,
      user_agent: input.user_agent ? input.user_agent.slice(0, 400) : null,
      payload: input.payload ?? {},
      occurred_at: input.occurred_at ?? new Date(),
    };
    const prev_hash: string | null = last?.event_hash ?? null;
    const event_hash = evidenceHash(prev_hash, body);
    await tx.signature_evidence_events.create({
      data: { store_id: storeId, ...body, prev_hash, event_hash },
    });
    return { ...body, prev_hash, event_hash };
  }

  async list(requestId: number, tx?: any): Promise<EvidenceRow[]> {
    return (tx ?? this.prisma).signature_evidence_events.findMany({
      where: { request_id: requestId, store_id: this.storeId() },
      orderBy: { seq: 'asc' },
    });
  }

  async verify(requestId: number): Promise<ChainVerification> {
    return verifyEvidenceChain(await this.list(requestId));
  }
}
