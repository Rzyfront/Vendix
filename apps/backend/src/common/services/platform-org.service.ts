import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';

export interface PlatformOrgContext {
  organization_id: number;
  accounting_entity_id: number;
  fiscal_scope: 'STORE' | 'ORGANIZATION';
  operating_scope: 'STORE' | 'ORGANIZATION';
}

interface PlatformOrgCacheEntry {
  context: PlatformOrgContext;
  expires_at: number;
}

/**
 * PlatformOrgService — central resolver for the Vendix platform organization.
 *
 * Vendix itself (the SaaS company) is represented as one row in `organizations`
 * with `is_platform = TRUE`. All VENDIX_ADMIN fiscal operations (chart of
 * accounts, journal entries, reports, obligations, declarations) read and
 * write through this org.
 *
 * Resolution order (cached 30s in-memory):
 *   1. `organizations` row where `is_platform = TRUE` (authoritative, set by
 *      the `vendix-platform-org` seed).
 *   2. Falls back to env var `VENDIX_PLATFORM_ORG_ID` for environments where
 *      the seed has not run yet (matching the pattern used by
 *      `subscription-accounting.listener.ts`).
 *
 * Idempotency: re-running the resolver is safe and side-effect free; the
 * cache is invalidated implicitly by TTL and by the explicit `clearCache()`
 * helper used by tests and by the seed itself.
 */
@Injectable()
export class PlatformOrgService {
  private readonly logger = new Logger(PlatformOrgService.name);
  private readonly cacheTtlMs = 30_000;
  private readonly cache = new Map<number, PlatformOrgCacheEntry>();

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Returns the platform organization id, or null when neither the row nor
   * the env var is set. The caller is expected to handle the null case
   * (e.g. emit a warning and skip the platform-side entry).
   */
  async getPlatformOrganizationId(): Promise<number | null> {
    const fromDb = await this.prisma.withoutScope().organizations.findFirst({
      where: { is_platform: true },
      select: { id: true },
    });
    if (fromDb?.id) return fromDb.id;

    const envValue = process.env.VENDIX_PLATFORM_ORG_ID;
    if (envValue) {
      const parsed = parseInt(envValue, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }

    return null;
  }

  /**
   * Returns the platform org + its active consolidated accounting entity, or
   * null when the platform org is not bootstrapped yet. Throws when the
   * platform org exists but has no active accounting entity — that is an
   * inconsistent state that callers should not silently paper over.
   */
  async getPlatformContext(): Promise<PlatformOrgContext | null> {
    const organization_id = await this.getPlatformOrganizationId();
    if (!organization_id) return null;

    const cached = this.cache.get(organization_id);
    if (cached && cached.expires_at > Date.now()) return cached.context;

    const org = await this.prisma.withoutScope().organizations.findUnique({
      where: { id: organization_id },
      select: {
        id: true,
        fiscal_scope: true,
        operating_scope: true,
        accounting_entities: {
          where: { is_active: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!org) {
      this.logger.warn(
        `Platform org id=${organization_id} not found in DB. Cache and env may be stale.`,
      );
      return null;
    }

    const accounting_entity = org.accounting_entities[0];
    if (!accounting_entity) {
      throw new Error(
        `Platform org id=${organization_id} has no active accounting_entity. ` +
          `Run the vendix-platform-org seed to bootstrap.`,
      );
    }

    const context: PlatformOrgContext = {
      organization_id: org.id,
      accounting_entity_id: accounting_entity.id,
      fiscal_scope: org.fiscal_scope as 'STORE' | 'ORGANIZATION',
      operating_scope: org.operating_scope as 'STORE' | 'ORGANIZATION',
    };

    this.cache.set(organization_id, {
      context,
      expires_at: Date.now() + this.cacheTtlMs,
    });

    return context;
  }

  /**
   * Convenience for callers that want to fail fast when the platform org is
   * not bootstrapped (e.g. a SaaS auto-entry listener).
   */
  async requirePlatformContext(): Promise<PlatformOrgContext> {
    const ctx = await this.getPlatformContext();
    if (!ctx) {
      throw new Error(
        'Vendix platform organization is not bootstrapped. ' +
          'Run `npm run db:seed -w apps/backend` (the vendix-platform-org seed).',
      );
    }
    return ctx;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
