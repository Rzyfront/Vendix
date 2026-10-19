import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';

export type RedeemOutcome = 'ok' | 'missing' | 'mismatch';

/** G-only sidecar. The legacy token/fingerprint and click ABI remain unchanged. */
export interface ConfirmationMetadata {
  previewHash: string;
  organizationId: number;
  storeId: number;
  toolVersion: string;
  conversationId?: number;
}

export interface ConfirmationInspection {
  outcome: RedeemOutcome;
  ttlSeconds: number;
  metadata?: ConfirmationMetadata;
}

/** Long enough to read a diff and decide; short enough that a forgotten tab expires. */
const TOKEN_TTL_SECONDS = 300;

/**
 * Compare-and-delete in one round trip.
 *
 * Two separate GET + DEL calls would let the same token be redeemed twice by
 * concurrent requests — double-clicking "Aprobar" would apply the write twice.
 *  0 → no such token (never issued, or expired)
 * -1 → token exists but the fingerprint does not match
 *  1 → redeemed, token consumed
 */
const REDEEM_SCRIPT = `
local stored = redis.call('GET', KEYS[1])
if not stored then return 0 end
if stored ~= ARGV[1] then return -1 end
redis.call('DEL', KEYS[1])
return 1
`;

const ISSUE_BOUND_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
return 1
`;

/** Inspect without consuming: voice must validate the exact issued preview first. */
const INSPECT_SCRIPT = `
local stored = redis.call('GET', KEYS[1])
if not stored then return {0, 0, ''} end
if stored ~= ARGV[1] then return {-1, 0, ''} end
local ttl = redis.call('TTL', KEYS[1])
if ttl <= 0 then return {0, 0, ''} end
return {1, ttl, redis.call('GET', KEYS[2]) or ''}
`;

/**
 * Deterministic JSON: object keys sorted at every depth, arrays kept in order.
 *
 * Array order is meaningful (`enabled_price_tier_ids: [7, 9]` is not the same
 * list as `[9, 7]` to a reader approving it), so only objects are reordered.
 * `undefined` inside an object is dropped by `JSON.stringify` anyway; dropping
 * it here too keeps the proposal and the apply — which crossed a JSON round
 * trip in between — hashing to the same string.
 */
/**
 * Exported for plan approval: the whole-plan token MUST hash step arguments
 * with this exact function, so a step approved in a bundle and a step
 * re-proposed alone fingerprint identically. Import it — do not duplicate it.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

@Injectable()
export class VexiConfirmationService {
  private readonly logger = new Logger(VexiConfirmationService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Mints a single-use token authorizing exactly one execution of one tool
   * with one set of arguments, for one user.
   *
   * The arguments are part of the fingerprint on purpose: a token issued for
   * "ajustar 5 unidades" must not execute "ajustar 500". Without that binding,
   * a confirmation would authorize the *tool*, not the *change* the user saw.
   */
  async issue(
    toolName: string,
    args: Record<string, any>,
    userId: number | undefined,
    metadata?: ConfirmationMetadata,
  ): Promise<string> {
    const token = randomUUID();
    if (metadata) {
      if (!this.validMetadata(metadata)) {
        throw new Error('Invalid confirmation preview binding');
      }
      await this.redis.eval(
        ISSUE_BOUND_SCRIPT,
        2,
        this.key(token),
        this.metadataKey(token),
        this.fingerprint(toolName, args, userId),
        canonicalJson(metadata),
        TOKEN_TTL_SECONDS,
      );
      return token;
    }
    await this.redis.set(
      this.key(token),
      this.fingerprint(toolName, args, userId),
      'EX',
      TOKEN_TTL_SECONDS,
    );
    return token;
  }

  async inspect(
    token: string,
    toolName: string,
    args: Record<string, any>,
    userId: number | undefined,
  ): Promise<ConfirmationInspection> {
    const result = (await this.redis.eval(
      INSPECT_SCRIPT,
      2,
      this.key(token),
      this.metadataKey(token),
      this.fingerprint(toolName, args, userId),
    )) as [number, number, string];
    if (Number(result?.[0]) === -1)
      return { outcome: 'mismatch', ttlSeconds: 0 };
    if (Number(result?.[0]) !== 1 || Number(result?.[1]) <= 0) {
      return { outcome: 'missing', ttlSeconds: 0 };
    }
    let metadata: ConfirmationMetadata | undefined;
    if (result[2]) {
      try {
        const parsed: unknown = JSON.parse(String(result[2]));
        if (this.validMetadata(parsed)) metadata = parsed;
      } catch {
        // Corrupt/missing G metadata cannot authorize voice; legacy clicks still work.
      }
    }
    return {
      outcome: 'ok',
      ttlSeconds: Number(result[1]),
      ...(metadata && { metadata }),
    };
  }

  async redeem(
    token: string,
    toolName: string,
    args: Record<string, any>,
    userId: number | undefined,
  ): Promise<RedeemOutcome> {
    const result = (await this.redis.eval(
      REDEEM_SCRIPT,
      1,
      this.key(token),
      this.fingerprint(toolName, args, userId),
    )) as number;

    if (result === 1) return 'ok';
    if (result === -1) {
      this.logger.warn(
        `Confirmation token replayed against different arguments for tool "${toolName}"`,
      );
      return 'mismatch';
    }
    return 'missing';
  }

  private key(token: string): string {
    return `vexi:confirm:${token}`;
  }

  private metadataKey(token: string): string {
    return `vexi:confirm-meta:${token}`;
  }

  private validMetadata(value: unknown): value is ConfirmationMetadata {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const meta = value as ConfirmationMetadata;
    return (
      /^[a-f0-9]{64}$/.test(meta.previewHash) &&
      Number.isSafeInteger(meta.organizationId) &&
      meta.organizationId > 0 &&
      Number.isSafeInteger(meta.storeId) &&
      meta.storeId > 0 &&
      typeof meta.toolVersion === 'string' &&
      /^[a-zA-Z0-9._-]{1,40}$/.test(meta.toolVersion) &&
      (meta.conversationId === undefined ||
        (Number.isSafeInteger(meta.conversationId) && meta.conversationId > 0))
    );
  }

  /**
   * Key order in a JSON object is insertion order, and the model does not emit
   * arguments in a stable order between the proposal and the apply. Sorting
   * before hashing keeps `{a,b}` and `{b,a}` the same change.
   *
   * Sorted RECURSIVELY, and not with `JSON.stringify(args, keys.sort())`. An
   * array replacer is an allowlist that applies at every depth, so the only
   * keys that survived inside a nested object were the ones that happened to
   * share a name with a top-level key. For `write_endpoint` — whose arguments
   * are `{path, method, body}` — every payload serialized as
   * `{"body":{},"method":…,"path":…}`, so a token minted for "subir el precio a
   * $5" redeemed "subirlo a $999.999" with the same fingerprint. That is the
   * precise failure the docblock on `issue()` says must not happen: the token
   * was authorizing the *tool*, not the *change* the person approved.
   */
  private fingerprint(
    toolName: string,
    args: Record<string, any>,
    userId: number | undefined,
  ): string {
    return createHash('sha256')
      .update(`${userId ?? 'anon'}|${toolName}|${canonicalJson(args ?? {})}`)
      .digest('hex');
  }
}
