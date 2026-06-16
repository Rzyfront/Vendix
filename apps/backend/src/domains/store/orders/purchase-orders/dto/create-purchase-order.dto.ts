import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsDateString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { purchase_order_status_enum, purchase_order_type_enum } from '@prisma/client';

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

  @ApiProperty({ description: 'Discount percentage (optional)' })
  @IsNumber()
  @IsOptional()
  discount_percentage?: number;

  @ApiProperty({ description: 'Tax rate (optional)' })
  @IsNumber()
  @IsOptional()
  tax_rate?: number;

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
