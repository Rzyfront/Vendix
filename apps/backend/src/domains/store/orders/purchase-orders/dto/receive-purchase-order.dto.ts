import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
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

  /**
   * QUI-425 (D2) — optional override for the product / variant base price
   * (or variant price_override) applied at receipt time. When omitted, the
   * existing base_price is preserved and profit_margin is recomputed from
   * the new cost_price (default "cost anchor" behaviour).
   *
   * Only one of `new_base_price` / `new_profit_margin` is needed in most
   * cases — the service derives the other from the new cost_price. Passing
   * both is allowed; new_base_price wins for the persisted value and the
   * margin is then computed against that base.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  new_base_price?: number;

  /**
   * QUI-425 (D2) — optional override for the profit margin (%) applied at
   * receipt time. When omitted alongside new_base_price, the existing
   * base_price is preserved and the margin is recomputed from the new
   * cost_price.
   */
  @IsOptional()
  @IsNumber()
  new_profit_margin?: number;
}

export class ReceivePurchaseOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items: ReceiveItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * F2 IVA lifecycle — supplier's own invoice number for this purchase. When
   * provided it becomes the `invoice_number` of the fiscal document that
   * recognizes the deductible VAT (240804); otherwise the recognition falls
   * back to the purchase order's `order_number`.
   */
  @IsOptional()
  @IsString()
  supplier_invoice_number?: string;

  /**
   * F2 IVA lifecycle — supplier invoice date (YYYY-MM-DD). Drives the fiscal
   * document's `issue_date` so the deductible VAT lands in the correct
   * declaration period. Defaults to the reception date when omitted.
   */
  @IsOptional()
  @IsDateString()
  supplier_invoice_date?: string;
}
