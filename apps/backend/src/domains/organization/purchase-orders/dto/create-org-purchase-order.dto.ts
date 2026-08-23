import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { purchase_order_status_enum, tax_type_enum } from '@prisma/client';

import {
  IsValidFreightAndTax,
  PURCHASE_ORDER_ITEMS_MAX,
  SHIPPING_COST_ALLOCATIONS,
  ShippingCostAllocation,
  toOptionalBoolean,
  toOptionalNumber,
} from '../../../store/orders/purchase-orders/dto/create-purchase-order.dto';

/** Allowed fiscal tax classifications for a purchase line (F1 IVA lifecycle). */
const TAX_TYPE_VALUES = Object.values(tax_type_enum) as string[];

/**
 * Item DTO for org-native purchase order creation.
 *
 * Plan §6.4.1 — Single destination at header level. Per-item
 * `destination_location_id` is INTENTIONALLY OMITTED and unsupported. All items
 * inherit the header-level `destination_location_id`.
 *
 * CP-PURCHASE-TRANSPARENCY C.7 — este DTO es la SEGUNDA puerta a la misma
 * escritura. `OrgPurchaseOrdersService.create()` arma el DTO de tienda campo por
 * campo y llama al servicio directamente, así que el `ValidationPipe` de la
 * ruta de tienda NUNCA corre sobre este cuerpo: las cotas que faltaran acá no
 * las cubre nadie más. Cada validador de este archivo replica a propósito el de
 * `PurchaseOrderItemDto` / `CreatePurchaseOrderDto`; divergir es reabrir el
 * agujero.
 */
