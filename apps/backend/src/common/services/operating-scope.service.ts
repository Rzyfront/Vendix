import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { location_type_enum } from '@prisma/client';
import { RequestContextService } from '../context/request-context.service';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';

export type OrganizationOperatingScope = 'STORE' | 'ORGANIZATION';

export interface ResolveAccountingEntityParams {
  organization_id: number;
  store_id?: number | null;
  tx?: any;
}

export interface EnforceLocationAccessOptions {
  /**
   * When `true`, central-warehouse locations (is_central_warehouse=true) are
   * allowed. Default `false` — store-scoped callers must NEVER reach the
   * org-level central warehouse, only ORG-scope endpoints may opt in.
   */
  allowCentral?: boolean;
  /**
   * When `true`, validates that the location's `store_id` matches the
   * current request store context (`RequestContextService.getStoreId()`).
   * Use from store-scoped services where the location must belong to the
   * caller's store.
   */
  requireStoreOwnership?: boolean;
  /** Optional Prisma transaction client. */
  tx?: any;
}

interface ScopeCacheEntry {
  scope: OrganizationOperatingScope;
  expires_at: number;
}

@Injectable()
export class OperatingScopeService {
  /**
   * In-process cache for `operating_scope` lookups to avoid hitting the DB on
   * every request. TTL is intentionally short (≤60s) — long enough to coalesce
   * bursts within a request lifecycle, short enough to converge after a wizard
   * change. The Phase 4 wizard MUST call {@link invalidateScopeCache} after
   * persisting a new scope so other workers don't observe a stale value beyond
   * the TTL.
   */
  private readonly scopeCacheTtlMs = 30_000;
  private readonly scopeCache = new Map<number, ScopeCacheEntry>();

  constructor(private readonly prisma: StorePrismaService) {}

  async getOperatingScope(
    organization_id: number,
    tx?: any,
  ): Promise<OrganizationOperatingScope> {
    // When inside a transaction we never hit the cache (the tx may see
    // uncommitted writes the cache has not learned about).
    if (!tx) {
      const cached = this.scopeCache.get(organization_id);
      if (cached && cached.expires_at > Date.now()) {
        return cached.scope;
      }
    }

    const client = tx || this.prisma.withoutScope();
    const organization = await client.organizations.findUnique({
      where: { id: organization_id },
      select: { operating_scope: true, account_type: true },
    });

    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    const resolved: OrganizationOperatingScope = organization.operating_scope
      ? (organization.operating_scope as OrganizationOperatingScope)
      : organization.account_type === 'MULTI_STORE_ORG'
        ? 'ORGANIZATION'
        : 'STORE';

    if (!tx) {
      this.scopeCache.set(organization_id, {
        scope: resolved,
        expires_at: Date.now() + this.scopeCacheTtlMs,
      });
    }

    return resolved;
  }

  /**
   * Strict alias of {@link getOperatingScope} that throws {@link NotFoundException}
   * when the organization does not exist (vs {@link BadRequestException}).
   *
   * Use from controllers/services that treat scope resolution as a precondition
   * (Fase 2-3 — endpoints `/organization/*` y guards de scope).
   */
  async requireOperatingScope(
    organization_id: number,
    tx?: any,
  ): Promise<OrganizationOperatingScope> {
    if (!organization_id || !Number.isFinite(organization_id)) {
      throw new BadRequestException('organization_id is required');
    }

    try {
      return await this.getOperatingScope(organization_id, tx);
    } catch (error) {
      if (
        error instanceof BadRequestException &&
        /Organization not found/i.test(error.message)
      ) {
        throw new NotFoundException(`Organization ${organization_id} not found`);
      }
      throw error;
    }
  }

