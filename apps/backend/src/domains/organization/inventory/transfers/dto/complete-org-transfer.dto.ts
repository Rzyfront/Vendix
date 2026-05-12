import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CompleteOrgTransferItemDto {
  @IsInt()
  stock_transfer_item_id!: number;

  @IsNumber()
  @Min(0)
  quantity_received!: number;
}

/**
 * Payload for the org-level complete (a.k.a. "received") endpoint.
 *
 * The destination location is incremented by `quantity_received` per item.
 * If every item.quantity_received equals item.quantity the transfer is
 * marked `completed` (logical: received); otherwise it remains
 * `in_transit` until the remaining items are received.
 */
export class CompleteOrgTransferDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompleteOrgTransferItemDto)
  items!: CompleteOrgTransferItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
