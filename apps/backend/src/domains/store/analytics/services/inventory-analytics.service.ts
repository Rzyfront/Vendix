import { Injectable, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma, movement_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  InventoryAnalyticsQueryDto,
  Granularity,
} from '../dto/analytics-query.dto';
import {
  LowStockBySupplierQueryDto,
  LowStockBySupplierAnalyticsQueryDto,
  LowStockStatusFilter,
} from '../dto/low-stock-by-supplier-query.dto';
import type {
  LowStockBySupplierRow,
  LowStockBySupplierAnalyticsEnvelope,
} from '../interfaces/low-stock-by-supplier-row.interface';
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
import { ResponseService } from '@common/responses/response.service';
import { paginatedOrAll } from '@common/reports/report-response.util';
import { mergeStoreSettingsWithDefaults } from '../../settings/defaults/default-store-settings';
import type { StoreSettings } from '../../settings/interfaces/store-settings.interface';
import { resolveProductLowStockThreshold } from '../../inventory/shared/helpers/low-stock-threshold.helper';
import {
  buildCostCoverage,
  COMPLETED_SALE_STATES,
  INBOUND_MOVEMENT_TYPES,
  OUTBOUND_MOVEMENT_TYPES,
  PURCHASE_COMMITTED_STATES,
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

/**
 * Builds the synthetic "AVISO" row appended to the XLSX export when the
 * 10.000-row cap is hit (ADR-5). Every numeric field is `0` or `null`,
 * every text field is `null` except `product_name`, which carries the
 * Spanish warning so it surfaces in the spreadsheet itself even when the
 * user skims only the data rows.
 *
 * Shape is a {@link LowStockBySupplierRow} so the same `ReportColumn[]`
 * mapping that renders real rows can render this one without branching.
 */
function buildLowStockTruncationAvisoRow(): LowStockBySupplierRow {
  return {
    product_id: 0,
    product_name:
      'AVISO: Dataset truncado a 10.000 filas. Refinar filtros para ver el resto.',
    sku: null,
    current_stock: 0,
    previous_stock: null,
    previous_stock_source: 'na',
    delta: null,
    min_threshold: 0,
    status: 'low_stock',
    supplier_id: null,
    supplier_name: null,
    supplier_sku: null,
    last_purchase_date: null,
    last_purchase_cost: null,
    last_purchase_po_number: null,
    days_without_sale: null,
    units_per_package: 0,
  };
}

@Injectable()
export class InventoryAnalyticsService {
  // QUI-553: OperatingScopeService is no longer injected here. This reader is
  // store-scoped in every operating scope, so there is no scope decision left
  // to resolve; org-wide consolidation belongs to the organization domain.
  //
  // Cap of 10.000 rows (ADR-5): the universe is bounded at the DB query so a
  // store with > 10k active inventory-tracked SKUs cannot fan out into an
  // unbounded export. When the cap is hit, callers emit a footer warning so
  // the user knows to refine filters — see {@link getLowStockBySupplierForExport}.
  private static readonly LOW_STOCK_EXPORT_CAP = 10000;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly responseService: ResponseService,
  ) {
    // Logger kept as an instance field (not via @InjectLogger) so the class
    // declares its logging surface at construction time — easier to grep and
    // to stub in unit tests.
    this.logger = new Logger(InventoryAnalyticsService.name);
  }

  private readonly logger: Logger;

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

    // QUI-617: cost_per_unit comes from `stock_levels.cost_per_unit` (the
    // per-location cost recorded by the StockLevelManager at write time) —
    // not from `products.cost_price` (the current catalog price). Using the
    // catalog price here would re-evaluate historical on-hand at today's
    // catalog price; the stock-level cost is auditable per write event.
    //
    // We aggregate stock_levels.cost_per_unit per product via a single raw
    // query (no N+1). The result for a product is the WEIGHTED-AVERAGE cost
    // across locations, weighted by quantity_on_hand. For a product that
    // has zero on-hand the cost stays at the catalog price as a fallback.
    // Cast through a typed handle for $queryRaw: the scoped client's
    // withoutScope() returns the base PrismaClient which exposes $queryRaw
    // with a generic T; the previous `(this.prisma as any).withoutScope()`
    // lost the generic and TS rejected the call (TS2347).
    const untyped = (this.prisma as any).withoutScope() as {
      $queryRaw: <T>(query: any) => Promise<T>;
    };
    const costRows = await untyped.$queryRaw<Array<{
      product_id: number;
      cost_per_unit: string | number;
      reserved_qty: string | number;
    }>>(
      Prisma.sql`
      SELECT
        sl.product_id AS product_id,
        CASE WHEN SUM(sl.quantity_on_hand) > 0
             THEN SUM(sl.quantity_on_hand * sl.cost_per_unit) / SUM(sl.quantity_on_hand)
             ELSE 0::decimal
        END AS cost_per_unit,
        COALESCE(SUM(sl.quantity_reserved), 0)::decimal AS reserved_qty
      FROM stock_levels sl
      INNER JOIN inventory_locations il ON il.id = sl.location_id
      WHERE il.organization_id = ${RequestContextService.getContext()?.organization_id ?? 0}
        AND il.store_id = ${RequestContextService.getContext()?.store_id ?? 0}
      GROUP BY sl.product_id
    `);
    const costByProduct = new Map<
      number,
      { cost: number; reserved: number }
    >();
    for (const r of costRows) {
      costByProduct.set(Number(r.product_id), {
        cost: Number(r.cost_per_unit),
        reserved: Number(r.reserved_qty),
      });
    }

    let results: StockLevelExportRow[] = products.map((product) => {
      const qty = Number(product.stock_quantity || 0);
      const snapshot = costByProduct.get(product.id);
      const cost =
        snapshot && snapshot.cost > 0
          ? snapshot.cost
          : Number(product.cost_price || 0);
      const quantityReserved = snapshot?.reserved ?? 0;
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
        // QUI-617: was hard-coded 0. Now sums stock_levels.quantity_reserved
        // (the per-location soft-reservation count surfaced by StockLevelManager)
        // for the same store universe as the on-hand read. Net available
        // reflects what is actually free to sell, not just what is on the shelf.
        quantity_reserved: quantityReserved,
        quantity_available: Math.max(0, qty - quantityReserved),
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

  /**
   * QUI-545: variante flat-array de `getLowStockAlerts` para exportación XLSX.
   * Devuelve TODAS las filas (no la envoltura paginada ni el slice de `limit`)
   * con datos crudos: stock_quantity numérico, reorder_point calculado por
   * helper, cost_price y un derivado `stock_value_at_risk` para que el
   * reporte de "stock bajo" muestre el riesgo monetario de comprar
   * antes de que se agote.
   */
  async getLowStockForExport(query: InventoryAnalyticsQueryDto) {
    const settings = await this.loadMergedSettings();

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
      orderBy: { stock_quantity: 'asc' },
      take: 10000,
    });

    return products
      .filter((p) => {
        const qty = Number(p.stock_quantity || 0);
        const reorderPoint = resolveProductLowStockThreshold(settings, p);
        return qty <= reorderPoint;
      })
      .map((product) => {
        const qty = Number(product.stock_quantity || 0);
        const reorderPoint = resolveProductLowStockThreshold(settings, product);
        const minLevel = Number(product.min_stock_level || 0);
        const cost = Number(product.cost_price || 0);
        return {
          product_id: product.id,
          product_name: product.name,
          sku: product.sku,
          image_url: product.product_images?.[0]?.image_url ?? null,
          stock_quantity: qty,
          min_stock_level: minLevel,
          reorder_point: reorderPoint,
          status: qty === 0 ? 'out_of_stock' : 'low_stock',
          stock_value_at_risk: Math.round(qty * cost * 100) / 100,
        };
      });
  }

  private async loadMergedSettings(): Promise<StoreSettings> {
    const row = await this.prisma.store_settings.findFirst({
      select: { settings: true },
    });
    return mergeStoreSettingsWithDefaults(row?.settings);
  }

  /**
   * QUI-550: inventario agrupado por proveedor via supplier_products.
   * Para cada supplier con al menos un producto vinculado calcula:
   *   - product_count: cuántos productos del store le compramos
   *   - total_stock_quantity: suma de products.stock_quantity
   *   - total_stock_value: stock × cost_per_unit (preferimos el cost del
   *     supplier_products sobre el cost_price del producto, porque
   *     refleja el precio real de compra al proveedor)
   *   - avg_cost_per_unit: promedio del cost_per_unit del proveedor
   *   - preferred_count: cuántos productos tienen is_preferred=true
   *     con este supplier
   */
  async getInventoryBySupplierForExport(query: InventoryAnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new ForbiddenException('Store context required');
    }
    const storeId = context.store_id;
    const organizationId = context.organization_id;

    const links = await this.prisma.supplier_products.findMany({
      where: {
        organization_id: organizationId,
        supplier: { store_id: storeId },
        products: {
          state: 'active',
          track_inventory: true,
        },
      },
      select: {
        supplier_id: true,
        product_id: true,
        cost_per_unit: true,
        is_preferred: true,
        supplier: { select: { name: true, code: true } },
        products: {
          select: { stock_quantity: true, cost_price: true },
        },
      },
      take: 10000,
    });

    const buckets = new Map<number, {
      supplier_id: number;
      supplier_name: string;
      supplier_code: string | null;
      product_count: number;
      total_stock_quantity: number;
      total_stock_value: number;
      cost_sum: number;
      cost_count: number;
      preferred_count: number;
    }>();

    for (const link of links) {
      const bucket = buckets.get(link.supplier_id) ?? {
        supplier_id: link.supplier_id,
        supplier_name: link.supplier.name,
        supplier_code: link.supplier.code,
        product_count: 0,
        total_stock_quantity: 0,
        total_stock_value: 0,
        cost_sum: 0,
        cost_count: 0,
        preferred_count: 0,
      };
      const stock = Number(link.products?.stock_quantity ?? 0);
      // Preferir el cost_per_unit del supplier_products; caer al
      // cost_price del producto si el link no tiene precio pactado.
      const unitCost = Number(
        link.cost_per_unit ?? link.products?.cost_price ?? 0,
      );
      bucket.product_count += 1;
      bucket.total_stock_quantity += stock;
      bucket.total_stock_value += stock * unitCost;
      if (unitCost > 0) {
        bucket.cost_sum += unitCost;
        bucket.cost_count += 1;
      }
      if (link.is_preferred) bucket.preferred_count += 1;
      buckets.set(link.supplier_id, bucket);
    }

    return Array.from(buckets.values())
      .map((b) => ({
        supplier_id: b.supplier_id,
        supplier_name: b.supplier_name,
        supplier_code: b.supplier_code ?? null,
        product_count: b.product_count,
        total_stock_quantity: b.total_stock_quantity,
        total_stock_value: Math.round(b.total_stock_value * 100) / 100,
        avg_cost_per_unit:
          b.cost_count > 0
            ? Math.round((b.cost_sum / b.cost_count) * 100) / 100
            : 0,
        preferred_count: b.preferred_count,
      }))
      .sort((a, b) => b.total_stock_value - a.total_stock_value);
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
        // Excluir productos archivados/inactivos del cálculo de valorización.
        // Mismo filtro que "Unidades en Mano" — el cálculo de `total_value`
        // itera sobre estos stock_levels, así que si el producto está
        // archivado, su `quantity_on_hand * cost` no entra al total.
        products: {
          state: 'active',
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
      {
        name: string;
        quantity: number;
        value: number;
        unauditable_quantity: number;
      }
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

      // QUI-619: the previous code used a silent fallback to
      // products.cost_price (current catalog price) when no cost layer
      // existed. That mixed historical and current prices silently — a
      // closed period would change retroactively when the catalog price
      // was edited, which is unauditable for accounting. Now:
      //  - if a cost layer exists -> use it (auditable, CPP/FIFO snapshot)
      //  - else if stock_levels.cost_per_unit is set -> use it (auditable,
      //    set by an inventory write that recorded the cost at the time)
      //  - else -> mark as UNAUDITABLE; contribute 0 to the value, roll the
      //    qty into `unauditable_quantity` so the UI can render an explicit
      //    "X unidades sin costo registrado — este valor no es auditable".
      let value = 0;
      let unauditableQty = 0;
      if (layerValue !== undefined) {
        value = layerValue;
      } else if (sl.cost_per_unit) {
        value = qty * Number(sl.cost_per_unit);
      } else {
        unauditableQty = qty;
      }
      totalValue += value;
      totalQuantity += qty;
      // QUI-619: la condicion correcta es 'no hay layer Y no hay cost_per_unit'.
      // Antes referenciaba `cost` que no existe en este scope — eso era un
      // bug pre-existente que rompia el build.
      if (layerValue === undefined && !sl.cost_per_unit && qty > 0) {
        unitsWithoutCost += qty;
      }

      const existing = locationMap.get(locationId) || {
        name: locationName,
        quantity: 0,
        value: 0,
        unauditable_quantity: 0,
      };
      existing.quantity += qty;
      existing.value += value;
      existing.unauditable_quantity += unauditableQty;
      locationMap.set(locationId, existing);
    }

    const rows = Array.from(locationMap.entries())
      .map(([id, data]) => ({
        location_id: id,
        location_name: data.name,
        total_quantity: data.quantity,
        total_value: data.value,
        // QUI-619: rows with no cost layer AND no stock_levels.cost_per_unit
        // contribute 0 to value but roll their qty into unauditable_quantity
        // so the UI can warn instead of presenting a mixed/unauditable
        // number silently.
        unauditable_quantity: data.unauditable_quantity,
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
          not: undefined,
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
    // storeId is validated above and used in the WHERE clause. Cast through
    // a typed handle for $queryRaw<T>: same TS2347 fix as in buildStockLevelRows.
    const untypedMovement = (this.prisma.withoutScope() as any) as {
      $queryRaw: <T>(query: any) => Promise<T>;
    };
    const results = await untypedMovement.$queryRaw<Array<{
      movement_type: string;
      count: bigint;
      total_quantity: any;
    }>>(
      Prisma.sql`
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
    `);

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
        -- QUI-620: stock_in (positive inflow) and stock_out (negative outflow)
        -- carry their SIGN so net = stock_in + stock_out + adjustments reconciles
        -- with the actual stock_levels change. ABS removed because it erased
        -- the direction of the flow — the dashboard summed "all magnitudes"
        -- and the net was always 0 or positive even when the store bled stock.
        COALESCE(SUM(CASE WHEN im.movement_type IN (${sqlStateList(INBOUND_MOVEMENT_TYPES)}) THEN im.quantity ELSE 0 END), 0) AS stock_in,
        COALESCE(SUM(CASE WHEN im.movement_type IN (${sqlStateList(OUTBOUND_MOVEMENT_TYPES)}) THEN im.quantity ELSE 0 END), 0) AS stock_out,
        COALESCE(SUM(CASE WHEN im.movement_type = 'adjustment' THEN im.quantity ELSE 0 END), 0) AS adjustments,
        -- Transfers move stock between locations but don't change total
        -- stock at the store level — keep ABS here so the net (which the
        -- summary endpoint exposes) doesn't double-count.
        COALESCE(SUM(CASE WHEN im.movement_type = ${TRANSFER_MOVEMENT_TYPE} THEN ABS(im.quantity) ELSE 0 END), 0) AS transfers,
        COALESCE(SUM(im.quantity), 0) AS total
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

  // ===========================================================================
  // Report: Stock Bajo por Proveedor (CP-low-stock-by-supplier, FB-01..FB-06)
  // ===========================================================================

  /**
   * In-app paginated view of the "Stock Bajo por Proveedor" report.
   *
   * Returns the same row shape as {@link getLowStockBySupplierForExport} but
   * wrapped with the centralized {@link paginatedOrAll} helper so the
   * controller can simply `return` the value without re-implementing the
   * `if (Array.isArray)` branch.
   *
   * Contract: FB-01 (rows), ERR-01 (invalid supplier_id), ERR-02 (invalid
   * status). The cap of 10.000 rows lives in
   * {@link buildLowStockBySupplierRows} and is documented in
   * {@link getLowStockBySupplierForExport}.
   */
  async getLowStockBySupplier(query: LowStockBySupplierQueryDto) {
    this.assertLowStockBySupplierQuery(query);
    await this.assertSupplierExistsForQuery(query.supplier_id);
    const settings = await this.loadMergedSettings();
    const { rows } = await this.buildLowStockBySupplierRows(query, settings);
    return paginatedOrAll(this.responseService, query, rows);
  }

  /**
   * Shape returned by {@link InventoryAnalyticsService.getLowStockBySupplierForExport}.
   *
   * - `rows`     — the COMPLETE, un-paginated row array for the XLSX export.
   *                When `truncated` is true, the LAST entry of `rows` is a
   *                synthetic `aviso` row (every numeric field is `0` or
   *                `null`, every text field is `null` except `product_name`
   *                which carries the warning message). Treat the aviso row
   *                as display-only — it is NOT a product and must never be
   *                counted, summed, or imported.
   * - `truncated` — `true` when the active-inventory product universe hit
   *                 {@link InventoryAnalyticsService.LOW_STOCK_EXPORT_CAP}.
   *                 The controller always renders the footer warning in this
   *                 case; the aviso row in `rows` is the in-sheet marker.
   *
   * Contract: FB-02 (XLSX), ERR-01, ERR-02.
   */
  async getLowStockBySupplierForExport(
    query: LowStockBySupplierQueryDto,
  ): Promise<{ rows: LowStockBySupplierRow[]; truncated: boolean }> {
    const startedAt = Date.now();
    this.logger.debug(
      { query: { ...query } },
      'getLowStockBySupplierForExport start',
    );

    this.assertLowStockBySupplierQuery(query);
    await this.assertSupplierExistsForQuery(query.supplier_id);
    const settings = await this.loadMergedSettings();
    const { rows, truncated } = await this.buildLowStockBySupplierRows(
      query,
      settings,
    );

    if (truncated) {
      // Loud warning: a hit at the cap means a store's dataset is too large
      // to show in one XLSX without narrowing the filters. Easier to spot
      // here in the logs than to chase from a user complaint about a missing
      // product.
      this.logger.warn(
        'getLowStockBySupplierForExport cap reached — dataset may be truncated at 10k rows',
      );
      rows.push(buildLowStockTruncationAvisoRow());
    }

    const elapsedMs = Date.now() - startedAt;
    this.logger.debug(
      { rowCount: rows.length, ms: elapsedMs },
      'getLowStockBySupplierForExport end',
    );

    return { rows, truncated };
  }

  /**
   * Aggregated analytics envelope for the "Stock Bajo por Proveedor"
   * analytics shell view (FB-06). Reuses
   * {@link getLowStockBySupplierForExport} so the rows and the aggregates
   * cannot drift apart — single source of truth for the universe of
   * "low stock by supplier" rows.
   *
   * `history_30d` is omitted when no daily stock snapshot table exists
   * (ADR-2 — confirmed absent in Phase A.2).
   *
   * Contract: FB-06, ERR-05 (date_from > date_to).
   */
  async getLowStockBySupplierAnalytics(
    query: LowStockBySupplierAnalyticsQueryDto,
  ): Promise<LowStockBySupplierAnalyticsEnvelope> {
    // ERR-05: defensive — class-validator already rejects malformed date
    // strings, but the service still has to enforce the ordering invariant.
    // Uses the inherited `date_from` / `date_to` from BaseReportQueryDto
    // (see LowStockBySupplierAnalyticsQueryDto JSDoc).
    if (query.date_from && query.date_to) {
      if (
        new Date(query.date_from).getTime() >
        new Date(query.date_to).getTime()
      ) {
        throw new VendixHttpException(ErrorCodes.ANALYTICS_DATE_RANGE_001);
      }
    }
    this.assertLowStockBySupplierQuery(query);
    await this.assertSupplierExistsForQuery(query.supplier_id);
    const settings = await this.loadMergedSettings();
    const { rows } = await this.buildLowStockBySupplierRows(query, settings);
    return this.buildLowStockBySupplierAnalytics(rows);
  }

  // --------------------------- helpers --------------------------------------

  /**
   * Defensive status validation — class-validator already filters at the DTO
   * boundary, but the service must still reject internally-constructed
   * payloads that bypassed the DTO (e.g. tests, internal callers).
   *
   * Emits ERR-02 (`LOW_STOCK_BY_SUPPLIER_002`) on invalid input.
   */
  private assertLowStockBySupplierQuery(query: LowStockBySupplierQueryDto) {
    const validStatuses: ReadonlyArray<LowStockStatusFilter | undefined> = [
      undefined,
      LowStockStatusFilter.LOW_STOCK,
      LowStockStatusFilter.OUT_OF_STOCK,
    ];
    if (!validStatuses.includes(query.status)) {
      throw new VendixHttpException(ErrorCodes.LOW_STOCK_BY_SUPPLIER_002);
    }
  }

  /**
   * Validates that `supplier_id` resolves to an active supplier visible to
   * the current store. Suppliers are org-scoped (`organization_id`) and may
   * belong to a specific store (`store_id`) or be org-wide (`store_id IS
   * NULL`); both are accepted for the user-facing filter.
   *
   * Emits ERR-01 (`LOW_STOCK_BY_SUPPLIER_001`) when the supplier does not
   * exist or does not belong to the current organization. No-op when
   * `supplierId` is undefined.
   */
  private async assertSupplierExistsForQuery(
    supplierId: number | undefined,
  ): Promise<void> {
    if (supplierId === undefined) return;
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }
    if (!context.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const supplier = await this.prisma.suppliers.findFirst({
      where: {
        id: supplierId,
        organization_id: context.organization_id,
        state: 'active',
        OR: [{ store_id: context.store_id }, { store_id: null }],
      },
      select: { id: true },
    });
    if (!supplier) {
      throw new VendixHttpException(ErrorCodes.LOW_STOCK_BY_SUPPLIER_001);
    }
  }

  /**
   * Builds the COMPLETE, unpaginated row set shared by the in-app view
   * ({@link getLowStockBySupplier}), the XLSX export
   * ({@link getLowStockBySupplierForExport}) and the analytics envelope
   * ({@link getLowStockBySupplierAnalytics}). The cap of 10.000 rows
   * (ADR-5) is enforced here so all three callers stay aligned.
   *
   * Pipeline:
   *  1. Active, inventory-tracked product universe (cap 10.000).
   *  2. Aggregate `stock_levels.quantity_available` per product, filtered
   *     to in-scope locations (ADR-1).
   *  3. Resolve preferred supplier per product (ADR-3, desempate by
   *     `cost_per_unit ASC NULLS LAST`, fallback to cheapest active goods
   *     supplier, then to `null`).
   *  4. Resolve last purchase (commitment + unit_price_net).
   *  5. Resolve days without sale (delivered/finished).
   *  6. Estimate previous stock from 24h movements (ADR-2).
   *  7. Apply user filters (supplier_id, category_id already in WHERE,
   *     status here in memory).
   */
  private async buildLowStockBySupplierRows(
    query: LowStockBySupplierQueryDto,
    settings: StoreSettings,
  ): Promise<{ rows: LowStockBySupplierRow[]; truncated: boolean }> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }
    if (!context.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;
    const organizationId = context.organization_id;

    // 1. Product universe — capped at 10.000 rows (ADR-5). When the cap is
    // hit (products.length === LOW_STOCK_EXPORT_CAP) the dataset may be
    // truncated; the caller decides whether to emit a footer warning.
    const cap = InventoryAnalyticsService.LOW_STOCK_EXPORT_CAP;
    const productWhere: Prisma.productsWhereInput = {
      state: 'active',
      track_inventory: true,
      ...(query.category_id !== undefined && {
        product_categories: { some: { category_id: query.category_id } },
      }),
    };

    const products = await this.prisma.products.findMany({
      where: productWhere,
      select: {
        id: true,
        name: true,
        sku: true,
        cost_price: true,
        min_stock_level: true,
        reorder_point: true,
        purchase_to_stock_factor: true,
      },
      take: cap,
    });

    const truncated = products.length === cap;
    if (products.length === 0) return { rows: [], truncated: false };

    const productIds = products.map((p) => p.id);
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 2. Stock levels aggregated per product (ADR-1).
    // `stock_levels` is the auditable source; `products.stock_quantity` is the
    // denormalized mirror and is intentionally avoided here.
    const stockRaw = await (
      this.prisma.withoutScope() as {
        $queryRaw: <T>(query: any) => Promise<T>;
      }
    ).$queryRaw<Array<{ product_id: number; current_stock: string | number }>>(
      Prisma.sql`
        SELECT sl.product_id AS product_id,
               COALESCE(SUM(sl.quantity_available), 0)::decimal AS current_stock
        FROM stock_levels sl
        INNER JOIN inventory_locations il ON il.id = sl.location_id
        WHERE il.store_id = ${storeId}
          AND il.is_central_warehouse = false
          AND sl.product_id IN (${Prisma.join(productIds)})
        GROUP BY sl.product_id
      `,
    );
    const stockByProduct = new Map<number, number>();
    for (const row of stockRaw) {
      stockByProduct.set(Number(row.product_id), Number(row.current_stock));
    }

    // 3. Preferred supplier per product (ADR-3) — two passes.
    //    Pass A: pick the cheapest preferred (is_preferred=true) active goods
    //    supplier. Pass B: fallback to the cheapest active goods supplier if
    //    the product had no preferred link. Final bucket: products with no
    //    active goods supplier at all show `supplier_id = null`.
    const supplierRaw = await (
      this.prisma.withoutScope() as {
        $queryRaw: <T>(query: any) => Promise<T>;
      }
    ).$queryRaw<
      Array<{
        product_id: number;
        supplier_id: number;
        supplier_name: string;
        supplier_sku: string | null;
        cost_per_unit: string | number | null;
        is_preferred: boolean;
      }>
    >(Prisma.sql`
      SELECT DISTINCT ON (sp.product_id)
        sp.product_id           AS product_id,
        sp.supplier_id          AS supplier_id,
        s.name                  AS supplier_name,
        sp.supplier_sku         AS supplier_sku,
        sp.cost_per_unit        AS cost_per_unit,
        sp.is_preferred         AS is_preferred
      FROM supplier_products sp
      INNER JOIN suppliers s ON s.id = sp.supplier_id
      WHERE sp.product_id IN (${Prisma.join(productIds)})
        AND s.state = 'active'
        AND s.supplier_category = 'goods'
        AND s.organization_id = ${organizationId}
        AND (s.store_id = ${storeId} OR s.store_id IS NULL)
      ORDER BY sp.product_id, sp.is_preferred DESC, sp.cost_per_unit ASC NULLS LAST
    `);

    const supplierByProduct = new Map<
      number,
      {
        supplier_id: number;
        supplier_name: string;
        supplier_sku: string | null;
        cost_per_unit: number | null;
      }
    >();
    // First populate preferred links (already DISTINCT ON with is_preferred DESC).
    for (const row of supplierRaw) {
      if (!row.is_preferred) continue;
      supplierByProduct.set(Number(row.product_id), {
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name,
        supplier_sku: row.supplier_sku,
        cost_per_unit:
          row.cost_per_unit !== null ? Number(row.cost_per_unit) : null,
      });
    }
    // Fallback: cheapest active goods supplier for products without a
    // preferred link (ADR-3).
    for (const row of supplierRaw) {
      const pid = Number(row.product_id);
      if (supplierByProduct.has(pid)) continue;
      supplierByProduct.set(pid, {
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name,
        supplier_sku: row.supplier_sku,
        cost_per_unit:
          row.cost_per_unit !== null ? Number(row.cost_per_unit) : null,
      });
    }

    // 4. Last purchase per product (commitment + unit_price_net).
    //
    // Cross-store guard: purchase_orders.location_id points at an
    // inventory_location row; the row carries the owning store_id. We join
    // through inventory_locations and require pol.store_id = context.store_id
    // so a sibling store of the same organization cannot be picked as
    // "última compra" for this store's products. Same pattern the stock_levels
    // pass uses (`inventory_locations.store_id = ${storeId}`), so the universe
    // stays coherent across steps 2 and 4. Audit finding: without this JOIN,
    // a store with no committed purchases of its own still received a
    // last_purchase_date / last_purchase_cost / last_purchase_po_number taken
    // from a sister store's PO — silent cross-tenant leak.
    const purchaseRaw = await (
      this.prisma.withoutScope() as {
        $queryRaw: <T>(query: any) => Promise<T>;
      }
    ).$queryRaw<
      Array<{
        product_id: number;
        last_purchase_date: Date;
        last_purchase_cost: string | number | null;
        last_purchase_po_number: string;
      }>
    >(Prisma.sql`
      SELECT DISTINCT ON (poi.product_id)
        poi.product_id       AS product_id,
        po.created_at        AS last_purchase_date,
        poi.unit_price_net   AS last_purchase_cost,
        po.order_number      AS last_purchase_po_number
      FROM purchase_order_items poi
      INNER JOIN purchase_orders po
        ON po.id = poi.purchase_order_id
      INNER JOIN inventory_locations pol
        ON pol.id = po.location_id
        AND pol.store_id = ${storeId}
      WHERE poi.product_id IN (${Prisma.join(productIds)})
        AND po.status IN (${sqlStateList(PURCHASE_COMMITTED_STATES)})
        AND po.organization_id = ${organizationId}
      ORDER BY poi.product_id, po.created_at DESC
    `);
    const purchaseByProduct = new Map<
      number,
      {
        last_purchase_date: Date;
        last_purchase_cost: number | null;
        last_purchase_po_number: string;
      }
    >();
    for (const row of purchaseRaw) {
      purchaseByProduct.set(Number(row.product_id), {
        last_purchase_date: row.last_purchase_date,
        last_purchase_cost:
          row.last_purchase_cost !== null
            ? Number(row.last_purchase_cost)
            : null,
        last_purchase_po_number: row.last_purchase_po_number,
      });
    }

    // 5. Days without sale per product (delivered/finished, store-scoped).
    const saleRaw = await (
      this.prisma.withoutScope() as {
        $queryRaw: <T>(query: any) => Promise<T>;
      }
    ).$queryRaw<Array<{ product_id: number; last_sale: Date }>>(
      Prisma.sql`
        SELECT oi.product_id AS product_id,
               MAX(o.created_at) AS last_sale
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id IN (${Prisma.join(productIds)})
          AND o.store_id = ${storeId}
          AND o.state IN (${sqlStateList(COMPLETED_SALE_STATES)})
          AND oi.product_id IS NOT NULL
        GROUP BY oi.product_id
      `,
    );
    const lastSaleByProduct = new Map<number, Date>();
    for (const row of saleRaw) {
      lastSaleByProduct.set(Number(row.product_id), row.last_sale);
    }

    // 6. 24h movements to estimate previous stock (ADR-2).
    //    `im.quantity` is the UNSIGNED magnitude (stock-level-manager writes
    //    `Math.abs(quantity_change)`). We must apply the sign here based on
    //    movement_type, matching the pattern in {@link getMovementTrends}.
    //    Without the CASE, the SUM would add outbound magnitudes as if they
    //    were inbound and invert the delta — blocker audit #2.
    const movementRaw = await (
      this.prisma.withoutScope() as {
        $queryRaw: <T>(query: any) => Promise<T>;
      }
    ).$queryRaw<Array<{ product_id: number; net: string | number }>>(
      Prisma.sql`
        SELECT im.product_id AS product_id,
               COALESCE(SUM(
                 CASE
                   WHEN im.movement_type IN (${sqlStateList([...INBOUND_MOVEMENT_TYPES])})
                     THEN im.quantity
                   WHEN im.movement_type IN (${sqlStateList([...OUTBOUND_MOVEMENT_TYPES])})
                     THEN -im.quantity
                   ELSE 0
                 END
               ), 0)::decimal AS net
        FROM inventory_movements im
        WHERE im.product_id IN (${Prisma.join(productIds)})
          AND im.created_at >= ${since24h}
          AND im.created_at <= ${now}
          AND im.movement_type IN (
            ${sqlStateList([...INBOUND_MOVEMENT_TYPES, ...OUTBOUND_MOVEMENT_TYPES])}
          )
        GROUP BY im.product_id
      `,
    );
    const netMovementByProduct = new Map<number, number>();
    for (const row of movementRaw) {
      netMovementByProduct.set(Number(row.product_id), Number(row.net));
    }

    // 7. Build the rows in memory. The threshold filter is applied HERE
    //    (after the cap, so the universe is bounded first, but only rows
    //    that qualify as low-stock are emitted). Without this guard, the
    //    report would return every active product — blocker audit #1.
    const rows: LowStockBySupplierRow[] = [];
    for (const product of products) {
      const currentStock = stockByProduct.get(product.id) ?? 0;
      const threshold = resolveProductLowStockThreshold(settings, product);
      // Threshold gate: skip products whose stock is at or above the
      // threshold (i.e. NOT low-stock). The status flag below is only
      // emitted for rows that survive this check.
      if (currentStock > threshold) continue;
      const status: LowStockBySupplierRow['status'] =
        currentStock === 0 ? 'out_of_stock' : 'low_stock';

      const supplier = supplierByProduct.get(product.id);
      const purchase = purchaseByProduct.get(product.id);
      const lastSale = lastSaleByProduct.get(product.id);
      const net24h = netMovementByProduct.get(product.id);

      let previousStock: number | null = null;
      let previousStockSource: LowStockBySupplierRow['previous_stock_source'] =
        'na';
      let delta: number | null = null;
      if (net24h !== undefined) {
        previousStock = currentStock - net24h;
        previousStockSource = 'estimated';
        delta = currentStock - previousStock;
      }

      const unitsPerPackage = product.purchase_to_stock_factor ?? 1;

      rows.push({
        product_id: product.id,
        product_name: product.name,
        sku: product.sku ?? null,
        current_stock: currentStock,
        previous_stock: previousStock,
        previous_stock_source: previousStockSource,
        delta: delta,
        min_threshold: threshold,
        status,
        supplier_id: supplier?.supplier_id ?? null,
        supplier_name: supplier?.supplier_name ?? 'Sin proveedor asignado',
        supplier_sku: supplier?.supplier_sku ?? null,
        last_purchase_date: purchase?.last_purchase_date ?? null,
        last_purchase_cost: purchase?.last_purchase_cost ?? null,
        last_purchase_po_number: purchase?.last_purchase_po_number ?? null,
        days_without_sale:
          lastSale !== undefined
            ? Math.floor(
                (now.getTime() - lastSale.getTime()) / (1000 * 60 * 60 * 24),
              )
            : null,
        units_per_package: unitsPerPackage,
      });
    }

    // Apply user filters AFTER the join (status, supplier_id, without_supplier).
    // `category_id` was already pushed into the products WHERE clause above.
    let filtered = rows;
    if (query.status === LowStockStatusFilter.LOW_STOCK) {
      filtered = filtered.filter(
        (r) => r.status === 'low_stock' && r.current_stock > 0,
      );
    } else if (query.status === LowStockStatusFilter.OUT_OF_STOCK) {
      filtered = filtered.filter((r) => r.status === 'out_of_stock');
    }
    if (query.supplier_id !== undefined) {
      filtered = filtered.filter(
        (r) => r.supplier_id === query.supplier_id,
      );
    } else if (query.without_supplier === true) {
      // Major R2-M7: drill-down on the analytics chart's "Sin proveedor"
      // bucket. Mutually exclusive with `supplier_id` (handled by the
      // `else if`).
      filtered = filtered.filter((r) => r.supplier_id === null);
    }

    return { rows: filtered, truncated };
  }

  /**
   * Aggregates the row set into the analytics envelope (FB-06).
   * - `kpis`: counts + value-at-risk + average days without sale.
   * - `by_supplier`: GROUP BY supplier (including the `null` bucket).
   * - `by_category`: re-reads the products→categories mapping once (the row
   *   set already carries the supplier pivot but NOT the category pivot).
   * - `top_critical`: top 10 by `value_at_risk DESC`, excluding unauditable
   *   rows (cost = null/0) — see {@link buildCostCoverage}.
   * - `history_30d`: OMITTED when no daily snapshot table exists.
   */
  private async buildLowStockBySupplierAnalytics(
    rows: LowStockBySupplierRow[],
  ): Promise<LowStockBySupplierAnalyticsEnvelope> {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;

    // Categories — one query for the category name per row.
    let categoryByProduct = new Map<number, { id: number; name: string }>();
    if (rows.length > 0) {
      const links = await this.prisma.product_categories.findMany({
        where: {
          product_id: { in: rows.map((r) => r.product_id) },
        },
        select: {
          product_id: true,
          categories: { select: { id: true, name: true } },
        },
      });
      for (const link of links) {
        categoryByProduct.set(link.product_id, {
          id: link.categories.id,
          name: link.categories.name,
        });
      }
    }

    // Cost for value_at_risk: prefer supplier_products.cost_per_unit
    // (carried on the row as `cost_per_unit` — but the row doesn't expose
    // it, so we re-read by supplier_id for rows with a supplier).
    const supplierIds = Array.from(
      new Set(
        rows
          .map((r) => r.supplier_id)
          .filter((id): id is number => id !== null),
      ),
    );
    const supplierCostMap = new Map<number, number | null>();
    if (supplierIds.length > 0 && storeId) {
      const links = await (
        this.prisma.withoutScope() as {
          $queryRaw: <T>(query: any) => Promise<T>;
        }
      ).$queryRaw<
        Array<{
          product_id: number;
          supplier_id: number;
          cost_per_unit: string | number | null;
        }>
      >(Prisma.sql`
        SELECT DISTINCT ON (product_id)
          product_id, supplier_id, cost_per_unit
        FROM supplier_products
        WHERE product_id IN (${Prisma.join(rows.map((r) => r.product_id))})
          AND supplier_id IN (${Prisma.join(supplierIds)})
          AND is_preferred = true
        ORDER BY product_id, cost_per_unit ASC NULLS LAST
      `);
      for (const link of links) {
        supplierCostMap.set(
          link.product_id,
          link.cost_per_unit !== null ? Number(link.cost_per_unit) : null,
        );
      }
    }

    // Per-row enriched view (category + auditable cost).
    type EnrichedRow = LowStockBySupplierRow & {
      category_id: number | null;
      category_name: string;
      value_at_risk: number | null;
      unauditable: boolean;
    };
    // Cost resolution must reject null, undefined AND NaN/Infinity. A loose
    // `cost !== null` check used to let `undefined` slip through (when the
    // preferred-supplier map has no entry for the product) — `current_stock *
    // undefined` yields NaN, which then poisoned the KPI sum (NaN →
    // JSON null → UI "$0"). We use `Number.isFinite` to gate both the
    // multiplication and the later accumulator, so any non-finite value
    // re-routes to `unauditable` / `unitsWithoutCost` instead of propagating.
    const isFiniteCost = (v: number | null | undefined): v is number =>
      typeof v === 'number' && Number.isFinite(v);
    const enriched: EnrichedRow[] = rows.map((row) => {
      const cat = categoryByProduct.get(row.product_id);
      const preferredCost = supplierCostMap.get(row.product_id);
      // Fallback cost: re-read product.cost_price for rows without a
      // preferred supplier link.
      const cost =
        preferredCost !== undefined
          ? preferredCost
          : null; // resolved below in a second pass for the fallback case
      return {
        ...row,
        category_id: cat?.id ?? null,
        category_name: cat?.name ?? 'Sin categoría',
        // Cost resolution handled by buildCostCoverage semantics below.
        value_at_risk: isFiniteCost(cost) ? row.current_stock * cost : null,
        unauditable: !isFiniteCost(cost),
      };
    });

    // Fallback pass: re-read product.cost_price for rows with no preferred
    // supplier cost (keeps the value_at_risk auditable when possible).
    const needFallback = enriched.filter((r) => r.value_at_risk === null);
    if (needFallback.length > 0) {
      const fallback = await this.prisma.products.findMany({
        where: {
          id: { in: needFallback.map((r) => r.product_id) },
        },
        select: { id: true, cost_price: true },
      });
      const fallbackMap = new Map<number, number | null>();
      for (const p of fallback) {
        fallbackMap.set(
          p.id,
          p.cost_price !== null ? Number(p.cost_price) : null,
        );
      }
      for (const row of enriched) {
        if (row.value_at_risk !== null) continue;
        const fallbackCost = fallbackMap.get(row.product_id);
        if (isFiniteCost(fallbackCost)) {
          row.value_at_risk = row.current_stock * fallbackCost;
          row.unauditable = false;
        }
      }
    }

    // KPIs.
    let totalLowStock = 0;
    let totalOutOfStock = 0;
    let totalValueAtRisk = 0;
    let daysSum = 0;
    let daysCount = 0;
    let productsWithoutSupplier = 0;
    // Tracks rows whose value_at_risk could not be resolved (no preferred
    // supplier cost AND no product.cost_price fallback). They contribute
    // zero to totalValueAtRisk but roll into cost_coverage so the UI can
    // surface "X productos sin costo registrado — valor no auditable"
    // instead of silently swallowing the gap.
    let unitsWithoutCost = 0;
    for (const r of enriched) {
      if (r.status === 'low_stock') totalLowStock++;
      else if (r.status === 'out_of_stock') totalOutOfStock++;
      // `Number.isFinite` rejects NaN/Infinity; before this guard, a single
      // NaN row would poison the SUM (`NaN + finite = NaN`) and bubble up to
      // the frontend as `null` → KPI rendered as `$0`. Now non-finite values
      // are routed to `unitsWithoutCost` so the cost-coverage UI can surface
      // them instead.
      if (Number.isFinite(r.value_at_risk)) {
        totalValueAtRisk += r.value_at_risk as number;
      } else {
        unitsWithoutCost++;
      }
      if (r.days_without_sale !== null) {
        daysSum += r.days_without_sale;
        daysCount++;
      }
      if (r.supplier_id === null) productsWithoutSupplier++;
    }

    // Cost coverage mirrors the contract used by getInventoryValuation so
    // the UI renders "X / Y con costo conocido" the same way across reports.
    const unitsTotal = enriched.length;
    const costCoverage = buildCostCoverage(unitsTotal, unitsWithoutCost);

    // by_supplier (includes the null bucket as 'Sin proveedor asignado').
    const supplierBuckets = new Map<
      number | null,
      {
        supplier_id: number | null;
        supplier_name: string;
        low_stock_count: number;
        out_of_stock_count: number;
        value_at_risk: number;
      }
    >();
    for (const r of enriched) {
      const key = r.supplier_id;
      const bucket =
        supplierBuckets.get(key) ??
        {
          supplier_id: key,
          supplier_name: r.supplier_name ?? 'Sin proveedor asignado',
          low_stock_count: 0,
          out_of_stock_count: 0,
          value_at_risk: 0,
        };
      if (r.status === 'low_stock') bucket.low_stock_count++;
      else if (r.status === 'out_of_stock') bucket.out_of_stock_count++;
      if (Number.isFinite(r.value_at_risk)) bucket.value_at_risk += r.value_at_risk as number;
      supplierBuckets.set(key, bucket);
    }

    // by_category (includes the null bucket as 'Sin categoría').
    const categoryBuckets = new Map<
      number | null,
      {
        category_id: number | null;
        category_name: string;
        low_stock_count: number;
        out_of_stock_count: number;
      }
    >();
    for (const r of enriched) {
      const key = r.category_id;
      const bucket =
        categoryBuckets.get(key) ??
        {
          category_id: key,
          category_name: r.category_name,
          low_stock_count: 0,
          out_of_stock_count: 0,
        };
      if (r.status === 'low_stock') bucket.low_stock_count++;
      else if (r.status === 'out_of_stock') bucket.out_of_stock_count++;
      categoryBuckets.set(key, bucket);
    }

    // top_critical — top 10 by value_at_risk DESC, excluding unauditable.
    const auditable = enriched.filter(
      (r) => !r.unauditable && Number.isFinite(r.value_at_risk),
    );
    const topCritical = auditable
      .sort((a, b) => (b.value_at_risk as number) - (a.value_at_risk as number))
      .slice(0, 10)
      .map((r) => ({
        product_id: r.product_id,
        product_name: r.product_name,
        sku: r.sku,
        current_stock: r.current_stock,
        min_threshold: r.min_threshold,
        status: r.status,
        supplier_name: r.supplier_name,
        value_at_risk: Math.round((r.value_at_risk as number) * 100) / 100,
      }));

    const envelope: LowStockBySupplierAnalyticsEnvelope = {
      kpis: {
        total_low_stock: totalLowStock,
        total_out_of_stock: totalOutOfStock,
        total_value_at_risk: Math.round(totalValueAtRisk * 100) / 100,
        avg_days_without_sale:
          daysCount > 0 ? Math.round((daysSum / daysCount) * 100) / 100 : null,
        products_without_supplier: productsWithoutSupplier,
      },
      by_supplier: Array.from(supplierBuckets.values()).map((b) => ({
        supplier_id: b.supplier_id,
        supplier_name: b.supplier_name,
        low_stock_count: b.low_stock_count,
        out_of_stock_count: b.out_of_stock_count,
        value_at_risk: Math.round(b.value_at_risk * 100) / 100,
      })),
      by_category: Array.from(categoryBuckets.values()),
      top_critical: topCritical,
      // Cobertura del valor-en-riesgo: cuando unidades sin costo > 0,
      // `total_value_at_risk` está subestimado. El frontend usa este campo
      // para mostrar "X / Y con costo conocido" en la card de valor.
      cost_coverage: costCoverage,
      // history_30d intentionally omitted — no daily stock snapshot table
      // exists in the current schema (Phase A.2 decision, ADR-2).
    };

    return envelope;
  }
}
