import {
  ArrayMaxSize,
  ArrayMinSize,
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
import { PURCHASE_ORDER_ITEMS_MAX } from './create-purchase-order.dto';

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
   *
   * Cota de tamaño: la misma que la de las líneas. Un arreglo vacío no dice
   * nada que la ausencia del campo no diga ya, y un arreglo sin techo abre una
   * escritura por serial dentro de la transacción de recepción. Una línea con
   * más seriales que el tope se recibe en varias entregas parciales.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PURCHASE_ORDER_ITEMS_MAX)
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
   *
   * CP-PURCHASE-TRANSPARENCY R2 — piso 0 por paridad con los dos hermanos que
   * ya lo tenían: `new_base_price` (arriba, `@Min(0)`) y
   * `sale_unit_profit_margin` en `create-purchase-order.dto.ts`. Sin cota, un
   * margen negativo llega a `resolvePricingAfterReceipt()` y deriva un precio
   * de venta por DEBAJO del costo, o directamente negativo, en el catálogo.
   *
   * JUICIO DECLARADO: esto prohíbe el "loss leader" deliberado por esta vía.
   * Si el negocio lo quiere, es quitar esta línea — pero entonces hay que
   * quitarla también de los dos hermanos, no dejar el contrato a medias.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  new_profit_margin?: number;
}

export class ReceivePurchaseOrderDto {
  // `items: []` pasaba la validación y llegaba al servicio como una recepción
  // que no recibe nada: abría la transacción, no movía stock y devolvía 200.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PURCHASE_ORDER_ITEMS_MAX)
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
