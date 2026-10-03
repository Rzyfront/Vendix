import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  DEFAULT_STORE_TIMEZONE,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
import { parseDateRange } from '../utils/date.util';
import {
  COMPLETED_SALE_STATES,
  PURCHASE_COMMITTED_STATES,
  round2,
  sqlStateList,
} from '../analytics-metrics.contract';
import {
  SalesByDimensionQueryDto,
  SalesDimension,
} from '../dto/sales-by-dimension-query.dto';

/** Safety ceiling per export sheet (same order of magnitude as sales export). */
export const SALES_DIMENSION_EXPORT_HARD_LIMIT = 100_000;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export const NULL_DIMENSION_LABEL: Record<SalesDimension, string> = {
  supplier: 'Sin proveedor',
  brand: 'Sin marca',
};
export const NO_ADVISOR_LABEL = 'Sin asesor';
export const NO_CUSTOMER_LABEL = 'Consumidor final / sin cliente';

export interface SalesDimensionSummary {
  net_sales: number;
  units: number;
  orders: number;
  impacted_customers: number;
  distinct_references: number;
}

interface DimensionBase {
  dimension_id: number | null;
  dimension_name: string;
}

export interface SalesByProductRow extends DimensionBase {
  product_id: number;
  product_variant_id: number | null;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  units: number;
  net_sales: number;
  orders: number;
  customers: number;
}

export interface SalesByUserRow extends DimensionBase {
  user_id: number | null;
  user_name: string;
  user_document: string | null;
  units: number;
  net_sales: number;
  orders: number;
  customers: number;
  references: number;
}

export interface SalesByCustomerRow extends DimensionBase {
  customer_id: number | null;
  customer_name: string;
  customer_document: string | null;
  units: number;
  net_sales: number;
  orders: number;
  references: number;
}

export interface SalesDimensionSummaryRow extends DimensionBase {
  units: number;
  net_sales: number;
  orders: number;
  customers: number;
  references: number;
}

export type SalesDimensionRow =
  | SalesByProductRow
  | SalesByUserRow
  | SalesByCustomerRow;

export interface SalesByDimensionResult {
  rows: SalesDimensionRow[];
  total: number;
  page: number;
  limit: number;
  summary: SalesDimensionSummary;
}

export interface SalesByDimensionExportResult {
  dimension_rows: SalesDimensionSummaryRow[];
  by_product: SalesByProductRow[];
  by_user: SalesByUserRow[];
  by_customer: SalesByCustomerRow[];
  truncated: boolean;
}

/** Converts bigint / Decimal / numeric string / null to a plain number. */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return Number(String(value));
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

function dimensionBase(
  raw: { dimension_id: unknown; dimension_name: unknown },
  dimension: SalesDimension,
): DimensionBase {
  const id = toNullableNumber(raw.dimension_id);
  return {
    dimension_id: id,
    dimension_name:
      id === null || !raw.dimension_name
        ? NULL_DIMENSION_LABEL[dimension]
        : String(raw.dimension_name),
  };
}

export function mapSummaryRow(raw: Record<string, unknown> | undefined): SalesDimensionSummary {
  return {
    net_sales: round2(toNumber(raw?.net_sales)),
    units: toNumber(raw?.units),
    orders: toNumber(raw?.orders),
    impacted_customers: toNumber(raw?.customers),
    distinct_references: toNumber(raw?.refs),
  };
}

export function mapDimensionSummaryRow(
  raw: Record<string, unknown>,
  dimension: SalesDimension,
): SalesDimensionSummaryRow {
  return {
    ...dimensionBase(raw as any, dimension),
    units: toNumber(raw.units),
    net_sales: round2(toNumber(raw.net_sales)),
    orders: toNumber(raw.orders),
    customers: toNumber(raw.customers),
    references: toNumber(raw.refs),
  };
}

export function mapProductRow(
  raw: Record<string, unknown>,
  dimension: SalesDimension,
): SalesByProductRow {
  return {
    ...dimensionBase(raw as any, dimension),
    product_id: toNumber(raw.product_id),
    product_variant_id: toNullableNumber(raw.product_variant_id),
    product_name: raw.product_name ? String(raw.product_name) : '',
    variant_name: raw.variant_name ? String(raw.variant_name) : null,
    sku: raw.sku ? String(raw.sku) : null,
    units: toNumber(raw.units),
    net_sales: round2(toNumber(raw.net_sales)),
    orders: toNumber(raw.orders),
    customers: toNumber(raw.customers),
  };
}