  /**
   * Cross-store transfer policy guard (Fase 2 Stock Transfers).
   *
   * - operating_scope=STORE → cualquier transfer cuyo source y dest store difieran
   *   se rechaza con 400. Cross-store requiere flujo intercompañía futuro.
   * - operating_scope=ORGANIZATION → permitido si ambos stores pertenecen a la
   *   misma org (el caller debe validar pertenencia con `validateLocationScope`).
   */
  async assertCrossStoreTransferAllowed(
    organization_id: number,
    source_store_id: number,
    dest_store_id: number,
    tx?: any,
  ): Promise<void> {
    if (
      source_store_id == null ||
      dest_store_id == null ||
      !Number.isFinite(source_store_id) ||
      !Number.isFinite(dest_store_id)
    ) {
      throw new BadRequestException(
        'source_store_id and dest_store_id are required for transfer scope check',
      );
    }

    if (source_store_id === dest_store_id) {
      return; // intra-store: siempre permitido.
    }

    const scope = await this.getOperatingScope(organization_id, tx);
    if (scope === 'STORE') {
      throw new BadRequestException(
        'Cross-store transfers are not allowed when operating_scope is STORE',
      );
    }
  }

  /**
   * Invalida la entrada de cache para una organización. Llamar **siempre**
   * después de persistir un cambio de `operating_scope` (Fase 4 wizard) para
   * que las requests subsiguientes lean el valor nuevo.
   */
  invalidateScopeCache(organization_id: number): void {
    this.scopeCache.delete(organization_id);
  }

  async resolveAccountingEntity(params: ResolveAccountingEntityParams) {
    const client = params.tx || this.prisma.withoutScope();
    const scope = await this.getOperatingScope(params.organization_id, client);

    if (scope === 'ORGANIZATION') {
      return this.ensureOrganizationAccountingEntity(
        params.organization_id,
        client,
      );
    }

    const storeId = await this.resolveStoreIdForStoreScope(
      params.organization_id,
      params.store_id ?? null,
      client,
    );

    return this.ensureStoreAccountingEntity(params.organization_id, storeId, client);
  }

  async validateLocationScope(
    organization_id: number,
    location_ids: number[],
    tx?: any,
  ) {
    const client = tx || this.prisma.withoutScope();
    const scope = await this.getOperatingScope(organization_id, client);
    const locations = await client.inventory_locations.findMany({
      where: { id: { in: location_ids } },
      select: { id: true, organization_id: true, store_id: true },
    });

    if (locations.length !== location_ids.length) {
      throw new BadRequestException('Inventory location not found');
    }

    if (locations.some((location) => location.organization_id !== organization_id)) {
      throw new BadRequestException(
        'Inventory locations must belong to the current organization',
      );
    }

    if (scope === 'ORGANIZATION') {
      return { scope, locations };
    }

    const storeIds = new Set(locations.map((location) => location.store_id));
    if (storeIds.size !== 1 || storeIds.has(null)) {
      throw new BadRequestException(
        'Store-scoped inventory operations must use locations from the same store',
      );
    }

    return { scope, locations };
  }

  /**
   * Per-location access guard for inventory operations (Plan P1.2).
   *
   * Validates that the given `location_id` belongs to the organization and,
   * depending on `options`, enforces additional rules:
   *
   * - `allowCentral` (default `false`): central-warehouse locations
   *   (`is_central_warehouse = true`) are rejected unless explicitly allowed.
   *   ORG-scope endpoints opt in; STORE-scope callers MUST NOT.
   * - `requireStoreOwnership` (default `false`): the location's `store_id`
   *   must equal the current request store context. Use from store-scoped
   *   services to prevent cross-store access on a per-location basis.
   *
   * Throws {@link ForbiddenException} on any violation. Returns the location
   * row with the fields callers need to make follow-up decisions (scope,
   * type, central flag).
   */
  /**
   * Find the active central warehouse for an organization (Plan P3.4).
   *
   * Returns `null` when the org has no central warehouse configured. Callers
   * that REQUIRE a central warehouse (e.g. ecommerce reservation in
   * ORGANIZATION scope) should treat `null` as a misconfiguration and throw
   * `CENTRAL_WAREHOUSE_NOT_CONFIGURED`.
   *
   * Schema invariants (M2):
   *   - At most ONE row per organization with `is_central_warehouse = TRUE`
   *     (DB-enforced unique partial index `inventory_locations_one_central_per_org`).
   *   - Central warehouses have `store_id IS NULL` (DB CHECK
   *     `inventory_locations_central_no_store_chk`).
   */
  async findCentralWarehouse(
    organization_id: number,
    tx?: any,
  ): Promise<{
    id: number;
    organization_id: number;
    store_id: number | null;
    name: string;
    code: string;
  } | null> {
    const client = tx ?? this.prisma.withoutScope();
    return client.inventory_locations.findFirst({
      where: {
        organization_id,
        is_central_warehouse: true,
        is_active: true,
      },
      select: {
        id: true,
        organization_id: true,
        store_id: true,
        name: true,
        code: true,
      },
    });
  }

