import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsIn,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO to fire a list of order_items to the kitchen.
 *
 * Fase D of the Restaurant Suite — the seam that triggers the inventory
 * consume + COGS auto-entry. Items not flagged as `prepared` are accepted
 * by the service but skipped at the kitchen-fire layer (no recipe to
 * explode). Idempotent: re-firing the same `order_item_id` is a no-op.
 */
export class FireOrderItemsDto {
  @IsInt()
  @Type(() => Number)
  order_id!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Type(() => Number)
  order_item_ids!: number[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Query DTO for the KDS tickets listing endpoint.
 *
 * The KDS subscribes to the kitchen ticket stream and renders
 * `pending | in_preparation` by default; this query is the explicit REST
 * fallback for re-connecting clients.
 */
export class KitchenTicketQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['pending', 'in_preparation', 'ready', 'delivered', 'cancelled'])
  status?:
    | 'pending'
    | 'in_preparation'
    | 'ready'
    | 'delivered'
    | 'cancelled';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  order_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number = 50;
}

/**
 * Query DTO for the KDS snapshot — used both by the explicit REST
 * fallback and as the warm-up payload of the SSE stream.
 *
 *   windowMinutes: how far back to include non-final tickets
 *                  (pending/in_preparation/ready). Default 120min
 *                  covers a typical lunch/dinner service.
 */
export class KdsSnapshotQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(720)
  windowMinutes?: number = 120;
}