export function mapUserRow(
  raw: Record<string, unknown>,
  dimension: SalesDimension,
): SalesByUserRow {
  const userId = toNullableNumber(raw.user_id);
  return {
    ...dimensionBase(raw as any, dimension),
    user_id: userId,
    user_name:
      userId === null || !raw.user_name ? NO_ADVISOR_LABEL : String(raw.user_name),
    user_document: raw.user_document ? String(raw.user_document) : null,
    units: toNumber(raw.units),
    net_sales: round2(toNumber(raw.net_sales)),
    orders: toNumber(raw.orders),
    customers: toNumber(raw.customers),
    references: toNumber(raw.refs),
  };
}

export function mapCustomerRow(
  raw: Record<string, unknown>,
  dimension: SalesDimension,
): SalesByCustomerRow {
  const customerId = toNullableNumber(raw.customer_id);
  return {
    ...dimensionBase(raw as any, dimension),
    customer_id: customerId,
    customer_name:
      customerId === null || !raw.customer_name
        ? NO_CUSTOMER_LABEL
        : String(raw.customer_name),
    customer_document: raw.customer_document
      ? String(raw.customer_document)
      : null,
    units: toNumber(raw.units),
    net_sales: round2(toNumber(raw.net_sales)),
    orders: toNumber(raw.orders),
    references: toNumber(raw.refs),
  };
}

export interface LineSalesParams {
  dimension: SalesDimension;
  storeId: number;
  organizationId: number;
  startDate: Date;
  endDate: Date;
  ids?: number[];
}

/**
 * Builds the shared CTE chain ending in `line_sales`: one row per NON-cancelled
 * order line of a completed sale, carrying its net sales and attributed
 * dimension (supplier or brand).
 *
 * Net sales of a line = `total_price` (base, before discount, no VAT, no
 * freight) minus its discount. Findings on `orders.discount_amount` (see
 * orders.service `applyGrossDiscountToPlannedLines` and the schema comment of
 * `order_items.discount_amount`): in the current POS/editor contract
 * `orders.discount_amount` IS the sum of the per-line base discounts
 * (`retax.totalBaseDiscount`), so those lines already carry it. Only legacy
 * lines (`discount_amount IS NULL`) still rely on the order-level discount, and
 * for them we spread ONLY the residual
 * `order discount - SUM(non-null line discounts)` by `total_price` weight.
 *
 * Supplier attribution (same rule as inventory-analytics `getInventoryBySupplier`):
 * supplier_products (is_preferred first, then lowest id) -> supplier of the
 * latest committed purchase order containing the product -> "Sin proveedor".
 * Supplier `state`/`supplier_category` are NOT filtered so history is kept.
 */
export function buildLineSalesCte(p: LineSalesParams): Prisma.Sql {
  const isSupplier = p.dimension === 'supplier';

  const productSupplierCte = isSupplier
    ? Prisma.sql`,
    product_supplier AS (
      SELECT pid.product_id,
        COALESCE(
          (SELECT sp.supplier_id
             FROM supplier_products sp
             INNER JOIN suppliers s ON s.id = sp.supplier_id
            WHERE sp.product_id = pid.product_id
              AND s.organization_id = ${p.organizationId}
              AND (s.store_id = ${p.storeId} OR s.store_id IS NULL)
            ORDER BY sp.is_preferred DESC, sp.id ASC
            LIMIT 1),
          (SELECT po.supplier_id
             FROM purchase_order_items poi
             INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
             INNER JOIN inventory_locations il ON il.id = po.location_id
             INNER JOIN suppliers s ON s.id = po.supplier_id
            WHERE poi.product_id = pid.product_id
              AND il.store_id = ${p.storeId}
              AND po.organization_id = ${p.organizationId}
              AND po.status IN (${sqlStateList(PURCHASE_COMMITTED_STATES)})
              AND (s.store_id = ${p.storeId} OR s.store_id IS NULL)
            ORDER BY po.created_at DESC, po.id DESC
            LIMIT 1)
        ) AS supplier_id
      FROM (SELECT DISTINCT product_id FROM base WHERE product_id IS NOT NULL) pid
    )`
    : Prisma.empty;

  const dimensionJoin = isSupplier
    ? Prisma.sql`LEFT JOIN product_supplier ps ON ps.product_id = b.product_id
      LEFT JOIN suppliers d ON d.id = ps.supplier_id`
    : Prisma.sql`LEFT JOIN products pr ON pr.id = b.product_id
      LEFT JOIN brands d ON d.id = pr.brand_id`;

  const idsFilter =
    p.ids && p.ids.length > 0
      ? Prisma.sql`WHERE COALESCE(d.id, 0) IN (${Prisma.join(p.ids)})`
      : Prisma.empty;

  return Prisma.sql`
    WITH base AS (
      SELECT o.id AS order_id, o.customer_id, o.created_by_user_id,
             oi.product_id, oi.product_variant_id, oi.quantity,
             oi.total_price, oi.discount_amount AS line_discount,
             oi.product_name AS item_product_name,
             o.discount_amount AS order_discount,
             SUM(COALESCE(oi.discount_amount, 0)) OVER (PARTITION BY o.id) AS order_line_discounts,
             SUM(CASE WHEN oi.discount_amount IS NULL THEN oi.total_price ELSE 0 END)
               OVER (PARTITION BY o.id) AS order_null_lines_total
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
       WHERE o.store_id = ${p.storeId}
         AND o.state IN (${sqlStateList(COMPLETED_SALE_STATES)})
         AND oi.cancelled_at IS NULL
         AND o.created_at >= ${p.startDate}
         AND o.created_at <= ${p.endDate}
    )${productSupplierCte},
    line_sales AS (
      SELECT d.id AS dimension_id, d.name AS dimension_name,
             b.order_id, b.customer_id, b.created_by_user_id AS user_id,
             b.product_id, b.product_variant_id, b.item_product_name, b.quantity,
             (b.total_price - COALESCE(
                b.line_discount,
                GREATEST(b.order_discount - b.order_line_discounts, 0)
                  * b.total_price / NULLIF(b.order_null_lines_total, 0),
                0)) AS net_sales
        FROM base b
        ${dimensionJoin}
        ${idsFilter}
    )`;
}

