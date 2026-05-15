import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import type { Cache } from 'cache-manager';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';

/**
 * Dynamic CORS allowlist backed by `domain_settings`.
 *
 * - On boot, loads every hostname with `status = 'active'` and caches the
 *   resulting `https://<hostname>` / `http://<hostname>` origins in Redis (60s TTL).
 * - `isAllowed(origin)` first checks the static `*.<BASE_DOMAIN>` regex
 *   (so the platform's own subdomains never depend on DB state) and then
 *   falls back to the dynamic allowlist.
 * - Listens to `domain.activated` / `domain.disabled` events to invalidate
 *   the cache lazily.
 *
 * The service is wired into `main.ts` after the static platform-domain checks,
 * so active custom domains can call the API without manual CORS env updates.
 */
@Injectable()
export class DynamicCorsService implements OnModuleInit {
  private readonly logger = new Logger(DynamicCorsService.name);
  private readonly CACHE_KEY = 'cors:allowed_origins';
  private readonly CACHE_TTL_SECONDS = 60;
  private readonly STATIC_REGEX: RegExp;

  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly prisma: GlobalPrismaService,
  ) {
    const baseDomain =
      this.configService.get<string>('BASE_DOMAIN') || 'vendix.online';
    const escaped = baseDomain.replace(/\./g, '\\.');
    // Matches the base domain itself plus any single-label subdomain.
    this.STATIC_REGEX = new RegExp(`^https?://([a-zA-Z0-9-]+\\.)?${escaped}$`);
  }

  async onModuleInit(): Promise<void> {
    await this.refreshCache();
  }

  /**
   * Returns true if the given Origin header is allowed.
   * Returns false for empty/undefined origins (callers should typically
   * allow same-origin / no-Origin requests separately).
   */
  async isAllowed(origin: string | undefined | null): Promise<boolean> {
    if (!origin) return false;
    if (this.STATIC_REGEX.test(origin)) return true;
    const allowed = await this.getAllowedOrigins();
    return allowed.includes(origin);
  }

  /**
   * Exposed for diagnostics and for the future CORS callback.
   */
  async getAllowedOrigins(): Promise<string[]> {
    const cached = await this.cache.get<string[]>(this.CACHE_KEY);
    if (cached) return cached;
    return this.refreshCache();
  }

  private async refreshCache(): Promise<string[]> {
    try {
      const rows = await this.prisma.domain_settings.findMany({
        where: { status: 'active' },
        select: { hostname: true },
      });
      const origins = rows.flatMap((r) => [
        `https://${r.hostname}`,
        `http://${r.hostname}`,
      ]);
      // cache-manager (>=5) accepts TTL in milliseconds.
      await this.cache.set(
        this.CACHE_KEY,
        origins,
        this.CACHE_TTL_SECONDS * 1000,
      );
      this.logger.log(
        `Loaded ${origins.length} CORS allowed origins from DB (${rows.length} active hostnames)`,
      );
      return origins;
    } catch (err) {
      this.logger.error('Failed to refresh CORS allowlist', err as Error);
      return [];
    }
  }

  @OnEvent('domain.activated')
  @OnEvent('domain.disabled')
  async onDomainStateChange(payload: { hostname?: string }): Promise<void> {
    this.logger.log(
      `Invalidating CORS cache due to domain state change: ${payload?.hostname ?? '<unknown>'}`,
    );
    await this.cache.del(this.CACHE_KEY);
    // Lazy refresh: the next isAllowed() call will rebuild the list. We
    // intentionally do NOT await refreshCache() here to keep the event
    // handler fast and avoid a thundering herd if many events fire.
  }
}
