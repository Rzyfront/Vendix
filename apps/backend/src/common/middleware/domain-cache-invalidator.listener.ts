import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { OnEvent } from '@nestjs/event-emitter';

/**
 * 🔄 Domain Cache Invalidator Listener
 *
 * Invalidates the per-hostname tenant resolution cache populated by
 * `DomainResolverMiddleware` (key: `domain:${hostname}`) whenever a domain's
 * state changes. Without this, a domain update / activation / disablement
 * would leave stale resolutions in Redis for up to 5 minutes (the middleware's
 * TTL), causing requests to hit the wrong tenant or a deactivated store.
 *
 * NOTE: This is a separate companion to `DynamicCorsService.onDomainStateChange`
 * which invalidates a different cache key (`cors:allowed_origins`). Both must
 * fire on the same events.
 *
 * The middleware is intentionally NOT modified to host these handlers because
 * NestJS middleware classes are not guaranteed to be singletons available
 * to the EventEmitter (they are instantiated per-request when used as classes).
 * A dedicated `@Injectable()` provider is the safe pattern.
 */
export interface DomainStateChangedPayload {
  hostname: string;
  domainId: number;
  organizationId?: number;
  storeId?: number;
}

@Injectable()
export class DomainCacheInvalidatorListener {
  private readonly logger = new Logger(DomainCacheInvalidatorListener.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  @OnEvent('domain.activated')
  async onDomainActivated(payload: DomainStateChangedPayload) {
    await this.invalidate(payload, 'activated');
  }

  @OnEvent('domain.disabled')
  async onDomainDisabled(payload: DomainStateChangedPayload) {
    await this.invalidate(payload, 'disabled');
  }

  @OnEvent('domain.updated')
  async onDomainUpdated(payload: DomainStateChangedPayload) {
    await this.invalidate(payload, 'updated');
  }

  private async invalidate(
    payload: DomainStateChangedPayload,
    reason: string,
  ): Promise<void> {
    if (!payload?.hostname) {
      this.logger.warn(`domain.${reason} sin hostname en payload — skip`);
      return;
    }
    const key = `domain:${payload.hostname}`;
    try {
      await this.cache.del(key);
      this.logger.log(`Cache invalidada (${reason}): ${key}`);
    } catch (err) {
      this.logger.error(
        `Error invalidando cache ${key}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
