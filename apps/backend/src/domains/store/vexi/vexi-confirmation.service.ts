import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';

export type RedeemOutcome = 'ok' | 'missing' | 'mismatch';

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

/**
 * Deterministic JSON: object keys sorted at every depth, arrays kept in order.
 *
 * Array order is meaningful (`enabled_price_tier_ids: [7, 9]` is not the same
 * list as `[9, 7]` to a reader approving it), so only objects are reordered.
 * `undefined` inside an object is dropped by `JSON.stringify` anyway; dropping
 * it here too keeps the proposal and the apply — which crossed a JSON round
 * trip in between — hashing to the same string.
 */
function canonicalJson(value: unknown): string {
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
  ): Promise<string> {
    const token = randomUUID();
    await this.redis.set(
      this.key(token),
      this.fingerprint(toolName, args, userId),
      'EX',
      TOKEN_TTL_SECONDS,
    );
    return token;
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
