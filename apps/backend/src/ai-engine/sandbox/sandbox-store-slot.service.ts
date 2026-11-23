import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

/** Analysis Lambda `Timeout` in infra/agent-sandbox/python/template.json. */
export const ANALYSIS_LAMBDA_TIMEOUT_MS = 30_000;
/**
 * The slot must outlive the Lambda: a timed-out or aborted invocation keeps
 * running (B1: a guest that stops the watcher runs until the function
 * timeout). 15 s covers dispatch latency and a cold init.
 */
export const ANALYSIS_STORE_SLOT_TTL_MS = ANALYSIS_LAMBDA_TIMEOUT_MS + 15_000;

const KEY_PREFIX = 'ai:analysis:store-slot:';
// Compare-and-delete: never release a slot another invocation now owns.
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

/**
 * One analysis Lambda in flight per store, shared by every backend instance
 * through Redis. Complements the Postgres admission lease, which is fixed at
 * 30 s from admission and can expire while the Lambda is still alive.
 */
@Injectable()
export class SandboxStoreSlotService {
  private readonly logger = new Logger(SandboxStoreSlotService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** True when the store had no analysis in flight and the slot is now ours. */
  async acquire(storeId: number, token: string): Promise<boolean> {
    const reply = await this.redis.set(
      this.key(storeId),
      token,
      'PX',
      ANALYSIS_STORE_SLOT_TTL_MS,
      'NX',
    );
    return reply === 'OK';
  }

  /** Best effort: on any failure the TTL still frees the slot. */
  async release(storeId: number, token: string): Promise<void> {
    try {
      await this.redis.eval(RELEASE, 1, this.key(storeId), token);
    } catch {
      this.logger.warn(`analysis store slot release failed store=${storeId}`);
    }
  }

  private key(storeId: number): string {
    return `${KEY_PREFIX}${storeId}`;
  }
}
