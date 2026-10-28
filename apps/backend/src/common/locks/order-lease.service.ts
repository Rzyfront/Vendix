import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ErrorCodes, VendixHttpException } from '../errors';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RequestContextService } from '../context/request-context.service';

/** Lease lifetime. Long enough for one DIAN emission, short enough to self-heal. */
export const ORDER_LEASE_TTL_SECONDS = 120;

export interface OrderLeaseHandle {
  release(): Promise<void>;
}

const RELEASE_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

/**
 * Short per-order Redis lease (`SET NX EX`) so two processes — bulk invoicing,
 * bulk transition, bulk route assignment, single-order emission — never work
 * on the same order at once. A DB advisory lock is not usable here: emission
 * calls the DIAN and cannot keep a transaction open.
 *
 * - Key scoped by store and order: `lease:order:{store_id}:{order_id}`.
 * - Release is compare-and-delete, so an expired lease re-taken by someone
 *   else is never released by the previous holder.
 * - Re-entrant inside the same async flow (bulk execute → `emitOrder`).
 * - Fails open when Redis is unreachable: the lease is a collision guard, and
 *   an infrastructure blip must not stop invoicing (the emission engine stays
 *   idempotent on its own).
 */
@Injectable()
export class OrderLeaseService {
  private readonly logger = new Logger(OrderLeaseService.name);
  private readonly held = new AsyncLocalStorage<Set<string>>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(order_id: number): string {
    const store_id = RequestContextService.getStoreId();
    return `lease:order:${store_id ?? 'none'}:${order_id}`;
  }

  async isHeld(order_id: number): Promise<boolean> {
    try {
      return (await this.redis.get(this.key(order_id))) != null;
    } catch (error) {
      this.logger.warn(`Lease read failed for order ${order_id}: ${String(error)}`);
      return false;
    }
  }

  /** Takes the lease; `null` when another operation holds it. */
  async acquire(order_id: number): Promise<OrderLeaseHandle | null> {
    const key = this.key(order_id);
    if (this.held.getStore()?.has(key)) return { release: async () => undefined };

    const token = randomUUID();
    try {
      const ok = await this.redis.set(
        key,
        token,
        'EX',
        ORDER_LEASE_TTL_SECONDS,
        'NX',
      );
      if (ok !== 'OK') return null;
    } catch (error) {
      this.logger.warn(
        `Lease acquire failed for order ${order_id} (failing open): ${String(error)}`,
      );
      return { release: async () => undefined };
    }
    return {
      release: async () => {
        try {
          await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
        } catch (error) {
          this.logger.warn(
            `Lease release failed for order ${order_id}: ${String(error)}`,
          );
        }
      },
    };
  }

  /** Runs `fn` under the lease or throws `ORDERS_BULK_LOCKED_001` when held. */
  async withLease<T>(order_id: number, fn: () => Promise<T>): Promise<T> {
    const key = this.key(order_id);
    if (this.held.getStore()?.has(key)) return fn();

    const handle = await this.acquire(order_id);
    if (!handle) {
      throw new VendixHttpException(ErrorCodes.ORDERS_BULK_LOCKED_001, undefined, {
        order_id,
      });
    }
    const keys = new Set(this.held.getStore() ?? []);
    keys.add(key);
    try {
      return await this.held.run(keys, fn);
    } finally {
      await handle.release();
    }
  }
}
