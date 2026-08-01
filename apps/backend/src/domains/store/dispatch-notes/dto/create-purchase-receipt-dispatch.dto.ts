import {
  IsInt,
  IsString,
  IsOptional,
  IsArray,
  ArrayNotEmpty,
  ValidateNested,
  IsDateString,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateDispatchNoteItemDto } from './create-dispatch-note.dto';

/**
 * DTO for creating a purchase receipt dispatch note (inbound).
 * supplier_id is REQUIRED.
 * purchase_order_id is optional — when present, the service delegates to PurchaseOrdersService.receive.
 */
export class CreatePurchaseReceiptDispatchDto {
  @IsEnum(['inbound'])
  direction: 'inbound';

  @IsEnum(['purchase_receipt'])
  subtype: 'purchase_receipt';

  @IsEnum(['normal_purchase', 'replacement_for_damage', 'sample_received'])
  reason: 'normal_purchase' | 'replacement_for_damage' | 'sample_received';

  @IsInt()
  @Min(1)
  supplier_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  purchase_order_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  related_dispatch_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  to_location_id?: number;

  @IsOptional()
  @IsDateString()
  emission_date?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  /**
   * At least one line is mandatory. An empty array used to create a remisión
   * with zero lines that later reached
   * `delegatePurchaseReceiptToPurchaseOrder`, resolved zero PO lines and
   * returned silently: the caller got HTTP success while the purchase order was
   * never actually received.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateDispatchNoteItemDto)
  items: CreateDispatchNoteItemDto[];
}