  async enforceLocationAccess(
    organization_id: number,
    location_id: number,
    options: EnforceLocationAccessOptions = {},
  ): Promise<{
    id: number;
    organization_id: number;
    store_id: number | null;
    is_central_warehouse: boolean;
    type: location_type_enum;
  }> {
    const client = options.tx ?? this.prisma.withoutScope();
    const location = await client.inventory_locations.findFirst({
      where: { id: location_id, organization_id },
      select: {
        id: true,
        organization_id: true,
        store_id: true,
        is_central_warehouse: true,
        type: true,
      },
    });

    if (!location) {
      throw new ForbiddenException(
        `Location ${location_id} no pertenece a la organización`,
      );
    }

    if (location.is_central_warehouse && !options.allowCentral) {
      throw new ForbiddenException(
        'Bodega central solo accesible desde ORG scope',
      );
    }

    if (options.requireStoreOwnership) {
      const currentStoreId = RequestContextService.getStoreId();
      if (location.store_id !== currentStoreId) {
        throw new ForbiddenException(
          `Location ${location_id} no pertenece a esta tienda`,
        );
      }
    }

    return location;
  }

  private async ensureOrganizationAccountingEntity(
    organization_id: number,
    client: any,
  ) {
    const existing = await client.accounting_entities.findFirst({
      where: {
        organization_id,
        store_id: null,
        scope: 'ORGANIZATION',
        is_active: true,
      },
    });

    if (existing) return existing;

    const organization = await client.organizations.findUnique({
      where: { id: organization_id },
      select: { name: true, legal_name: true, tax_id: true },
    });

    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    return client.accounting_entities.create({
      data: {
        organization_id,
        store_id: null,
        scope: 'ORGANIZATION',
        name: organization.name,
        legal_name: organization.legal_name,
        tax_id: organization.tax_id,
      },
    });
  }

  private async ensureStoreAccountingEntity(
    organization_id: number,
    store_id: number,
    client: any,
  ) {
    const existing = await client.accounting_entities.findFirst({
      where: {
        organization_id,
        store_id,
        scope: 'STORE',
        is_active: true,
      },
    });

    if (existing) return existing;

    const store = await client.stores.findFirst({
      where: { id: store_id, organization_id },
      select: {
        id: true,
        name: true,
        organizations: { select: { legal_name: true, tax_id: true } },
      },
    });

    if (!store) {
      throw new BadRequestException('Store not found for accounting entity');
    }

    return client.accounting_entities.create({
      data: {
        organization_id,
        store_id: store.id,
        scope: 'STORE',
        name: store.name,
        legal_name: store.organizations?.legal_name || store.name,
        tax_id: store.organizations?.tax_id || null,
      },
    });
  }

  private async resolveStoreIdForStoreScope(
    organization_id: number,
    store_id: number | null,
    client: any,
  ): Promise<number> {
    if (store_id) {
      const store = await client.stores.findFirst({
        where: { id: store_id, organization_id, is_active: true },
        select: { id: true },
      });

      if (!store) {
        throw new BadRequestException(
          'Store does not belong to the current organization',
        );
      }

      return store.id;
    }

    const stores = await client.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
      take: 2,
    });

    if (stores.length === 1) return stores[0].id;

    throw new BadRequestException(
      'Store-scoped accounting requires a store context',
    );
  }
}
