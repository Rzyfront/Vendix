import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { purchase_order_status_enum } from '@prisma/client';

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
}

export class CreatePurchaseOrderDto {
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

  @ApiProperty({ description: 'Expected delivery date' })
  @IsDateString()
  @IsOptional()
  expected_delivery_date?: string;

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

  @ApiProperty({ description: 'Notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Internal reference number' })
  @IsString()
  @IsOptional()
  internal_reference?: string;

  @ApiProperty({ description: 'Supplier reference number' })
  @IsString()
  @IsOptional()
  supplier_reference?: string;

  @ApiProperty({
    description: 'Purchase order items',
    type: [PurchaseOrderItemDto],
  })
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}
