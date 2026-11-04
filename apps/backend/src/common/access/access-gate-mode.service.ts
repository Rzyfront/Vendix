import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { AccessGateMode } from './access-audit.types';

export const ACCESS_GATE_ENFORCE_ALL_KEY = 'access_gate:enforce:all';
export const accessGateEnforceStoreKey = (storeId: number) =>
  `access_gate:enforce:store:${storeId}`;

/**
 * apps-f4 flag: `enforce` only when a Redis key says so, otherwise `audit`.
 * No DB, no restart. Redis absent/down → `audit` (fail-open, warns once).
 */
@Injectable()
export class AccessGateModeService {
  private readonly logger = new Logger(AccessGateModeService.name);
  private warned = false;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async modeForStore(storeId: number): Promise<AccessGateMode> {
    try {
      const [all, store] = await Promise.all([
        this.redis.get(ACCESS_GATE_ENFORCE_ALL_KEY),
        this.redis.get(accessGateEnforceStoreKey(storeId)),
      ]);
      return all === '1' || store === '1' ? 'enforce' : 'audit';
    } catch (error) {
      this.warnOnce(error);
      return 'audit';
    }
  }

  async modeForOrganization(): Promise<AccessGateMode> {
    try {
      const all = await this.redis.get(ACCESS_GATE_ENFORCE_ALL_KEY);
      return all === '1' ? 'enforce' : 'audit';
    } catch (error) {
      this.warnOnce(error);
      return 'audit';
    }
  }

  private warnOnce(error: unknown): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(
      `Access gate flag unavailable, falling back to audit: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
