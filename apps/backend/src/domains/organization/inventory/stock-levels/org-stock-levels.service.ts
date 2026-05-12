import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';

import { OrgStockLevelQueryDto } from './dto/org-stock-level-query.dto';

/**
 * Org-native stock-levels read service.
 *
 * Reads `stock_levels` rows across every store of the organization in
 * context. `stock_levels` is NOT registered in `OrganizationPrismaService`
 * (it is a relational-scope target of `StorePrismaService` only), so we use
 * `GlobalPrismaService` and filter explicitly by:
 *
 *   - `inventory_locations.organization_id = orgId` (consolidation), and
 *   - optionally `inventory_locations.store_id = breakdownStoreId`.
 *
 * Operating scope decides whether `store_id` is optional (ORGANIZATION) or
 * required (STORE). The scope decision is centralised in
 * `OrganizationPrismaService.getScopedWhere`.
 *
 * NOTE: Mutations are intentionally not exposed here. Stock writes for ORG_ADMIN
 * always go through the `/organization/inventory/transfers` flow (already
 * scope-validated by `OperatingScopeService.validateLocationScope`). Direct
 * stock adjustments at org-wide level are out of scope for Phase 2.
 */
@Injectable()
export class OrgStockLevelsService {
  private readonly logger = new Logger(OrgStockLevelsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly operatingScope: OperatingScopeService,
  ) {}

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    return orgId;
  }

  /**
   * Resolves the `store_id`-aware where clause for a given query.
   *
   * Returns `{ organization_id, store_id? }`:
   *   - ORGANIZATION + no store_id → `{ organization_id }` (consolidated)
   *   - ORGANIZATION + store_id    → `{ organization_id, store_id }` (breakdown)
   *   - STORE                      → store_id required, validated against org
   */
  private async resolveScopedWhere(storeIdFilter?: number) {
    const organization_id = this.requireOrgId();
    return this.orgPrisma.getScopedWhere({
      organization_id,
      store_id_filter: storeIdFilter ?? null,
    });
  }

  /**
   * List stock levels across the org. The shape mirrors
   * `/store/inventory/stock-levels` so the frontend table can be reused.
   *
   * The breakdown filter (`store_id`) restricts results to locations of that
   * store; otherwise rows from every store of the org are returned.
   */
  async findAll(query: OrgStockLevelQueryDto) {
    const scoped = await this.resolveScopedWhere(query.store_id);

    const locationFilter = this.buildLocationFilter(scoped);
    const where = {
      ...(query.product_id != null ? { product_id: query.product_id } : {}),
      ...(query.product_variant_id != null
        ? { product_variant_id: query.product_variant_id }
        : {}),
      ...(query.location_id != null ? { location_id: query.location_id } : {}),
      inventory_locations: locationFilter,
    };

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 25;
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      this.prisma.stock_levels.findMany({
        where,
        include: {
          products: { select: { id: true, name: true, sku: true } },
          product_variants: {
            select: { id: true, name: true, sku: true },
          },
          inventory_locations: {
            select: {
              id: true,
              name: true,
              code: true,
              store_id: true,
              stores: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.stock_levels.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toFlatRow(r)),
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / Math.max(limit, 1)),
      },
    };
  }

  /**
   * Flattens Prisma nested relations into the contract expected by the
   * frontend (see `OrgStockLevelRow` in
   * `apps/frontend/.../inventory/services/org-inventory.service.ts`).
   */
  private toFlatRow(row: {
    id: number;
    product_id: number;
    product_variant_id: number | null;
    location_id: number;
    quantity_on_hand: number;
    quantity_reserved: number;
    quantity_available: number;
    reorder_point: number | null;
    products: { id: number; name: string | null; sku: string | null } | null;
    product_variants: {
      id: number;
      name: string | null;
      sku: string | null;
    } | null;
    inventory_locations: {
      id: number;
      name: string | null;
      code: string | null;
      store_id: number | null;
      stores: { id: number; name: string | null } | null;
    } | null;
  }) {
    return {
      id: row.id,
      product_id: row.product_id,
      product_name: row.products?.name ?? null,
      product_sku: row.products?.sku ?? null,
      variant_id: row.product_variant_id,
      variant_name: row.product_variants?.name ?? null,
      variant_sku: row.product_variants?.sku ?? null,
      location_id: row.location_id,
      location_name: row.inventory_locations?.name ?? null,
      location_code: row.inventory_locations?.code ?? null,
      store_id: row.inventory_locations?.store_id ?? null,
      store_name: row.inventory_locations?.stores?.name ?? null,
      quantity: row.quantity_on_hand,
      reserved_quantity: row.quantity_reserved,
      available_quantity: row.quantity_available,
      min_stock_threshold: row.reorder_point,
    };
  }

  async findByProduct(productId: number, query: OrgStockLevelQueryDto) {
    return this.findAll({ ...query, product_id: productId });
  }

  async findByLocation(locationId: number, query: OrgStockLevelQueryDto) {
    const scoped = await this.resolveScopedWhere(query.store_id);
    // Validate that the location belongs to the org/store scope.
    await this.operatingScope.validateLocationScope(
      scoped.organization_id,
      [locationId],
    );
    return this.findAll({ ...query, location_id: locationId });
  }

  /**
   * Stock alerts: rows where quantity_available <= reorder_point.
   * Uses the same org-wide where; cross-store breakdown via `store_id`.
   */
  async getStockAlerts(query: OrgStockLevelQueryDto) {
    const scoped = await this.resolveScopedWhere(query.store_id);
    const locationFilter = this.buildLocationFilter(scoped);
    const where = {
      quantity_available: {
        lte: this.prisma.stock_levels.fields.reorder_point,
      },
      ...(query.product_id != null ? { product_id: query.product_id } : {}),
      ...(query.product_variant_id != null
        ? { product_variant_id: query.product_variant_id }
        : {}),
      ...(query.location_id != null ? { location_id: query.location_id } : {}),
      inventory_locations: locationFilter,
    };

    const data = await this.prisma.stock_levels.findMany({
      where,
      include: {
        products: { select: { id: true, name: true, sku: true } },
        product_variants: {
          select: { id: true, name: true, sku: true },
        },
        inventory_locations: {
          select: { id: true, name: true, code: true, store_id: true },
        },
      },
      orderBy: [{ quantity_available: 'asc' }],
    });

    return { data };
  }

  /**
   * Single row read scoped to the org. Returns `null` if the row exists but
   * its location does not belong to the current org scope.
   */
  async findOne(id: number) {
    const scoped = await this.resolveScopedWhere();
    return this.prisma.stock_levels.findFirst({
      where: {
        id,
        inventory_locations: this.buildLocationFilter(scoped),
      },
      include: {
        products: { select: { id: true, name: true, sku: true } },
        product_variants: {
          select: { id: true, name: true, sku: true },
        },
        inventory_locations: {
          select: { id: true, name: true, code: true, store_id: true },
        },
      },
    });
  }

  /**
   * Builds the relational filter applied to `stock_levels.inventory_locations`
   * to enforce org/store scoping.
   */
  private buildLocationFilter(scoped: {
    organization_id: number;
    store_id?: number;
  }) {
    if (scoped.store_id != null) {
      return {
        organization_id: scoped.organization_id,
        store_id: scoped.store_id,
      };
    }
    return { organization_id: scoped.organization_id };
  }
}