const REF_EXPR = Prisma.sql`(COALESCE(ls.product_id, 0), COALESCE(ls.product_variant_id, 0))`;

@Injectable()
export class SalesDimensionAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private async getStoreTimezone(): Promise<string> {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) return DEFAULT_STORE_TIMEZONE;
    return resolveStoreTimezone(this.prisma, storeId);
  }

  private async buildParams(
    query: SalesByDimensionQueryDto,
  ): Promise<LineSalesParams> {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new ForbiddenException('Store context required');
    }
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    return {
      dimension: query.dimension,
      storeId: context.store_id,
      organizationId: context.organization_id,
      startDate,
      endDate,
      ids: query.ids,
    };
  }

  private raw<T = Record<string, unknown>>(sql: Prisma.Sql): Promise<T[]> {
    return (this.prisma.withoutScope() as any).$queryRaw(sql) as Promise<T[]>;
  }

  private summarySql(cte: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`${cte}
      SELECT COALESCE(SUM(ls.net_sales), 0) AS net_sales,
             COALESCE(SUM(ls.quantity), 0) AS units,
             COUNT(DISTINCT ls.order_id) AS orders,
             COUNT(DISTINCT ls.customer_id) AS customers,
             COUNT(DISTINCT ${REF_EXPR}) AS refs
        FROM line_sales ls`;
  }

  /** Per-dimension totals (Resumen sheet). */
  private dimensionSummarySql(cte: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`${cte}
      SELECT ls.dimension_id, ls.dimension_name,
             SUM(ls.quantity) AS units, SUM(ls.net_sales) AS net_sales,
             COUNT(DISTINCT ls.order_id) AS orders,
             COUNT(DISTINCT ls.customer_id) AS customers,
             COUNT(DISTINCT ${REF_EXPR}) AS refs
        FROM line_sales ls
       GROUP BY ls.dimension_id, ls.dimension_name
       ORDER BY SUM(ls.net_sales) DESC, ls.dimension_id ASC NULLS LAST`;
  }

  /** View SQL; `paging` null = no OFFSET, limited to the export hard limit. */
  viewSql(
    view: 'product' | 'user' | 'customer',
    cte: Prisma.Sql,
    limit: number,
    offset: number,
  ): Prisma.Sql {
    const paging = Prisma.sql`LIMIT ${limit} OFFSET ${offset}`;
    if (view === 'user') {
      return Prisma.sql`${cte}
        SELECT ls.dimension_id, ls.dimension_name, ls.user_id,
               MAX(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '')) AS user_name,
               MAX(u.document_number) AS user_document,
               SUM(ls.quantity) AS units, SUM(ls.net_sales) AS net_sales,
               COUNT(DISTINCT ls.order_id) AS orders,
               COUNT(DISTINCT ls.customer_id) AS customers,
               COUNT(DISTINCT ${REF_EXPR}) AS refs,
               COUNT(*) OVER() AS total
          FROM line_sales ls
          LEFT JOIN users u ON u.id = ls.user_id
         GROUP BY ls.dimension_id, ls.dimension_name, ls.user_id
         ORDER BY SUM(ls.net_sales) DESC, ls.dimension_id ASC NULLS LAST, ls.user_id ASC NULLS LAST
         ${paging}`;
    }
    if (view === 'customer') {
      return Prisma.sql`${cte}
        SELECT ls.dimension_id, ls.dimension_name, ls.customer_id,
               MAX(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '')) AS customer_name,
               MAX(u.document_number) AS customer_document,
               SUM(ls.quantity) AS units, SUM(ls.net_sales) AS net_sales,
               COUNT(DISTINCT ls.order_id) AS orders,
               COUNT(DISTINCT ${REF_EXPR}) AS refs,
               COUNT(*) OVER() AS total
          FROM line_sales ls
          LEFT JOIN users u ON u.id = ls.customer_id
         GROUP BY ls.dimension_id, ls.dimension_name, ls.customer_id
         ORDER BY SUM(ls.net_sales) DESC, ls.dimension_id ASC NULLS LAST, ls.customer_id ASC NULLS LAST
         ${paging}`;
    }
    return Prisma.sql`${cte}
      SELECT ls.dimension_id, ls.dimension_name,
             COALESCE(ls.product_id, 0) AS product_id, ls.product_variant_id,
             COALESCE(MAX(p.name), MAX(ls.item_product_name)) AS product_name,
             MAX(pv.name) AS variant_name,
             COALESCE(MAX(pv.sku), MAX(p.sku)) AS sku,
             SUM(ls.quantity) AS units, SUM(ls.net_sales) AS net_sales,
             COUNT(DISTINCT ls.order_id) AS orders,
             COUNT(DISTINCT ls.customer_id) AS customers,
             COUNT(*) OVER() AS total
        FROM line_sales ls
        LEFT JOIN products p ON p.id = ls.product_id
        LEFT JOIN product_variants pv ON pv.id = ls.product_variant_id
       GROUP BY ls.dimension_id, ls.dimension_name, COALESCE(ls.product_id, 0), ls.product_variant_id
       ORDER BY SUM(ls.net_sales) DESC, ls.dimension_id ASC NULLS LAST,
                COALESCE(ls.product_id, 0) ASC, ls.product_variant_id ASC NULLS LAST
       ${paging}`;
  }

  private mapView(
    view: 'product' | 'user' | 'customer',
    raws: Record<string, unknown>[],
    dimension: SalesDimension,
  ): SalesDimensionRow[] {
    if (view === 'user') return raws.map((r) => mapUserRow(r, dimension));
    if (view === 'customer') return raws.map((r) => mapCustomerRow(r, dimension));
    return raws.map((r) => mapProductRow(r, dimension));
  }

  async getSalesByDimension(
    query: SalesByDimensionQueryDto,
  ): Promise<SalesByDimensionResult> {
    const params = await this.buildParams(query);
    const view = query.view ?? 'product';
    const page = Math.max(query.page ?? DEFAULT_PAGE, 1);
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cte = buildLineSalesCte(params);

    const [summaryRows, rawRows] = await Promise.all([
      this.raw(this.summarySql(cte)),
      this.raw(this.viewSql(view, cte, limit, (page - 1) * limit)),
    ]);

    return {
      rows: this.mapView(view, rawRows, params.dimension),
      total: rawRows.length > 0 ? toNumber(rawRows[0].total) : 0,
      page,
      limit,
      summary: mapSummaryRow(summaryRows[0]),
    };
  }

  async getSalesByDimensionForExport(
    query: SalesByDimensionQueryDto,
  ): Promise<SalesByDimensionExportResult> {
    const params = await this.buildParams(query);
    const cte = buildLineSalesCte(params);
    const lim = SALES_DIMENSION_EXPORT_HARD_LIMIT;

    const [dims, products, users, customers] = await Promise.all([
      this.raw(this.dimensionSummarySql(cte)),
      this.raw(this.viewSql('product', cte, lim, 0)),
      this.raw(this.viewSql('user', cte, lim, 0)),
      this.raw(this.viewSql('customer', cte, lim, 0)),
    ]);

    const truncated = [products, users, customers].some(
      (r) => r.length > 0 && toNumber(r[0].total) > lim,
    );
    return {
      dimension_rows: dims.map((r) => mapDimensionSummaryRow(r, params.dimension)),
      by_product: products.map((r) => mapProductRow(r, params.dimension)),
      by_user: users.map((r) => mapUserRow(r, params.dimension)),
      by_customer: customers.map((r) => mapCustomerRow(r, params.dimension)),
      truncated,
    };
  }
}