export class CreateOrgPurchaseOrderItemDto {
  @ApiProperty({
    description:
      'Product ID. Use 0 (or omit) when sending a prebulk temporary product — backend will autocreate it on submit using product_name + sku.',
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  product_id?: number;

  @ApiProperty({ description: 'Product variant ID (optional)' })
  @IsInt()
  @Min(1)
  @IsOptional()
  product_variant_id?: number;

  // ────────────────────────────────────────────────────────────────
  // Prebulk fields (temporary product not in catalog).
  // When product_id is 0/missing AND product_name is present, the
  // store-domain service auto-creates the catalog row before linking.
  // Mirrors the subset emitted by `pop-prebulk-modal.component.ts`.
  // ────────────────────────────────────────────────────────────────

  @ApiProperty({ description: 'Product Name (for new prebulk products)' })
  @IsString()
  @IsOptional()
  product_name?: string;

  @ApiProperty({ description: 'Product SKU/Code (for new prebulk products)' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiProperty({
    description: 'Product Description (for new prebulk products)',
  })
  @IsString()
  @IsOptional()
  product_description?: string;

  @ApiProperty({
    description: 'Base sale price reference (for new prebulk products)',
  })
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @IsOptional()
  base_price?: number;

  /**
   * C.7 — ENTERO, igual que `PurchaseOrderItemDto.quantity`.
   * `purchase_order_items.quantity_ordered` es `Int` en Prisma: una cantidad
   * fraccionaria por esta puerta no llegaba a un 400 legible, llegaba hasta el
   * cliente de Prisma. La vista previa (`CostPreviewItemDto`) sí admite
   * fracción porque simula, no persiste.
   */
  @ApiProperty({ description: 'Quantity ordered (integer >= 1)' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: 'Unit price/cost' })
  @IsNumber()
  @Min(0)
  unit_price!: number;

  /**
   * QUI-661 — descuento comercial de la línea como PORCENTAJE. Acotado a
   * [0,100]: sin `@Max(100)` un 150 % producía una base gravable negativa que
   * el costeo capitalizaba tal cual.
   */
  @ApiProperty({ description: 'Discount percentage (optional, 0-100)' })
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  discount_percentage?: number;

  /**
   * QUI-661 — descuento de línea como MONTO. Gana sobre el porcentaje.
   *
   * C.7 — faltaba en este DTO y también en el mapeo del servicio, así que una
   * OC creada desde la organización perdía el descuento por línea en silencio:
   * el operador lo escribía, el 201 lo confirmaba y la orden nacía sin él.
   */
  @ApiProperty({
    description: 'Line discount as a money amount. Wins over the percentage.',
    required: false,
  })
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @IsOptional()
  discount_amount?: number;

  @ApiProperty({ description: 'Tax rate (optional, 0-100)' })
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  tax_rate?: number;

  /** F1 IVA lifecycle — line tax type (iva | inc | ...). Defaults to iva. */
  @ApiProperty({
    description: 'F1: line tax type (iva | inc | ica | ...). Defaults to iva.',
    enum: tax_type_enum,
    required: false,
  })
  @IsIn(TAX_TYPE_VALUES)
  @IsOptional()
  tax_type?: string;

  /** F1 IVA lifecycle — per-line override of header prices_include_tax. */
  @ApiProperty({
    description:
      'F1: per-line override of header prices_include_tax (mixed invoices).',
    required: false,
  })
  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  prices_include_tax?: boolean;

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
}

/**
 * Org-native purchase order create DTO.
 *
 * Plan §6.4.1 — `destination_location_id` is the SINGLE source of truth for
 * "where the items go on receipt". It maps to `purchase_orders.location_id`
 * in the DB. Items do NOT carry their own destination — that legacy concept
 * is rejected at the validation layer (extra properties stripped via
 * `whitelist: true` in the global ValidationPipe).
 *
 * Tenant safety: `organization_id` is resolved from `RequestContextService` in
 * the service layer; the DTO does not accept it from the wire.
 */
export class CreateOrgPurchaseOrderDto {
  @ApiProperty({ description: 'Supplier ID (must belong to current org)' })
  @IsInt()
  @Min(1)
  @IsNotEmpty()
  supplier_id!: number;

  /**
   * C.7 — el validador cross-field del flete se cuelga acá y no de
   * `shipping_cost` porque `@IsOptional()` apaga TODOS los validadores de su
   * propiedad cuando el valor es `undefined`, que es justo el caso a atrapar
   * (`allocation='prorate'` sin monto). Colgado de un campo obligatorio, corre
   * siempre.
   */
  @ApiProperty({
    description:
      'Destination inventory location (header-level). Single source of truth for all items. May target a central org warehouse when operating_scope=ORGANIZATION.',
  })
  @IsInt()
  @Min(1)
  @IsNotEmpty()
  @IsValidFreightAndTax()
  destination_location_id!: number;

  /**
   * A.10 — DECLARADO PERO IGNORADO, igual que en el DTO de tienda. El servicio
   * org ya no lo reenvía y `PurchaseOrdersService.create()` fija `draft` de
   * oficio: la aprobación es un acto con permiso propio (`approve()`), no una
   * clave del cuerpo. Antes viajaba por el mapeo manual y una OC podía nacer
   * `approved` sin pasar por ese permiso.
   */
  @ApiProperty({
    description:
      'IGNORADO por el servidor: la orden nace siempre en `draft`. Se conserva por compatibilidad de contrato.',
    enum: purchase_order_status_enum,
    deprecated: true,
  })
  @IsEnum(purchase_order_status_enum)
  @IsOptional()
  status?: purchase_order_status_enum;

  /**
   * F1 IVA lifecycle — dominant invoice tax mode. Crosses the mapping into
   * the store-native DTO so org-created POs capture VAT identically.
   */
  @ApiProperty({
    description:
      'F1: dominant invoice tax mode. true = line prices already include tax.',
    required: false,
  })
  @Transform(toOptionalBoolean)
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

  /**
   * Flete de la factura. Dos decimales OBLIGATORIOS: la columna es
   * `Decimal(12,2)` y PostgreSQL y JavaScript no redondean igual el tercero.
   */
  @ApiProperty({ description: 'Shipping cost' })
  @Transform(toOptionalNumber)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  shipping_cost?: number;

  /**
   * C.2/C.7 — cómo se imputa el flete: `prorate` lo reparte entre las líneas y
   * lo capitaliza al costo; `expense` lo deja fuera del inventario. Obligatorio
   * cuando `shipping_cost > 0`. Faltaba en este DTO: la org podía mandar flete
   * y el modo se perdía en el mapeo, así que el costo por línea quedaba a
   * merced del valor por defecto del servicio.
   */
  @ApiProperty({
    description: 'Shipping cost allocation mode (prorate | expense)',
    enum: SHIPPING_COST_ALLOCATIONS,
    required: false,
  })
  @IsIn(SHIPPING_COST_ALLOCATIONS as unknown as string[])
  @IsOptional()
  shipping_cost_allocation?: ShippingCostAllocation;

  @ApiProperty({ description: 'Tax amount' })
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @IsOptional()
  tax_amount?: number;

  @ApiProperty({ description: 'Discount amount' })
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @IsOptional()
  discount_amount?: number;

  @ApiProperty({ description: 'Notes (visible to supplier)' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Internal notes (not visible to supplier)' })
  @IsString()
  @IsOptional()
  internal_notes?: string;

  /**
   * C.7 — el arreglo estaba SIN cotas. Una OC de 5.000 líneas abre 5.000
   * escrituras dentro de una sola transacción y deja el pool de Prisma en el
   * suelo; una de 0 líneas creaba una orden vacía con total 0 que después nadie
   * podía recibir. Mismo tope que la puerta de tienda.
   */
  @ApiProperty({
    description: 'Purchase order items (NO per-item destination supported)',
    type: [CreateOrgPurchaseOrderItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PURCHASE_ORDER_ITEMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => CreateOrgPurchaseOrderItemDto)
  items!: CreateOrgPurchaseOrderItemDto[];
}
