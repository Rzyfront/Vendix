import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReceiveItemDto {
  @IsInt()
  id: number; // purchase_order_item id

  @IsInt()
  @Min(0)
  quantity_received: number;

  /**
   * QUI-431 — serial numbers captured for this received line. Only meaningful
   * for products with `requires_serial_numbers = true`. Free text is accepted;
   * each entry becomes a real `in_stock` pool row. When fewer serials than
   * `quantity_received` are provided, the gap is auto-filled with unique
   * placeholders to keep strict parity with stock-on-hand.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serial_numbers?: string[];
}

export class ReceivePurchaseOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items: ReceiveItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
