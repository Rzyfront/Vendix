import {
  IsInt,
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsDateString,
  IsEnum,
  ValidateIf,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateDispatchNoteItemDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_variant_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  location_id?: number;

  @IsInt()
  @Min(0)
  ordered_quantity: number;

  @IsInt()
  @Min(1)
  dispatched_quantity: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  unit_price?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  discount_amount?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  tax_amount?: number;

  @IsOptional()
  @IsString()
  lot_serial?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sales_order_item_id?: number;

  /**
   * Order-first purchase-receipt line reference. When a purchase_receipt
   * remisión is created from a purchase order, this optionally pins the exact
   * `purchase_order_items.id` this line receives against. When omitted, the
   * receive delegation re-derives it by matching product_id (+ variant) against
   * the purchase order's lines. Declared here so `forbidNonWhitelisted` accepts
   * it on the purchase-receipt payload.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  purchase_order_item_id?: number;

  /**
   * QUI-425 — optional per-line pricing override captured in the "Crear y
   * recibir" margin/price editor. When a purchase_receipt remisión is delegated
   * to its purchase order at reception time, these are forwarded to
   * `PurchaseOrdersService.receive()` (mirroring `ReceiveItemDto.new_base_price`)
   * so the operator's price/margin edit is re-applied to the product's sale
   * price. Persisted on the dispatch_note_item so the `received` listener (which
   * reads the line back from the DB) can carry them. Declared here so
   * `forbidNonWhitelisted` accepts them on the purchase-receipt payload.
   */
  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  new_base_price?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  new_profit_margin?: number;
}

export class CreateDispatchNoteDto {
  @IsOptional()
  @IsEnum(['outbound', 'inbound'])
  direction?: 'outbound' | 'inbound';

  @IsOptional()
  @IsEnum([
    'customer_delivery',
    'customer_return',
    'transfer_out',
    'transfer_in',
    'purchase_receipt',
  ])
  subtype?:
    | 'customer_delivery'
    | 'customer_return'
    | 'transfer_out'
    | 'transfer_in'
    | 'purchase_receipt';

  @IsOptional()
  @IsEnum([
    'sale',
    'sample',
    'consignment',
    'replacement_shipment',
    'loan',
    'defective',
    'wrong_item',
    'cancellation',
    'warranty',
    'overdelivery_return',
    'replenishment',
    'rebalancing',
    'returned_from_consignee',
    'normal_purchase',
    'replacement_for_damage',
    'sample_received',
  ])
  reason?:
    | 'sale'
    | 'sample'
    | 'consignment'
    | 'replacement_shipment'
    | 'loan'
    | 'defective'
    | 'wrong_item'
    | 'cancellation'
    | 'warranty'
    | 'overdelivery_return'
    | 'replenishment'
    | 'rebalancing'
    | 'returned_from_consignee'
    | 'normal_purchase'
    | 'replacement_for_damage'
    | 'sample_received';

  @IsInt()
  @Min(1)
  customer_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  sales_order_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dispatch_location_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  supplier_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  related_dispatch_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  from_location_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  to_location_id?: number;

  @IsOptional()
  @IsDateString()
  emission_date?: string;

  @IsOptional()
  @IsDateString()
  agreed_delivery_date?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDispatchNoteItemDto)
  items: CreateDispatchNoteItemDto[];
}
