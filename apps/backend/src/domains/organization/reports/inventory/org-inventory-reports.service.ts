import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  CostingMethodResolverService,
  ResolvedCostingMethod,
} from '../../../store/inventory/shared/services/costing-method-resolver.service';

/**
 * Reportes de inventario consolidados para ORG_ADMIN.
 *
 * Consolida `stock_levels` cruzando `inventory_locations` que pertenecen a las
 * tiendas de la organización. Con `store_id` opcional se restringe a las
 * ubicaciones de una sola tienda (breakdown).
 *
 * NOTA importante: `stock_levels` no tiene `organization_id`/`store_id`
 * directamente — la tenancy se hereda vía `inventory_locations`. Por eso
 * todas las queries filtran por `location.organization_id`/`location.store_id`.
 */
@Injectable()
export class OrgInventoryReportsService {
  private readonly logger = new Logger(OrgInventoryReportsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly operatingScope: OperatingScopeService,
    private readonly costingResolver: CostingMethodResolverService,
  ) {}

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new ForbiddenException('Organization context required');
    }
    return orgId;
  }

  /**
   * Resuelve el filtro de ubicaciones según operating_scope + store_id opcional.
   * Devuelve un `Prisma.inventory_locationsWhereInput` que se puede embeber
   * en `stock_levels.location.is`.
   */
  private async resolveLocationWhere(
    store_id_filter?: number | null,
  ): Promise<{
    organization_id: number;
    location_where: Prisma.inventory_locationsWhereInput;
  }> {
    const organization_id = this.requireOrgId();
    const scope = await this.operatingScope.requireOperatingScope(
      organization_id,
    );

    if (store_id_filter != null) {
      // Validar pertenencia de la tienda a la org (lanza BadRequestException
      // si no es válida).
      await this.orgPrisma.getScopedWhere({
        organization_id,
        store_id_filter,
      });
      return {
        organization_id,
        location_where: { organization_id, store_id: store_id_filter },
      };
    }

    if (scope === 'STORE') {
      // En STORE scope, store_id_filter es obligatorio.
      await this.orgPrisma.getScopedWhere({
        organization_id,
        store_id_filter: null,
      });
    }

    return {
      organization_id,
      location_where: { organization_id },
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reports
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Resumen de stock: SKUs únicos, unidades on-hand/reserved/available y
   * ubicaciones distintas dentro del scope.
   */
  async getStockSummary(params: { store_id?: number }) {
    const { location_where } = await this.resolveLocationWhere(
      params.store_id ?? null,
    );

    const [aggregate, locationCount, distinctProducts] = await Promise.all([
      this.prisma.stock_levels.aggregate({
        where: { inventory_locations: location_where },
        _sum: {
          quantity_on_hand: true,
          quantity_reserved: true,
          quantity_available: true,
        },
        _count: { _all: true },
      }),
      this.prisma.inventory_locations.count({ where: location_where }),
      this.prisma.stock_levels.findMany({
        where: { inventory_locations: location_where },
        distinct: ['product_id'],
        select: { product_id: true },
      }),
    ]);

    return {
      total_skus: aggregate._count._all,
      distinct_products: distinctProducts.length,
      total_locations: locationCount,
      total_quantity_on_hand: aggregate._sum.quantity_on_hand ?? 0,
      total_quantity_reserved: aggregate._sum.quantity_reserved ?? 0,
      total_quantity_available: aggregate._sum.quantity_available ?? 0,
    };
  }

  /**
   * Stock por tienda. Útil para que la org vea cuánto stock total mantiene
   * cada tienda. En consolidación, agrega ubicaciones org-only (`store_id =
   * null`) bajo un renglón virtual "Sin tienda asignada".
   */
  async getStockByStore(params: { store_id?: number }) {
    const { organization_id, location_where } = await this.resolveLocationWhere(
      params.store_id ?? null,
    );

    const grouped = await this.prisma.stock_levels.groupBy({
      by: ['location_id'],
      where: { inventory_locations: location_where },
      _sum: {
        quantity_on_hand: true,
        quantity_reserved: true,
        quantity_available: true,
      },
    });

    const locationIds = grouped.map((g) => g.location_id);
    const locations = await this.prisma.inventory_locations.findMany({
      where: { id: { in: locationIds } },
      select: { id: true, store_id: true },
    });
    const locationMap = new Map(locations.map((l) => [l.id, l]));

    // Acumular por store_id.
    const byStore = new Map<
      number | 'org',
      {
        store_id: number | null;
        on_hand: number;
        reserved: number;
        available: number;
        location_count: number;
      }
    >();

    for (const row of grouped) {
      const loc = locationMap.get(row.location_id);
      const key: number | 'org' = loc?.store_id ?? 'org';
      const existing = byStore.get(key) ?? {
        store_id: loc?.store_id ?? null,
        on_hand: 0,
        reserved: 0,
        available: 0,
        location_count: 0,
      };
      existing.on_hand += row._sum.quantity_on_hand ?? 0;
      existing.reserved += row._sum.quantity_reserved ?? 0;
      existing.available += row._sum.quantity_available ?? 0;
      existing.location_count += 1;
      byStore.set(key, existing);
    }

    const storeIds = [...byStore.keys()].filter(
      (k): k is number => typeof k === 'number',
    );
    const stores = storeIds.length
      ? await this.prisma.stores.findMany({
          where: { id: { in: storeIds }, organization_id },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const storeMap = new Map(stores.map((s) => [s.id, s]));

    return [...byStore.values()]
      .map((row) => {
        const store = row.store_id != null ? storeMap.get(row.store_id) : null;
        return {
          store_id: row.store_id,
          store_name: store?.name ?? 'Sin tienda asignada',
          store_slug: store?.slug ?? null,
          location_count: row.location_count,
          quantity_on_hand: row.on_hand,
          quantity_reserved: row.reserved,
          quantity_available: row.available,
        };
      })
      .sort((a, b) => b.quantity_available - a.quantity_available);
  }

  /**
   * Productos con stock por debajo del `reorder_point` configurado en
   * `stock_levels.reorder_point`. Devuelve hasta 100 SKUs en riesgo.
   */
  async getLowStock(params: { store_id?: number; limit?: number }) {
    const { location_where } = await this.resolveLocationWhere(
      params.store_id ?? null,
    );
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);

    const items = await this.prisma.stock_levels.findMany({
      where: {
        inventory_locations: location_where,
        reorder_point: { not: null },
      },
      include: {
        products: { select: { id: true, name: true, sku: true } },
        product_variants: { select: { id: true, sku: true, name: true } },
        inventory_locations: {
          select: { id: true, name: true, store_id: true },
        },
      },
      take: 500,
    });

    return items
      .filter(
        (item) =>
          item.reorder_point != null &&
          item.quantity_available <= item.reorder_point,
      )
      .slice(0, limit)
      .map((item) => ({
        product_id: item.product_id,
        product_name: item.products?.name ?? '—',
        product_sku: item.products?.sku ?? null,
        variant_id: item.product_variant_id,
        variant_sku: item.product_variants?.sku ?? null,
        variant_name: item.product_variants?.name ?? null,
        location_id: item.location_id,
        location_name: item.inventory_locations?.name ?? '—',
        store_id: item.inventory_locations?.store_id ?? null,
        quantity_available: item.quantity_available,
        reorder_point: item.reorder_point,
        deficit: Math.max(
          0,
          (item.reorder_point ?? 0) - item.quantity_available,
        ),
      }));
  }

  /**
   * Valuación de inventario sensible al `costing_method` configurado.
   *
   * Plan Unificado P3.6 (decisión §13#6 — "Fallback a weighted_average con
   * badge en UI"):
   *
   *   - Resuelve el método efectivo via `CostingMethodResolverService`
   *     (precedencia ORG → STORE → default `weighted_average`).
   *   - FIFO → suma sobre `inventory_cost_layers` (`quantity_remaining * unit_cost`).
   *     Si la org no tiene capas con stock disponible, cae a CPP/WA y marca
   *     `partial_data: true` para que el frontend pinte el badge.
   *   - Weighted average → suma sobre `stock_levels`
   *     (`quantity_on_hand * cost_per_unit`).
   *
   * El payload SIEMPRE distingue `method` (el realmente usado) vs
   * `requested_method` (el configurado), para que la fallback no cambie el
   * comportamiento silenciosamente.
   */
  async getValuationSnapshot(params: { store_id?: number }) {
    const { organization_id, location_where } = await this.resolveLocationWhere(
      params.store_id ?? null,
    );

    const requestedMethod = await this.costingResolver.resolveCostingMethod(
      organization_id,
      params.store_id ?? undefined,
    );

    if (requestedMethod === 'fifo') {
      const fifoResult = await this.computeFifoValuation({
        organization_id,
        store_id_filter: params.store_id ?? null,
      });

      if (fifoResult.has_layers) {
        return {
          method: 'fifo' as ResolvedCostingMethod,
          requested_method: 'fifo' as ResolvedCostingMethod,
          partial_data: false,
          is_authoritative: true,
          source: 'inventory_cost_layers' as const,
          total_value: fifoResult.total_value,
          by_store: fifoResult.by_store,
          items_count: fifoResult.items_count,
          note: 'Valuación FIFO autoritativa sobre inventory_cost_layers (quantity_remaining * unit_cost).',
        };
      }

      // Fallback: FIFO solicitado pero la organización no tiene cost layers
      // con stock vivo. Conservamos el método solicitado y marcamos
      // partial_data para que el frontend muestre el badge (decisión §13#6).
      const waResult = await this.computeWeightedAverageValuation(
        location_where,
      );
      return {
        method: 'weighted_average' as ResolvedCostingMethod,
        requested_method: 'fifo' as ResolvedCostingMethod,
        partial_data: true,
        is_authoritative: false,
        source: 'stock_levels.cost_per_unit' as const,
        total_value: waResult.total_value,
        by_store: waResult.by_store,
        items_count: waResult.items_count,
        note: 'FIFO solicitado pero no hay cost layers con stock — usando weighted_average como aproximación (no autoritativa).',
      };
    }

    // Weighted average path: autoritativa bajo método CPP configurado.
    const waResult = await this.computeWeightedAverageValuation(location_where);
    return {
      method: 'weighted_average' as ResolvedCostingMethod,
      requested_method: 'weighted_average' as ResolvedCostingMethod,
      partial_data: false,
      is_authoritative: true,
      source: 'stock_levels.cost_per_unit' as const,
      total_value: waResult.total_value,
      by_store: waResult.by_store,
      items_count: waResult.items_count,
      note: 'Valuación CPP autoritativa sobre stock_levels.cost_per_unit * quantity_on_hand.',
    };
  }

  /**
   * Valuación CPP (weighted average). Usa `stock_levels.cost_per_unit` como
   * costo y `quantity_on_hand` como cantidad. Filtra por las ubicaciones
   * resueltas en `resolveLocationWhere` (org, o tienda específica).
   */
  private async computeWeightedAverageValuation(
    location_where: Prisma.inventory_locationsWhereInput,
  ) {
    const rows = await this.prisma.stock_levels.findMany({
      where: {
        inventory_locations: location_where,
        cost_per_unit: { not: null },
      },
      select: {
        quantity_on_hand: true,
        cost_per_unit: true,
        inventory_locations: { select: { store_id: true } },
      },
    });

    const totalsByStore = new Map<number | 'org', Prisma.Decimal>();
    let total = new Prisma.Decimal(0);
    let itemsCount = 0;

    for (const row of rows) {
      const cost = row.cost_per_unit ?? new Prisma.Decimal(0);
      const value = cost.mul(row.quantity_on_hand);
      total = total.add(value);
      itemsCount += 1;
      const key: number | 'org' = row.inventory_locations?.store_id ?? 'org';
      totalsByStore.set(
        key,
        (totalsByStore.get(key) ?? new Prisma.Decimal(0)).add(value),
      );
    }

    return {
      total_value: Number(total.toFixed(2)),
      items_count: itemsCount,
      by_store: [...totalsByStore.entries()].map(([key, value]) => ({
        store_id: key === 'org' ? null : key,
        total_value: Number(value.toFixed(2)),
      })),
    };
  }

  /**
   * Valuación FIFO. Suma `quantity_remaining * unit_cost` sobre
   * `inventory_cost_layers` con stock disponible. La tabla ya tiene
   * `organization_id` directo; usamos `OrganizationPrismaService` para que
   * el scope se aplique automáticamente. Si se pidió un `store_id`,
   * restringe vía `inventory_locations.store_id` (la org ya queda implícita
   * por el auto-scope).
   *
   * Devuelve `has_layers=false` cuando no hay capas vivas, lo que dispara el
   * fallback a weighted_average con `partial_data: true` en el caller.
   */
  private async computeFifoValuation(args: {
    /**
     * Sólo se mantiene para trazabilidad/logs; el scoping real de
     * `organization_id` lo aplica `OrganizationPrismaService` vía el
     * extension del cliente Prisma.
     */
    organization_id: number;
    store_id_filter: number | null;
  }) {
    const { store_id_filter } = args;
    void args.organization_id; // documentación: filtro implícito por auto-scope

    const where: Prisma.inventory_cost_layersWhereInput = {
      quantity_remaining: { gt: 0 },
    };

    if (store_id_filter != null) {
      where.inventory_locations = {
        is: { store_id: store_id_filter },
      };
    }

    const layers = await this.orgPrisma.inventory_cost_layers.findMany({
      where,
      select: {
        quantity_remaining: true,
        unit_cost: true,
        inventory_locations: { select: { store_id: true } },
      },
    });

    if (layers.length === 0) {
      return {
        has_layers: false as const,
        total_value: 0,
        items_count: 0,
        by_store: [] as Array<{ store_id: number | null; total_value: number }>,
      };
    }

    const totalsByStore = new Map<number | 'org', Prisma.Decimal>();
    let total = new Prisma.Decimal(0);

    for (const layer of layers) {
      const value = layer.unit_cost.mul(layer.quantity_remaining);
      total = total.add(value);
      const key: number | 'org' = layer.inventory_locations?.store_id ?? 'org';
      totalsByStore.set(
        key,
        (totalsByStore.get(key) ?? new Prisma.Decimal(0)).add(value),
      );
    }

    return {
      has_layers: true as const,
      total_value: Number(total.toFixed(2)),
      items_count: layers.length,
      by_store: [...totalsByStore.entries()].map(([key, value]) => ({
        store_id: key === 'org' ? null : key,
        total_value: Number(value.toFixed(2)),
      })),
    };
  }
}
