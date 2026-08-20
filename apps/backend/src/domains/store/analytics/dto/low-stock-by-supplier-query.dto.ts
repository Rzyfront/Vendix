import { IsBoolean, IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { InventoryAnalyticsQueryDto } from './analytics-query.dto';

/**
 * Stock status filter for the low-stock-by-supplier report.
 *
 * - `low_stock`    — products with `0 < current_stock ≤ min_threshold`
 * - `out_of_stock` — products with `current_stock === 0`
 *
 * Both buckets together = "all" — leave the field `undefined` to include
 * both. This shape stays compatible with the parent DTO's literal type
 * (`'low_stock' | 'out_of_stock' | ...`), which is required to extend
 * `InventoryAnalyticsQueryDto` cleanly.
 */
export enum LowStockStatusFilter {
  LOW_STOCK = 'low_stock',
  OUT_OF_STOCK = 'out_of_stock',
}

/**
 * DTO for the report "Stock Bajo por Proveedor".
 *
 * Reuses the inventory filters from {@link InventoryAnalyticsQueryDto}
 * (location_id, as_of, category_id, days_threshold) and narrows the
 * `status` filter to the report's two valid buckets + an `all` escape.
 *
 * Field semantics inherited from the parent DTO are unchanged.
 *
 * Permissions: `@Permissions('store:analytics:read')` — no new permission.
 *
 * Contract: FB-01 (rows) and FB-02 (XLSX export).
 */
export class LowStockBySupplierQueryDto extends InventoryAnalyticsQueryDto {
  /** Filter to a single preferred supplier of the active store. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  supplier_id?: number;

  /**
   * Filter to products whose preferred supplier could not be resolved
   * (`supplier_id IS NULL`). Used by the analytics chart click on the
   * "Sin proveedor asignado" bucket — Angular drops `null` from
   * `queryParams`, so the analytics page forwards `without_supplier=true`
   * instead.
   *
   * Major R2-M7: mutually exclusive with `supplier_id`. When both are
   * present, `supplier_id` wins (a positive int beats the null bucket).
   */
  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === 'true' || value === 1 || value === '1',
  )
  @IsBoolean()
  without_supplier?: boolean;

  /**
   * Narrow the stock-status filter. Defaults to `undefined` (both buckets).
   *
   * The parent DTO accepts `in_stock | low_stock | out_of_stock | overstock`;
   * this report only surfaces the two "needs reordering" buckets — leave the
   * field `undefined` to include both.
   */
  @IsOptional()
  @IsEnum(LowStockStatusFilter)
  status?: LowStockStatusFilter;
}

/**
 * DTO for the analytics shell endpoint "Stock Bajo por Proveedor" (Phase H).
 *
 * Reuses the parent DTO's inherited `date_from` / `date_to` from
 * {@link BaseReportQueryDto} (via `InventoryAnalyticsQueryDto`) — these gate
 * the `history_30d` series in the analytics envelope. The rows in the
 * response are NOT bounded by date — they always reflect CURRENT stock — only
 * the historical series is filtered.
 *
 * Earlier revisions carried a `history_from` / `history_to` pair; they were
 * renamed to align with FB-06 and ERR-05 (the analytics endpoint already uses
 * the parent DTO's `date_from` / `date_to` everywhere else in the codebase).
 *
 * Contract: FB-06.
 */
export class LowStockBySupplierAnalyticsQueryDto extends LowStockBySupplierQueryDto {}
