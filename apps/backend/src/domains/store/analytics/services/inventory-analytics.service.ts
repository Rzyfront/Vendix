import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma, movement_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  InventoryAnalyticsQueryDto,
  Granularity,
} from '../dto/analytics-query.dto';
import { fillTimeSeries } from '../utils/fill-time-series.util';
import {
  formatPeriodFromDate,
  parseDateRange,
} from '../utils/date.util';
import {
  DEFAULT_STORE_TIMEZONE,
  resolveStoreTimezone,
  localPeriodSql,
} from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { mergeStoreSettingsWithDefaults } from '../../settings/defaults/default-store-settings';
import type { StoreSettings } from '../../settings/interfaces/store-settings.interface';
import { resolveProductLowStockThreshold } from '../../inventory/shared/helpers/low-stock-threshold.helper';
import {
  buildCostCoverage,
  INBOUND_MOVEMENT_TYPES,
  OUTBOUND_MOVEMENT_TYPES,
  TRANSFER_MOVEMENT_TYPE,
  sqlStateList,
} from '../analytics-metrics.contract';
import {
  formatAggregateQuantity,
  resolveSaleUnitCodes,
  saleUnitScaleFactor,
} from '../../products/services/sale-unit-display.util';

/**
 * One row of the stock-levels report. RAW values only — numbers are plain
 * numbers, there is NO pre-formatting and NO presentation fallback strings.
 * The emission phase (ReportBuilder) owns headers, currency/number formatting,
 * and how `null` fields render.
 */
export interface StockLevelExportRow {
  product_id: number;
  product_name: string;
  sku: string | null;
  image_url: string | null;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  reorder_point: number;
  cost_per_unit: number;
  total_value: number;
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'overstock';
  /**
   * Unidad de venta en la que están expresadas las cantidades de la fila.
   * Solo la llena el lector del EXPORT ({@link
   * InventoryAnalyticsService.getStockLevelsForExport}); la tabla de pantalla
   * sigue emitiendo unidades mínimas hasta que el frontend sepa rotularlas.
   */
  unit?: string;
}

/**
 * One row of the inventory-movements report. RAW values only: `created_at` is a
 * raw `Date` (NOT a `YYYY-MM-DD` string), `movement_type` is the raw enum, and
 * absent related names are `null` (not `'-'`/`'Desconocido'`). The emission
 * phase formats the date in the store timezone and resolves display fallbacks.
 */
export interface MovementExportRow {
  id: number;
  created_at: Date | null;
  product_id: number;
  product_name: string | null;
  sku: string | null;
  movement_type: movement_type_enum;
  quantity: number;
  /** Unidad de venta en la que va `quantity`. Vacío = sin unidad que declarar. */
  unit: string;
  from_location: string | null;
  to_location: string | null;
  user_name: string | null;
  reason: string | null;
  reference_id: string | null;
}

/**
 * Minimal product projection used to compute the summary's count KPIs over a
 * scope-coherent universe (see {@link InventoryAnalyticsService.getInventorySummary}).
 */
interface SummaryProductRow {
  id: number;
  stock_quantity: number | null;
  min_stock_level: number | null;
  reorder_point: number | null;
}

