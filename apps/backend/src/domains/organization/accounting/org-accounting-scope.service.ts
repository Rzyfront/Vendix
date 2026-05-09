import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';

import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  OperatingScopeService,
  OrganizationOperatingScope,
} from '@common/services/operating-scope.service';

/**
 * Shared scope helpers for `/api/organization/accounting/*`.
 *
 * Replicates the pattern proven in `OrgSubscriptionsService`:
 *   - `requireOrgId`: pulls the org_id from the JWT-derived RequestContext.
 *   - `assertStoreInOrg`: validates a `store_id` belongs to the current org.
 *   - `runWithStoreContext`: pins a target `store_id` into RequestContext for
 *     the duration of a callback so existing store-scoped services
 *     (`ChartOfAccountsService`, `JournalEntriesService`, …) keep working
 *     unchanged when ORG_ADMIN requests an explicit per-store breakdown.
 *   - `getEffectiveScope`: resolves consolidated vs. per-store mode for the
 *     current org + optional `store_id` filter.
 *
 * The DomainScopeGuard guarantees this code only runs for `app_type=ORG_ADMIN`
 * tokens (super-admin bypass excepted), so we never have to second-guess the
 * caller's domain.
 */
@Injectable()
export class OrgAccountingScopeService {
  private readonly logger = new Logger(OrgAccountingScopeService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly operatingScope: OperatingScopeService,
  ) {}

  /**
   * Resolve and validate the organization in context. Throws when the JWT
   * carries no `organization_id` (defensive — DomainScopeGuard normally
   * blocks this).
   */
  requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new ForbiddenException('Organization context required');
    }
    return orgId;
  }

  /**
   * Asserts the given `store_id` belongs to the current org. Returns the
   * resolved store row (for downstream display needs).
   */
  async assertStoreInOrg(storeId: number) {
    const orgId = this.requireOrgId();
    if (!storeId || !Number.isFinite(storeId)) {
      throw new BadRequestException('store_id is required');
    }
    const store = await this.prisma.stores.findFirst({
      where: { id: storeId, organization_id: orgId },
      select: { id: true, organization_id: true, name: true, slug: true },
    });
    if (!store) {
      throw new ForbiddenException(
        'Store does not belong to the current organization',
      );
    }
    return store;
  }

  /**
   * Run a callback while pinning a target `store_id` into the request
   * context. Used to delegate ORG reads/writes to existing store-side
   * services (chart-of-accounts, journal-entries, fiscal-periods, account
   * mappings) when ORG_ADMIN requests a per-store breakdown or
   * STORE-scoped accounting.
   */
  async runWithStoreContext<T>(
    storeId: number,
    callback: () => Promise<T>,
  ): Promise<T> {
    await this.assertStoreInOrg(storeId);
    const ctx = RequestContextService.getContext();
    if (!ctx) {
      throw new ForbiddenException('Request context not available');
    }
    const previousStoreId = ctx.store_id;
    try {
      RequestContextService.setDomainContext(storeId, ctx.organization_id);
      return await callback();
    } finally {
      // Restore previous store_id (typically undefined for ORG_ADMIN).
      ctx.store_id = previousStoreId;
    }
  }

  /**
   * Resolve the effective scope for the current request:
   *  - If `operating_scope=ORGANIZATION` and no `store_id` filter →
   *    consolidated read across the org.
   *  - If `operating_scope=ORGANIZATION` and a `store_id` filter is provided →
   *    per-store breakdown (validated to belong to the org).
   *  - If `operating_scope=STORE` → `store_id` is required; otherwise we
   *    auto-select when the org has exactly one active store, or raise.
   */
  async resolveEffectiveScope(params: {
    store_id_filter?: number | null;
  }): Promise<{
    organization_id: number;
    operating_scope: OrganizationOperatingScope;
    store_id?: number; // only set when consolidating one specific store
  }> {
    const orgId = this.requireOrgId();
    const operating_scope = await this.operatingScope.requireOperatingScope(
      orgId,
    );
    const store_id_filter = params.store_id_filter ?? null;

    if (operating_scope === 'ORGANIZATION') {
      if (store_id_filter == null) {
        return { organization_id: orgId, operating_scope };
      }
      await this.assertStoreInOrg(store_id_filter);
      return {
        organization_id: orgId,
        operating_scope,
        store_id: store_id_filter,
      };
    }

    // operating_scope === 'STORE'
    if (store_id_filter != null) {
      await this.assertStoreInOrg(store_id_filter);
      return {
        organization_id: orgId,
        operating_scope,
        store_id: store_id_filter,
      };
    }

    // Auto-resolve: pick the only active store if there's exactly one.
    const stores = await this.prisma.stores.findMany({
      where: { organization_id: orgId, is_active: true },
      select: { id: true },
      take: 2,
    });
    if (stores.length === 1) {
      return {
        organization_id: orgId,
        operating_scope,
        store_id: stores[0].id,
      };
    }

    throw new BadRequestException(
      'store_id is required when operating_scope is STORE and the organization has multiple stores',
    );
  }

  /**
   * Convenience: returns the active store_ids of the org (consolidated read
   * helper for `accounting_entries` and similar org-scoped lists).
   */
  async getStoreIdsForOrg(): Promise<number[]> {
    const orgId = this.requireOrgId();
    return this.orgPrisma.getStoreIdsForOrg(orgId);
  }
}
