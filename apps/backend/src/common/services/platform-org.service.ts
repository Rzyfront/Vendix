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
          select: { id: true, store_id: true, scope: true, fiscal_scope: true },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!org) {
      this.logger.warn(
        `Platform org id=${organization_id} not found in DB. Cache and env may be stale.`,
      );
      return null;
    }

    const fiscal_scope = org.fiscal_scope as 'STORE' | 'ORGANIZATION';
    const accounting_entity_id = this.selectFiscalEntityId(
      organization_id,
      fiscal_scope,
      org.accounting_entities,
    );

    const context: PlatformOrgContext = {
      organization_id: org.id,
      accounting_entity_id,
      fiscal_scope,
      operating_scope: org.operating_scope as 'STORE' | 'ORGANIZATION',
    };

    this.cache.set(organization_id, {
      context,
      expires_at: Date.now() + this.cacheTtlMs,
    });

    return context;
  }

  /**
   * Picks the entity that the SCOPED Prisma client will also resolve for this
   * organization, instead of "the first active one".
   *
   * ## The defect this closes
   *
   * This method used to be `accounting_entities.where(is_active).take(1)` with no
   * ordering and no scope filter. `StorePrismaService`, which is what actually
   * filters every query, derives the fiscal entity from `organizations.fiscal_scope`:
   * `ORGANIZATION` demands `store_id IS NULL AND scope = ORGANIZATION`, `STORE`
   * demands the entity of the store in context.
   *
   * For the Vendix platform org — `fiscal_scope = ORGANIZATION`, with one
   * ORGANIZATION entity plus one STORE entity per platform store — the two
   * resolvers disagreed: this one returned a STORE entity, the scope only ever
   * saw the ORGANIZATION one. Everything written under the first (platform DIAN
   * config, the habilitación numbering resolution) became invisible to every
   * scoped read, surfacing as `404 Resolution not found` on a row that plainly
   * exists — a failure no value the operator types can fix, because the two
   * sides never agree.
   *
   * `invoice_resolutions` carries `accounting_entity_id` as NOT NULL and is
   * registered as fiscal-entity scoped, so the mismatch is total: the scope
   * injects `accounting_entity_id = <derived>` and no `where: { id }` can escape it.
   */
  private selectFiscalEntityId(
    organization_id: number,
    fiscal_scope: 'STORE' | 'ORGANIZATION',
    entities: Array<{
      id: number;
      store_id: number | null;
      scope: string;
      fiscal_scope: string;
    }>,
  ): number {
    if (!entities.length) {
      throw new Error(
        `Platform org id=${organization_id} has no active accounting_entity. ` +
          `Run the vendix-platform-org seed to bootstrap.`,
      );
    }

    if (fiscal_scope === 'ORGANIZATION') {
      const consolidated = entities.find(
        (entity) =>
          entity.store_id === null &&
          entity.scope === 'ORGANIZATION' &&
          entity.fiscal_scope === 'ORGANIZATION',
      );
      if (consolidated) return consolidated.id;

      // Deliberately a hard failure rather than falling back to a store entity.
      // A store entity here is what produced the invisible-row bug, and it would
      // reappear the moment anything is written under it.
      throw new Error(
        `Platform org id=${organization_id} has fiscal_scope=ORGANIZATION but no active ` +
          `consolidated accounting_entity (store_id NULL, scope ORGANIZATION). ` +
          `The scoped Prisma client resolves that exact row, so fiscal writes would be ` +
          `invisible to every read. Create it in Identidad fiscal or run the ` +
          `vendix-platform-org seed.`,
      );
    }

    // fiscal_scope = STORE: mirror the scoped client, which requires a store in
    // context. Ordered by id so the answer is deterministic across calls.
    const store_entity = entities.find(
      (entity) =>
        entity.store_id !== null &&
        entity.scope === 'STORE' &&
        entity.fiscal_scope === 'STORE',
    );
    if (store_entity) return store_entity.id;

    throw new Error(
      `Platform org id=${organization_id} has fiscal_scope=STORE but no active ` +
        `store-scoped accounting_entity.`,
    );
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
