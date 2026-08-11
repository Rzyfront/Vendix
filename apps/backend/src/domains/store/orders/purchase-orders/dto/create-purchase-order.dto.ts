import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsInt,
  Min,
  IsEnum,
  IsOptional,
  IsDateString,
  IsArray,
  IsBoolean,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  purchase_order_status_enum,
  purchase_order_type_enum,
  tax_type_enum,
} from '@prisma/client';

/** Allowed fiscal tax classifications for a purchase line (F1 IVA lifecycle). */
const TAX_TYPE_VALUES = Object.values(tax_type_enum) as string[];

export class PurchaseOrderItemDto {
  @ApiProperty({ description: 'Product ID' })
  @IsNumber()
  @IsNotEmpty()
  product_id: number;

  @ApiProperty({ description: 'Product variant ID (optional)' })
  @IsNumber()
  @IsOptional()
  product_variant_id?: number;

  @ApiProperty({ description: 'Quantity ordered' })
  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Unit price' })
  @IsNumber()
  @IsNotEmpty()
  unit_price: number;

  /**
   * Fase 2: UoM FKs consumed by the receiving engine to derive the
   * `purchase_to_stock_factor`. Required when the parent PO has
   * `order_type='ingredient'`; optional otherwise (retail = factor 1).
   */
  @ApiProperty({
    description:
      'Fase 2: Purchase UoM FK for ingredient orders. Required when order_type=ingredient.',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  purchase_uom_id?: number;

  @ApiProperty({
    description:
      'Fase 2: Stock UoM FK for ingredient orders. Required when order_type=ingredient.',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  stock_uom_id?: number;

  /**
   * "Contenido por envase" — manual cross-dimension conversion factor. When
   * the purchase unit is a discrete package (dimension `count`, e.g. una
   * bolsita) and the stock unit is a continuous magnitude (`mass`/`volume`,
   * e.g. g/ml), the factor CANNOT be derived from the catalog `factor_to_base`
   * (different dimensions). The operator supplies it manually here: how many
   * stock units each purchase unit contains (e.g. 250 g por bolsita). In that
   * cross-dimension case this value IS the factor and the backend skips the
   * same-dimension validation. Ignored (catalog derivation used instead) for
   * same-dimension conversions.
   */
  @ApiProperty({
    description:
      'Contenido por envase: manual purchase→stock factor for cross-dimension (count → mass/volume) ingredient lines.',
    required: false,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  purchase_to_stock_factor?: number;

  /**
   * Ingredient flags. Apply ONLY to NEW products created from this order line
   * (when the item has no `product_id`). Existing products keep their own
   * flags untouched. Effective only if the store's industries support the
   * `is_ingredient` capacity; otherwise the backend forces them off.
   */
  @ApiProperty({
    description:
      'Mark NEW product as an ingredient (insumo). Applies only to products created from this order line.',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  is_ingredient?: boolean;

  @ApiProperty({
    description:
      'Mark NEW product as sellable. Applies only to products created from this order line. Forced to false for pure ingredients.',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  is_sellable?: boolean;

  /**
   * QUI-661 — commercial discount granted by the supplier on THIS line.
   *
   * The user may type either the percentage or the money amount and the UI
   * derives the other. When both arrive, `discount_amount` wins: it is the
   * figure that gets persisted, that lowers the taxable base, and that the
   * costing engine capitalizes. The percentage travels only as provenance.
   */
  @ApiProperty({ description: 'Line discount percentage (optional)' })
  @IsNumber()
  @IsOptional()
  discount_percentage?: number;


  @ApiProperty({
    description:
      'QUI-661: line discount as a money amount. Wins over discount_percentage.',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  discount_amount?: number;

  @ApiProperty({ description: 'Tax rate (optional)' })
  @IsNumber()
  @IsOptional()
  tax_rate?: number;

  /**
   * F1 IVA lifecycle — fiscal classification of the line tax. Defaults to
   * `iva` when omitted (see PurchaseOrdersService.deriveLineTax). Validated
   * against `tax_type_enum`.
   */
  @ApiProperty({
    description: 'F1: line tax type (iva | inc | ica | ...). Defaults to iva.',
    enum: tax_type_enum,
    required: false,
  })
  @IsIn(TAX_TYPE_VALUES)
  @IsOptional()
  tax_type?: string;

  /**
   * F1 IVA lifecycle — per-line override of the header `prices_include_tax`.
   * When present it INVERTS the header mode for this line only (mixed
   * invoices). When absent the line inherits the header value.
   */
  @ApiProperty({
    description:
      'F1: per-line override of header prices_include_tax (mixed invoices).',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  prices_include_tax?: boolean;

  @ApiProperty({ description: 'Expected delivery date (optional)' })
  @IsDateString()
  @IsOptional()
  expected_delivery_date?: string;

  @ApiProperty({ description: 'Notes for this item (optional)' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Batch number for lot tracking (optional)' })
  @IsString()
  @IsOptional()
  batch_number?: string;

  @ApiProperty({
    description: 'Manufacturing date for lot tracking (optional)',
  })
  @IsDateString()
  @IsOptional()
  manufacturing_date?: string;

  @ApiProperty({ description: 'Expiration date for lot tracking (optional)' })
  @IsDateString()
  @IsOptional()
  expiration_date?: string;

  // New fields for ad-hoc/new products
  @ApiProperty({ description: 'Product Name (for new products)' })
  @IsString()
  @IsOptional()
  product_name?: string;

  @ApiProperty({ description: 'Product SKU/Code (for new products)' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiProperty({ description: 'Product Description (for new products)' })
  @IsString()
  @IsOptional()
  product_description?: string;

  @ApiProperty({ description: 'Product type (for new products)' })
  @IsString()
  @IsOptional()
  product_type?: string;

  @ApiProperty({ description: 'Track inventory flag (for new products)' })
  @IsOptional()
  track_inventory?: any;

  @ApiProperty({ description: 'Pricing type (for new products)' })
  @IsString()
  @IsOptional()
  pricing_type?: string;

  @ApiProperty({ description: 'Tax category IDs (for new products)' })
  @IsArray()
  @IsOptional()
  tax_category_ids?: number[];

  @ApiProperty({ description: 'Product State (for new products)' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiProperty({ description: 'Product Weight (for new products)' })
  @IsNumber()
  @IsOptional()
  weight?: number;

  @ApiProperty({ description: 'Available for Ecommerce (for new products)' })
  @IsOptional()
  available_for_ecommerce?: any;

  @ApiProperty({ description: 'Featured flag (for new products)' })
  @IsOptional()
  is_featured?: any;

  @ApiProperty({ description: 'Allow POS price override (for new products)' })
  @IsOptional()
  allow_pos_price_override?: any;

  @ApiProperty({ description: 'Use price tiers flag (for new products)' })
  @IsOptional()
  has_multiple_price_tiers?: any;

  // ===== Unidad de venta (QUI-648) ================================================
  // Configurar la presentación en la que se venderá el producto, sin salir del
  // flujo de compra: compro bultos de 50 kg y acá defino que se vende por bulto
  // y por kilo. Espeja el patrón del bloque de insumo (purchase_uom_id /
  // stock_uom_id / purchase_to_stock_factor), que ya configura el producto desde
  // la orden de compra.
  //
  // El servicio persiste las TRES filas de forma coordinada o ninguna:
  // `price_tiers` (kind='sale_unit'), `product_price_tier_assignments` (allowlist
  // que consulta la venta) y `product_price_tier_overrides` (factor + precio).

  @ApiProperty({
    description:
      'Nombre libre de la presentación de venta (Bulto 50 kg, Kilo, Rollo, Metro).',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sale_unit_name?: string;

  @ApiProperty({
    description:
      'Unidades de stock que consume una unidad de esa presentación (50 para un bulto de 50 kg). Entero >= 2.',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  sale_unit_units_per_package?: number;

  @ApiProperty({
    description: 'Precio de la presentación completa. Gana sobre el margen.',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sale_unit_price?: number;

  @ApiProperty({
    description:
      'Margen de la presentación (markup sobre el costo del paquete). Se ignora si llega precio explícito.',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sale_unit_profit_margin?: number;

  @ApiProperty({
    description:
      'Marca la presentación como la que rige por defecto en toda superficie de venta.',
    required: false,
  })
  @IsOptional()
  sale_unit_is_default?: any;

  @ApiProperty({ description: 'Base Price (for new products)' })
  @IsNumber()
  @IsOptional()
  base_price?: number;

  @ApiProperty({ description: 'Profit Margin (for new products)' })
  @IsNumber()
  @IsOptional()
  profit_margin?: number;

  @ApiProperty({ description: 'Is on sale (for new products)' })
  @IsOptional()
  is_on_sale?: any;

  @ApiProperty({ description: 'Sale price (for new products)' })
  @IsNumber()
  @IsOptional()
  sale_price?: number;

  @ApiProperty({ description: 'Brand name (for new products)' })
  @IsString()
  @IsOptional()
  brand_name?: string;

  @ApiProperty({
    description: 'Category names comma separated (for new products)',
  })
  @IsString()
  @IsOptional()
  category_names?: string;
}


/**
 * QUI-647 — una cuota del calendario de pago acordado con el proveedor.
 *
 * Vive contra la ORDEN, no contra la CxP: la CxP nace con la recepción, así que
 * al crear la orden todavía no hay a qué colgarla. Se materializa en
 * `ap_payment_schedules` cuando la CxP existe.
 */
export class PurchaseOrderInstallmentDto {
  @ApiProperty({ description: 'Fecha programada de la cuota (YYYY-MM-DD)' })
  @IsDateString()
  scheduled_date: string;

  @ApiProperty({ description: 'Monto de la cuota' })
  @IsNumber()
  amount: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ description: 'Organization ID' })
  @IsNumber()
  @IsOptional()
  organization_id?: number;

  @ApiProperty({ description: 'Supplier ID' })
  @IsNumber()
  @IsNotEmpty()
  supplier_id: number;

  @ApiProperty({ description: 'Location ID where items will be received' })
  @IsNumber()
  @IsNotEmpty()
  location_id: number;

  @ApiProperty({
    description: 'Purchase order status',
    enum: purchase_order_status_enum,
  })
  @IsEnum(purchase_order_status_enum)
  @IsOptional()
  status?: purchase_order_status_enum = purchase_order_status_enum.draft;
  /**
   * Fase 2: primary order type. Defaults to `retail`. Set to `ingredient`
   * for purchase orders that stock insumos via the Modelo B (UoM catalog)
   * and a non-trivial `purchase_to_stock_factor`. Mixed-line orders are
   * out of scope for V1.
   */
  @ApiProperty({
    description:
      'Fase 2: primary order type (retail | ingredient). Defaults to retail for legacy orders.',
    enum: purchase_order_type_enum,
    required: false,
  })
  @IsEnum(purchase_order_type_enum)
  @IsOptional()
  order_type?: purchase_order_type_enum = purchase_order_type_enum.retail;

  /**
   * F1 IVA lifecycle — dominant tax mode for the whole invoice. When true,
   * line `unit_price` is tax-INCLUSIVE (gross); when false the tax is ADDED
   * on top. Individual lines may override via `prices_include_tax` on the item.
   */
  @ApiProperty({
    description:
      'F1: dominant invoice tax mode. true = line prices already include tax.',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  prices_include_tax?: boolean;

  @ApiProperty({ description: 'Order date' })
  @IsDateString()
  @IsOptional()
  order_date?: string;

  @ApiProperty({ description: 'Expected delivery date' })
  @IsDateString()
  @IsOptional()
  expected_date?: string;

  @ApiProperty({ description: 'Payment terms' })
  @IsString()
  @IsOptional()
  payment_terms?: string;

  @ApiProperty({ description: 'Shipping method' })
  @IsString()
  @IsOptional()
  shipping_method?: string;

  @ApiProperty({ description: 'Shipping cost' })
  @IsNumber()
  @IsOptional()
  shipping_cost?: number;

  @ApiProperty({ description: 'Subtotal amount' })
  @IsNumber()
  @IsOptional()
  subtotal_amount?: number;

  @ApiProperty({ description: 'Tax amount' })
  @IsNumber()
  @IsOptional()
  tax_amount?: number;

  @ApiProperty({ description: 'Total amount' })
  @IsNumber()
  @IsOptional()
  total_amount?: number;

  @ApiProperty({ description: 'Discount amount' })
  @IsNumber()
  @IsOptional()
  discount_amount?: number;

  // ===== QUI-647: configuración de pago al crear la orden =====

  /**
   * Modo de pago acordado con el proveedor.
   *
   * - `immediate`: se paga completa en el acto (el `ackPay` binario de antes).
   * - `partial`: se abona `down_payment_amount` y el resto queda como saldo.
   * - `deferred`: no se paga ahora; una sola fecha en `payment_due_date`.
   * - `installments`: no se paga ahora; calendario en `payment_installments`.
   */
  @ApiProperty({
    description: 'QUI-647: immediate | partial | deferred | installments',
    required: false,
  })
  @IsIn(['immediate', 'partial', 'deferred', 'installments'])
  @IsOptional()
  payment_plan?: 'immediate' | 'partial' | 'deferred' | 'installments';

  @ApiProperty({
    description: 'QUI-647: monto abonado en el acto (payment_plan=partial)',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  down_payment_amount?: number;

  @ApiProperty({ description: 'QUI-647: fecha única de pago (deferred)', required: false })
  @IsDateString()
  @IsOptional()
  payment_due_date?: string;

  /**
   * Calendario de cuotas. La suma DEBE igualar el saldo de la orden; el
   * servicio lo valida y rechaza el desbalance en vez de programar un
   * calendario que nunca podría cerrar la deuda.
   */
  @ApiProperty({
    description: 'QUI-647: cuotas planeadas (payment_plan=installments)',
    required: false,
    type: [PurchaseOrderInstallmentDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderInstallmentDto)
  @IsOptional()
  payment_installments?: PurchaseOrderInstallmentDto[];

  @ApiProperty({ description: 'Notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Internal notes (not visible to supplier)' })
  @IsString()
  @IsOptional()
  internal_notes?: string;

  @ApiProperty({ description: 'Created by user ID' })
  @IsNumber()
  @IsOptional()
  created_by_user_id?: number;

  @ApiProperty({ description: 'Approved by user ID' })
  @IsNumber()
  @IsOptional()
  approved_by_user_id?: number;

  @ApiProperty({
    description: 'Purchase order items',
    type: [PurchaseOrderItemDto],
  })
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}
