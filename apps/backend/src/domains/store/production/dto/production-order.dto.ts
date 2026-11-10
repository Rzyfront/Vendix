import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * DTO to create a draft production order.
 *
 * The production order header carries:
 * - product_id:  the sub-recipe `prepared` product that this batch will produce
 * - recipe_id:   the BOM/receta attached to that product (1:1 logical)
 * - planned_qty: how much the kitchen intends to produce (in `yield_unit`)
 *
 * The service validates that product_id is `product_type='prepared' + is_batch_produced=true`
 * and that the recipe belongs to the same product. The actual `produced_qty`
 * (post-merma) is captured later by `POST /:id/complete`.
 */
export class CreateProductionOrderDto {
  @IsInt()
  @IsPositive()
  product_id!: number;

  @IsInt()
  @IsPositive()
  recipe_id!: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Type(() => Number)
  planned_qty!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Lightweight DTO for state changes (`start`, `cancel`) and metadata tweaks.
 *
 * Only `notes` is editable post-create in Fase C; the rest of the state
 * machine is driven by dedicated endpoints.
 */
export class UpdateProductionOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * QUI-1002 — per-order estimated minutes (override of the product
   * preparation time). `null` clears the override. Same range as the
   * product's `preparation_time_minutes` (up to 7 days).
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(10080)
  estimated_minutes?: number | null;
}

/**
 * DTO submitted when the kitchen marks the batch as ready.
 *
 * `produced_qty` is the real yield (in `yield_unit` of the recipe) after
 * applying global `waste_percent` and any per-component losses. The
 * service uses this number to:
 *  1) compute the actual cost of the produced unit (Σ FIFO consumo / produced_qty)
 *  2) credit finished-goods stock via `StockLevelManager.updateStock` with
 *     movement_type='production' and the derived `unit_cost`.
 *
 * If `produced_qty <= 0` the call is rejected.
 */
export class CompleteProductionOrderDto {
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Type(() => Number)
  produced_qty!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Type(() => Number)
  /** Override for the global merma (0-100). Falls back to the recipe's waste_percent. */
  waste_percent_override?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Query DTO for the production-orders list endpoint.
 *
 * Pagination follows the standard admin-list contract
 * (see `ResponseService.paginated()` envelope).
 */
export class ProductionOrderQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 25;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsString()
  status?: 'draft' | 'in_progress' | 'completed' | 'cancelled';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  product_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  recipe_id?: number;

  /** QUI-995: only the production orders of this sale. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  order_id?: number;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  sort_by?: 'created_at' | 'produced_at' | 'planned_qty' | 'produced_qty' | 'status' = 'created_at';

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  sort_order?: 'asc' | 'desc' = 'desc';
}

/**
 * QUI-996 — query of the production list of ONE day. `date` is a calendar date
 * in the store timezone (`YYYY-MM-DD`); omitted = today in the store timezone.
 */
export class ProductionDayQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date debe tener el formato YYYY-MM-DD' })
  date?: string;
}
