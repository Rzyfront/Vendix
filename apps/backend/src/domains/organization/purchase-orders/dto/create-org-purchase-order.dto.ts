import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { purchase_order_status_enum } from '@prisma/client';

/**
 * Item DTO for org-native purchase order creation.
 *
 * Plan §6.4.1 — Single destination at header level. Per-item
 * `destination_location_id` is INTENTIONALLY OMITTED and unsupported. All items
 * inherit the header-level `destination_location_id`.
 */
export class CreateOrgPurchaseOrderItemDto {
  @ApiProperty({
    description:
      'Product ID. Use 0 (or omit) when sending a prebulk temporary product — backend will autocreate it on submit using product_name + sku.',
  })
  @IsInt()
  @IsOptional()
  product_id?: number;

  @ApiProperty({ description: 'Product variant ID (optional)' })
  @IsInt()
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
  @IsNumber()
  @IsOptional()
  base_price?: number;

  @ApiProperty({ description: 'Quantity ordered (>0)' })
  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @ApiProperty({ description: 'Unit price/cost' })
  @IsNumber()
  @Min(0)
  unit_price!: number;

  @ApiProperty({ description: 'Discount percentage (optional)' })
  @IsNumber()
  @IsOptional()
  discount_percentage?: number;

  @ApiProperty({ description: 'Tax rate (optional)' })
  @IsNumber()
  @IsOptional()
  tax_rate?: number;

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
  @IsNotEmpty()
  supplier_id!: number;

  @ApiProperty({
    description:
      'Destination inventory location (header-level). Single source of truth for all items. May target a central org warehouse when operating_scope=ORGANIZATION.',
  })
  @IsInt()
  @IsNotEmpty()
  destination_location_id!: number;

  @ApiProperty({
    description: 'Purchase order status',
    enum: purchase_order_status_enum,
  })
  @IsEnum(purchase_order_status_enum)
  @IsOptional()
  status?: purchase_order_status_enum;

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

  @ApiProperty({ description: 'Tax amount' })
  @IsNumber()
  @IsOptional()
  tax_amount?: number;

  @ApiProperty({ description: 'Discount amount' })
  @IsNumber()
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

  @ApiProperty({
    description: 'Purchase order items (NO per-item destination supported)',
    type: [CreateOrgPurchaseOrderItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrgPurchaseOrderItemDto)
  items!: CreateOrgPurchaseOrderItemDto[];
}
