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
   */
  private fingerprint(
    toolName: string,
    args: Record<string, any>,
    userId: number | undefined,
  ): string {
    const canonical = JSON.stringify(args, Object.keys(args ?? {}).sort());
    return createHash('sha256')
      .update(`${userId ?? 'anon'}|${toolName}|${canonical}`)
      .digest('hex');
  }
}