@Injectable()
export class InventoryAnalyticsService {
  // QUI-553: OperatingScopeService is no longer injected here. This reader is
  // store-scoped in every operating scope, so there is no scope decision left
  // to resolve; org-wide consolidation belongs to the organization domain.
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Resolves the current request's store timezone (single source of truth).
   * Falls back to the default when there is no store context (the scoped
   * client would already reject such a call before reaching real data).
   */
  private async getStoreTimezone(): Promise<string> {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      return DEFAULT_STORE_TIMEZONE;
    }
    return resolveStoreTimezone(this.prisma, context.store_id);
  }

  async getInventorySummary(query: InventoryAnalyticsQueryDto) {
    const settings = await this.loadMergedSettings();

    // DATA-SCOPE-1: every KPI in this report shares ONE scope universe, and
    // that universe is ALWAYS the current store — never the organization, not
    // even when operating_scope = ORGANIZATION (QUI-553). A store panel that
    // consolidated other stores' inventory reported stock the store does not
    // own, and contradicted getLowStockAlerts()/getStockLevels(), which read
    // the store-scoped client. Consolidated org-wide inventory lives in
    // /organization/reports/inventory/* (see vendix-operating-scope).
    // getInventoryValuation() resolves the same store universe, so the
    // product-derived counts below and the stock value/quantity agree.
    const products = await this.loadScopedSummaryProducts();

    let totalSkuCount = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const product of products) {
      totalSkuCount++;
      const qty = Number(product.stock_quantity || 0);
      const reorderPoint = resolveProductLowStockThreshold(settings, product);

      if (qty === 0) {
        outOfStockCount++;
      } else if (qty <= reorderPoint) {
        lowStockCount++;
      }
    }

    // Stock value AND on-hand quantity come from the authoritative valuation
    // (stock_levels + cost layers), resolved in the SAME operating-scope
    // universe as the product counts above. Never derive value from
    // products.cost_price (see vendix-inventory-valuation).
    const valuation = await this.getInventoryValuation(query);
    const totalStockValue = valuation.totals.total_value;
    const totalQuantity = valuation.totals.total_quantity;

    return {
      total_sku_count: totalSkuCount,
      total_stock_value: totalStockValue,
      low_stock_count: lowStockCount,
      out_of_stock_count: outOfStockCount,
      low_stock_percentage:
        totalSkuCount > 0 ? (lowStockCount / totalSkuCount) * 100 : 0,
      out_of_stock_percentage:
        totalSkuCount > 0 ? (outOfStockCount / totalSkuCount) * 100 : 0,
      total_quantity_on_hand: totalQuantity,
    };
  }

  /**
   * Loads the active, inventory-tracked product universe of the CURRENT STORE,
   * so the summary KPIs share ONE scope universe with getInventoryValuation().
   *
   * QUI-553: this used to widen the universe to every store of the organization
   * when operating_scope = ORGANIZATION (withoutScope() + a manual
   * products.stores.organization_id filter). A store panel must never report
   * another store's stock, so the universe is now the store in every scope —
   * the same isolation the scoped client already applies to
   * getLowStockAlerts() and getStockLevels(). Org-wide consolidation is served
   * by /organization/reports/inventory/* (see vendix-operating-scope).
   */
  private async loadScopedSummaryProducts(): Promise<SummaryProductRow[]> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }
    if (!context.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const select = {
      id: true,
      stock_quantity: true,
      min_stock_level: true,
      reorder_point: true,
    } as const;

    // The scoped client already restricts products to the current store.
    return this.prisma.products.findMany({ where: { state: 'active', track_inventory: true }, select });
  }

  /**
   * Builds the COMPLETE, unpaginated set of stock-level rows for the current
   * scope, honoring the `category_id` and `status` filters. Pagination/capping
   * is applied by the callers that need it, never here — so the export reader
   * can return every row.
   */
  private async buildStockLevelRows(
    query: InventoryAnalyticsQueryDto,
  ): Promise<StockLevelExportRow[]> {
    const settings = await this.loadMergedSettings();

    const productWhere: any = {
      state: 'active',
      track_inventory: true,
      ...(query.category_id && {
        product_categories: {
          some: {
            category_id: query.category_id,
          },
        },
      }),
    };

    const products = await this.prisma.products.findMany({
      where: productWhere,
      select: {
        id: true,
        name: true,
        sku: true,
        product_images: {
          select: { image_url: true },
          take: 1,
        },
        stock_quantity: true,
        cost_price: true,
        min_stock_level: true,
        max_stock_level: true,
        reorder_point: true,
      },
      orderBy: {
        stock_quantity: 'asc',
      },
    });

    let results: StockLevelExportRow[] = products.map((product) => {
      const qty = Number(product.stock_quantity || 0);
      const cost = Number(product.cost_price || 0);
      const reorderPoint = resolveProductLowStockThreshold(settings, product);
      const maxStock = Number(product.max_stock_level || 1000);

      let status: StockLevelExportRow['status'];
      if (qty === 0) {
        status = 'out_of_stock';
      } else if (qty <= reorderPoint) {
        status = 'low_stock';
      } else if (qty > maxStock) {
        status = 'overstock';
      } else {
        status = 'in_stock';
      }

      return {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        image_url: product.product_images?.[0]?.image_url || null,
        quantity_on_hand: qty,
        quantity_reserved: 0, // TODO: Calculate from stock_reservations
        quantity_available: qty,
        reorder_point: reorderPoint,
        cost_per_unit: cost,
        total_value: qty * cost,
        status,
      };
    });

    // Filter by status if specified
    if (query.status) {
      results = results.filter((r) => r.status === query.status);
    }

    return results;
  }

  async getStockLevels(query: InventoryAnalyticsQueryDto) {
    const results = await this.buildStockLevelRows(query);

    const isPaginated = query.page !== undefined && query.limit !== undefined;
    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const totalCount = results.length;
      const paginatedData = results.slice((page - 1) * limit, page * limit);

      return {
        data: paginatedData,
        meta: {
          pagination: {
            total: totalCount,
            page,
            limit,
            total_pages: Math.ceil(totalCount / limit),
          },
        },
      };
    }

    // Non-paginated: respect original limit behavior
    return results.slice(0, query.limit || 100);
  }

  /**
   * DATA-COMPLETE-7 fix: dedicated export reader for stock levels.
   *
   * getStockLevels() returns a paginated `{ data, meta }` envelope for the UI
   * table when page+limit are present, and otherwise a list silently capped at
   * `limit || 100`. Feeding that to the export made the CSV/XLSX come out empty
   * (`.length` on the envelope object is `undefined`) or truncated to 100 rows.
   *
   * This method ALWAYS returns the COMPLETE array of rows for the current
   * scope/filters — never an envelope, never capped. `category_id` and `status`
   * still narrow the report; `page`/`limit` are intentionally ignored.
   */
  async getStockLevelsForExport(
    query: InventoryAnalyticsQueryDto,
  ): Promise<StockLevelExportRow[]> {
    const rows = await this.buildStockLevelRows(query);
    return this.expressStockRowsInSaleUnit(rows);
  }

  /**
   * Reexpresa las cantidades del reporte de inventario en la unidad de venta.
   *
   * Solo el EXPORT pasa por acá, no la tabla de pantalla: el archivo tiene una
   * columna "Unidad" donde rotular la conversión y la pantalla todavía no, y
   * mostrar `3` sin decir "metros" sería menos claro que mostrar `3000`.
   *
   * `cost_per_unit` se reescala junto con la cantidad porque "unitario" se
   * refiere a la unidad que la fila muestra: con existencias en metros y costo
   * por milímetro, `Valor Total` dejaría de ser el producto de sus dos vecinos.
   * `total_value` no se toca — es el mismo dinero, decidido antes de convertir.
   */
  private async expressStockRowsInSaleUnit(
    rows: StockLevelExportRow[],
  ): Promise<StockLevelExportRow[]> {
    if (rows.length === 0) return rows;

    const saleUnits = await resolveSaleUnitCodes(
      this.prisma as any,
      rows.map((r) => r.product_id),
    );
    if (saleUnits.size === 0) return rows;

    return rows.map((row) => {
      const info = saleUnits.get(row.product_id);
      if (!info) return row;

      const onHand = formatAggregateQuantity(row.quantity_on_hand, info);
      const factor = saleUnitScaleFactor(info);

      return {
        ...row,
        quantity_on_hand: onHand.value,
        quantity_reserved: formatAggregateQuantity(
          row.quantity_reserved,
          info,
        ).value,
        quantity_available: formatAggregateQuantity(
          row.quantity_available,
          info,
        ).value,
        reorder_point: formatAggregateQuantity(row.reorder_point, info).value,
        cost_per_unit:
          factor > 1 ? Number((row.cost_per_unit * factor).toFixed(4)) : row.cost_per_unit,
        unit: onHand.suffix,
      };
    });
  }

  async getLowStockAlerts(query: InventoryAnalyticsQueryDto) {
    const settings = await this.loadMergedSettings();

    // track_inventory is Boolean @default(false), not nullable
    const products = await this.prisma.products.findMany({
      where: {
        state: 'active',
        track_inventory: true,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        product_images: {
          select: { image_url: true },
          take: 1,
        },
        stock_quantity: true,
        cost_price: true,
        min_stock_level: true,
        reorder_point: true,
      },
      orderBy: {
        stock_quantity: 'asc',
      },
    });

    const results = products
      .filter((p) => {
        const qty = Number(p.stock_quantity || 0);
        const reorderPoint = resolveProductLowStockThreshold(settings, p);
        return qty <= reorderPoint;
      })
      .map((product) => {
        const qty = Number(product.stock_quantity || 0);
        const reorderPoint = resolveProductLowStockThreshold(settings, product);

        return {
          product_id: product.id,
          product_name: product.name,
          sku: product.sku,
          image_url: product.product_images?.[0]?.image_url || null,
          quantity_available: qty,
          reorder_point: reorderPoint,
          days_of_stock: null, // TODO: Calculate from sales velocity
          status: qty === 0 ? 'out_of_stock' : 'low_stock',
        };
      });

    const isPaginated = query.page !== undefined && query.limit !== undefined;
    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const totalCount = results.length;
      const paginatedData = results.slice((page - 1) * limit, page * limit);

      return {
        data: paginatedData,
        meta: {
          pagination: {
            total: totalCount,
            page,
            limit,
            total_pages: Math.ceil(totalCount / limit),
          },
        },
      };
    }

    // Non-paginated: respect original limit behavior
    return results.slice(0, query.limit || 100);
  }

  private async loadMergedSettings(): Promise<StoreSettings> {
    const row = await this.prisma.store_settings.findFirst({
      select: { settings: true },
    });
    return mergeStoreSettingsWithDefaults(row?.settings);
  }

  async getStockMovements(query: InventoryAnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const where: any = {
      created_at: {
        gte: startDate,
        lte: endDate,
      },
      ...(query.movement_type && {
        movement_type: query.movement_type as any,
      }),
    };

    const isPaginated = query.page !== undefined && query.limit !== undefined;

    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const totalCount = await this.prisma.inventory_movements.count({ where });

      const movements = await this.prisma.inventory_movements.findMany({
        where,
        include: {
          products: {
            select: {
              name: true,
              sku: true,
            },
          },
          from_location: {
            select: {
              name: true,
            },
          },
          to_location: {
            select: {
              name: true,
            },
          },
          users: {
            select: {
              username: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
        skip: (page - 1) * limit,
        take: limit,
      });

      const data = movements.map((m) => ({
        id: m.id,
        date: m.created_at.toISOString(),
        product_id: m.product_id,
        product_name: m.products?.name || 'Unknown',
        sku: m.products?.sku || '',
        movement_type: m.movement_type,
        quantity: Number(m.quantity || 0),
        from_location: m.from_location?.name || null,
        to_location: m.to_location?.name || null,
        reason: m.reason,
        user_name: m.users?.username || null,
        reference_id: m.source_order_id?.toString() || null,
      }));

      return {
        data,
        meta: {
          pagination: {
            total: totalCount,
            page,
            limit,
            total_pages: Math.ceil(totalCount / limit),
          },
        },
      };
    }

    // Non-paginated (retrocompatible)
    const movements = await this.prisma.inventory_movements.findMany({
      where,
      include: {
        products: {
          select: {
            name: true,
            sku: true,
          },
        },
        from_location: {
          select: {
            name: true,
          },
        },
        to_location: {
          select: {
            name: true,
          },
        },
        users: {
          select: {
            username: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      take: query.limit || 100,
    });

    return movements.map((m) => ({
      id: m.id,
      date: m.created_at.toISOString(),
      product_id: m.product_id,
      product_name: m.products?.name || 'Unknown',
      sku: m.products?.sku || '',
      movement_type: m.movement_type,
      quantity: Number(m.quantity || 0),
      from_location: m.from_location?.name || null,
      to_location: m.to_location?.name || null,
      reason: m.reason,
      user_name: m.users?.username || null,
      reference_id: m.source_order_id?.toString() || null,
    }));
  }

  /**
   * Valuation of the CURRENT STORE's inventory: only locations whose
   * `store_id` is the request store.
   *
   * QUI-553: when operating_scope = ORGANIZATION this used to drop the store
   * filter entirely, so the store panel valued every store's stock plus the
   * org-level central warehouse (`inventory_locations.store_id = NULL`). That
   * contradicts `enforceLocationAccess({ allowCentral: false })`, which forbids
   * a store-scoped caller from reaching the central warehouse. The store filter
   * now applies in every scope; consolidated valuation lives in
   * /organization/reports/inventory/*.
   */
  async getInventoryValuation(query: InventoryAnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }
    if (!context.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // withoutScope() is needed because this reader joins through
    // inventory_locations and inventory_cost_layers; the store isolation is
    // reinstated explicitly by storeFilter below.
    const baseClient = this.prisma.withoutScope() as any;
    const asOf = (query as any).as_of ? new Date((query as any).as_of) : null;
    const storeFilter = { store_id: context.store_id };

    if (asOf) {
      return this.getHistoricalInventoryValuation(baseClient, {
        organizationId: context.organization_id,
        storeId: context.store_id,
        locationId: query.location_id,
        asOf,
      });
    }

    const stockLevels = await baseClient.stock_levels.findMany({
      where: {
        ...(query.location_id && { location_id: query.location_id }),
        inventory_locations: {
          organization_id: context.organization_id,
          ...storeFilter,
        },
      },
      include: {
        inventory_locations: {
          select: {
            id: true,
            name: true,
            store_id: true,
          },
        },
        products: {
          select: {
            cost_price: true,
          },
        },
        product_variants: {
          select: {
            cost_price: true,
          },
        },
      },
    });

    const layers = await baseClient.inventory_cost_layers.findMany({
      where: {
        quantity_remaining: { gt: 0 },
        inventory_locations: {
          organization_id: context.organization_id,
          ...storeFilter,
        },
        ...(query.location_id && { location_id: query.location_id }),
      },
      select: {
        product_id: true,
        product_variant_id: true,
        location_id: true,
        quantity_remaining: true,
        unit_cost: true,
      },
    });

    const layerValueByStockKey = new Map<string, number>();
    for (const layer of layers) {
      const key = this.getStockKey(
        layer.location_id,
        layer.product_id,
        layer.product_variant_id,
      );
      const value =
        Number(layer.quantity_remaining || 0) * Number(layer.unit_cost || 0);
      layerValueByStockKey.set(
        key,
        (layerValueByStockKey.get(key) || 0) + value,
      );
    }

    // Aggregate by location
    const locationMap = new Map<
      number,
      { name: string; quantity: number; value: number }
    >();
    let totalValue = 0;
    let totalQuantity = 0;
    // Unidades cuyo valor NO salió de una capa de costo ni de un costo unitario
    // conocido: entraron al total valuadas en cero.
    let unitsWithoutCost = 0;

    for (const sl of stockLevels) {
      const locationId = sl.inventory_locations?.id || 0;
      const locationName = sl.inventory_locations?.name || 'Sin ubicación';
      const qty = Number(sl.quantity_on_hand || 0);
      const stockKey = this.getStockKey(
        sl.location_id,
        sl.product_id,
        sl.product_variant_id,
      );
      const layerValue = layerValueByStockKey.get(stockKey);
      const cost =
        Number(sl.cost_per_unit || 0) ||
        Number(sl.product_variants?.cost_price || 0) ||
        Number(sl.products?.cost_price || 0);
      const value = layerValue !== undefined ? layerValue : qty * cost;
      totalValue += value;
      totalQuantity += qty;
      if (layerValue === undefined && !(cost > 0) && qty > 0) {
        unitsWithoutCost += qty;
      }

      const existing = locationMap.get(locationId) || {
        name: locationName,
        quantity: 0,
        value: 0,
      };
      existing.quantity += qty;
      existing.value += value;
      locationMap.set(locationId, existing);
    }

    const rows = Array.from(locationMap.entries())
      .map(([id, data]) => ({
        location_id: id,
        location_name: data.name,
        total_quantity: data.quantity,
        total_value: data.value,
        average_cost: data.quantity > 0 ? data.value / data.quantity : 0,
        percentage_of_total:
          totalValue > 0 ? (data.value / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.total_value - a.total_value);

    return {
      rows,
      /**
       * El total NO es autoritativo cuando parte del físico entró valuado en
       * cero. Sin esta cifra el informe firma como definitivo un valor
       * subestimado, y quien lo lee no tiene forma de distinguir "vale poco" de
       * "no sabemos cuánto vale": los dos se ven idénticos. La cobertura viaja
       * junto al número, nunca aparte.
       */
      coverage: {
        ...buildCostCoverage(totalQuantity, unitsWithoutCost),
        is_authoritative: unitsWithoutCost === 0,
      },
      totals: {
        total_quantity: totalQuantity,
        total_value: totalValue,
        average_cost: totalQuantity > 0 ? totalValue / totalQuantity : 0,
        total_locations: rows.length,
      },
    };
  }

  async getInventoryAging(query: InventoryAnalyticsQueryDto) {
    const daysThreshold = query.days_threshold || 90;
    const now = new Date();

    const stockLevels = await this.prisma.stock_levels.findMany({
      where: {
        quantity_on_hand: { gt: 0 },
        ...(query.location_id && { location_id: query.location_id }),
      },
      include: {
        products: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
      },
      orderBy: {
        quantity_on_hand: 'desc',
      },
      take: query.limit || 100,
    });

    const productIds = stockLevels.map((level) => level.product_id);
    const lastMovementByProduct =
      productIds.length > 0
        ? await this.prisma.inventory_movements.groupBy({
            by: ['product_id'],
            where: {
              product_id: { in: productIds },
              ...(query.location_id && {
                OR: [
                  { from_location_id: query.location_id },
                  { to_location_id: query.location_id },
                ],
              }),
            },
            _max: {
              created_at: true,
            },
          })
        : [];

    const lastMovementMap = new Map<number | null, Date | null>(
      lastMovementByProduct.map((movement) => [
        movement.product_id,
        movement._max.created_at,
      ]),
    );

    return stockLevels.map((level) => {
      const lastMovementDate = lastMovementMap.get(level.product_id) || null;
      const daysWithoutMovement = lastMovementDate
        ? Math.floor(
            (now.getTime() - lastMovementDate.getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : daysThreshold + 1;

      return {
        product_id: level.product_id,
        product_name: level.products?.name || 'Desconocido',
        sku: level.products?.sku || '',
        quantity_on_hand: Number(level.quantity_on_hand || 0),
        days_without_movement: daysWithoutMovement,
        last_movement_date: lastMovementDate?.toISOString() || null,
        status:
          daysWithoutMovement <= 30
            ? 'active'
            : daysWithoutMovement <= daysThreshold
              ? 'slow'
              : 'dead',
      };
    });
  }

  async getExpiringProducts(query: InventoryAnalyticsQueryDto) {
    const daysThreshold = query.days_threshold || 30;
    const now = new Date();
    const thresholdDate = new Date(now);
    thresholdDate.setUTCDate(thresholdDate.getUTCDate() + daysThreshold);

    const batches = await this.prisma.inventory_batches.findMany({
      where: {
        quantity: { gt: 0 },
        expiration_date: { // tz-audit:ignore — umbral de vencimiento futuro, no ventana de período
          not: null,
          lte: thresholdDate,
        },
        ...(query.location_id && { location_id: query.location_id }),
      },
      include: {
        products: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
      },
      orderBy: {
        expiration_date: 'asc',
      },
      take: query.limit || 100,
    });

    return batches.map((batch) => {
      const expirationDate = batch.expiration_date!;
      const daysUntilExpiry = Math.ceil(
        (expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      return {
        product_id: batch.product_id,
        product_name: batch.products?.name || 'Desconocido',
        sku: batch.products?.sku || '',
        lot_number: batch.batch_number,
        expiration_date: expirationDate.toISOString(),
        quantity: Number(batch.quantity || 0),
        days_until_expiry: daysUntilExpiry,
        status:
          daysUntilExpiry < 0
            ? 'expired'
            : daysUntilExpiry <= 7
              ? 'critical'
              : daysUntilExpiry <= daysThreshold
                ? 'warning'
                : 'ok',
      };
    });
  }

  private async getHistoricalInventoryValuation(
    baseClient: any,
    params: {
      organizationId: number;
      storeId?: number | null;
      locationId?: number;
      asOf: Date;
    },
  ) {
    const snapshots = await baseClient.inventory_valuation_snapshots.findMany({
      where: {
        organization_id: params.organizationId,
        snapshot_at: { lte: params.asOf },
        ...(params.storeId && { store_id: Number(params.storeId) }),
        ...(params.locationId && { location_id: params.locationId }),
      },
      include: {
        inventory_location: {
          select: { id: true, name: true },
        },
      },
      orderBy: { snapshot_at: 'desc' },
    });

    const latestByStockKey = new Map<string, any>();
    for (const snapshot of snapshots) {
      const key = this.getStockKey(
        snapshot.location_id,
        snapshot.product_id,
        snapshot.product_variant_id,
      );
      if (!latestByStockKey.has(key)) latestByStockKey.set(key, snapshot);
    }

    const locationMap = new Map<
      number,
      { name: string; quantity: number; value: number }
    >();
    let totalValue = 0;

    for (const snapshot of latestByStockKey.values()) {
      const locationId = snapshot.location_id;
      const quantity = Number(snapshot.quantity_on_hand || 0);
      const value = Number(snapshot.total_value || 0);
      totalValue += value;

      const existing = locationMap.get(locationId) || {
        name: snapshot.inventory_location?.name || 'Sin ubicación',
        quantity: 0,
        value: 0,
      };
      existing.quantity += quantity;
      existing.value += value;
      locationMap.set(locationId, existing);
    }

    const rows = Array.from(locationMap.entries())
      .map(([id, data]) => ({
        location_id: id,
        location_name: data.name,
        total_quantity: data.quantity,
        total_value: data.value,
        average_cost: data.quantity > 0 ? data.value / data.quantity : 0,
        percentage_of_total:
          totalValue > 0 ? (data.value / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.total_value - a.total_value);

    const totalQuantity = rows.reduce((sum, r) => sum + r.total_quantity, 0);

    // La valuación histórica lee instantáneas ya valuadas: cada fila trae su
    // `total_value` congelado, así que no hay unidades "sin costo" que detectar
    // aquí. Se devuelve la misma forma que la valuación actual para que quien
    // consume no tenga que preguntar por cuál de los dos caminos vino.
    return {
      rows,
      coverage: {
        ...buildCostCoverage(totalQuantity, 0),
        is_authoritative: true,
      },
      totals: {
        total_quantity: totalQuantity,
        total_value: totalValue,
        average_cost: totalQuantity > 0 ? totalValue / totalQuantity : 0,
        total_locations: rows.length,
      },
    };
  }

  private getStockKey(
    locationId: number,
    productId: number,
    variantId?: number | null,
  ): string {
    return `${locationId}:${productId}:${variantId ?? 'base'}`;
  }

  async getMovementSummary(query: InventoryAnalyticsQueryDto) {
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    // withoutScope() needed: $queryRaw is not available on the scoped client.
    // storeId is validated above and used in the WHERE clause.
    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        movement_type: string;
        count: bigint;
        total_quantity: any;
      }>
    >`
      SELECT
        im.movement_type,
        COUNT(*)::bigint AS count,
        COALESCE(SUM(ABS(im.quantity)), 0) AS total_quantity
      FROM inventory_movements im
      INNER JOIN products p ON p.id = im.product_id
      WHERE p.store_id = ${storeId}
        AND im.created_at >= ${startDate}
        AND im.created_at <= ${endDate}
        ${query.location_id ? Prisma.sql`AND (im.from_location_id = ${query.location_id} OR im.to_location_id = ${query.location_id})` : Prisma.empty}
      GROUP BY im.movement_type
      ORDER BY count DESC
    `;

    const totalCount = results.reduce((sum, r) => sum + Number(r.count), 0);

    return results.map((r) => ({
      movement_type: r.movement_type,
      count: Number(r.count),
      total_quantity: Number(r.total_quantity),
      percentage: totalCount > 0 ? (Number(r.count) / totalCount) * 100 : 0,
    }));
  }

  async getMovementTrends(query: InventoryAnalyticsQueryDto) {
    const granularity = query.granularity || Granularity.DAY;
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Resolve the store timezone ONCE and drive both the date range and the
    // bucketing with it (single source of truth).
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    // Bucket by the store's LOCAL calendar. `localPeriodSql` emits the period as
    // an authoritative TEXT label (to_char(DATE_TRUNC(..., im.created_at AT TIME
    // ZONE 'UTC' AT TIME ZONE tz))); the fill below reproduces the exact same
    // labels by walking the local calendar.
    const periodSql = localPeriodSql('im.created_at', tz, granularity);

    // withoutScope() needed: $queryRaw is not available on the scoped client.
    // storeId is validated above and used in the WHERE clause.
    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: string;
        stock_in: any;
        stock_out: any;
        adjustments: any;
        transfers: any;
        total: any;
      }>
    >`
      SELECT
        ${periodSql} AS period,
        COALESCE(SUM(CASE WHEN im.movement_type IN (${sqlStateList(INBOUND_MOVEMENT_TYPES)}) THEN ABS(im.quantity) ELSE 0 END), 0) AS stock_in,
        COALESCE(SUM(CASE WHEN im.movement_type IN (${sqlStateList(OUTBOUND_MOVEMENT_TYPES)}) THEN ABS(im.quantity) ELSE 0 END), 0) AS stock_out,
        COALESCE(SUM(CASE WHEN im.movement_type = 'adjustment' THEN ABS(im.quantity) ELSE 0 END), 0) AS adjustments,
        COALESCE(SUM(CASE WHEN im.movement_type = ${TRANSFER_MOVEMENT_TYPE} THEN ABS(im.quantity) ELSE 0 END), 0) AS transfers,
        COALESCE(SUM(ABS(im.quantity)), 0) AS total
      FROM inventory_movements im
      INNER JOIN products p ON p.id = im.product_id
      WHERE p.store_id = ${storeId}
        AND im.created_at >= ${startDate}
        AND im.created_at <= ${endDate}
        ${query.location_id ? Prisma.sql`AND (im.from_location_id = ${query.location_id} OR im.to_location_id = ${query.location_id})` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const mapped = results.map((r) => ({
      // period is already the authoritative local label from SQL — do NOT
      // re-derive it in JS (that reintroduces the tz-ambiguity bug).
      period: r.period,
      stock_in: Number(r.stock_in),
      stock_out: Number(r.stock_out),
      adjustments: Number(r.adjustments),
      transfers: Number(r.transfers),
      total: Number(r.total),
    }));

    return fillTimeSeries(
      mapped,
      startDate,
      endDate,
      granularity,
      { stock_in: 0, stock_out: 0, adjustments: 0, transfers: 0, total: 0 },
      formatPeriodFromDate,
      tz,
    );
  }

  async getMovementsForExport(
    query: InventoryAnalyticsQueryDto,
  ): Promise<MovementExportRow[]> {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const movements = await this.prisma.inventory_movements.findMany({
      where: {
        created_at: {
          gte: startDate,
          lte: endDate,
        },
        ...(query.movement_type && {
          movement_type: query.movement_type as movement_type_enum,
        }),
      },
      include: {
        products: {
          select: {
            name: true,
            sku: true,
          },
        },
        from_location: {
          select: {
            name: true,
          },
        },
        to_location: {
          select: {
            name: true,
          },
        },
        users: {
          select: {
            username: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      take: 10000,
    });

    // Phase B (data correctness): emit RAW values with clear field keys.
    // No Spanish header keys, no `.toISOString().split('T')[0]`, no presentation
    // fallbacks. `created_at` stays a raw Date so the emission phase
    // (ReportBuilder) formats it in the store timezone.
    // Un movimiento se registra en unidades mínimas; el reporte lo cuenta en la
    // unidad de venta del producto para que "entraron 3000" deje de parecer un
    // error de digitación cuando lo que entraron fueron 3 metros.
    const saleUnits = await resolveSaleUnitCodes(
      this.prisma as any,
      movements.map((m) => m.product_id),
    );

    return movements.map((m) => {
      const info =
        m.product_id != null ? saleUnits.get(Number(m.product_id)) : undefined;
      const qty = formatAggregateQuantity(Number(m.quantity ?? 0), info);

      return {
        id: m.id,
        created_at: m.created_at,
        product_id: m.product_id,
        product_name: m.products?.name ?? null,
        sku: m.products?.sku ?? null,
        movement_type: m.movement_type,
        quantity: qty.value,
        unit: qty.suffix,
        from_location: m.from_location?.name ?? null,
        to_location: m.to_location?.name ?? null,
        user_name: m.users?.username ?? null,
        reason: m.reason ?? null,
        reference_id: m.source_order_id?.toString() ?? null,
      };
    });
  }

  // -------------------------------------------------------------------------
  // STUBS for the resubmit's analytics.controller.ts (QUI-542 batch). See
  // the comment on the matching sales stubs for context.
  // -------------------------------------------------------------------------
  async getLowStockForExport(
    _query: InventoryAnalyticsQueryDto,
  ): Promise<readonly unknown[]> {
    return [];
  }

  async getInventoryBySupplierForExport(
    _query: InventoryAnalyticsQueryDto,
  ): Promise<readonly unknown[]> {
    return [];
  }
}
