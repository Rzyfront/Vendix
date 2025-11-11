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
import { sales_order_status_enum } from '@prisma/client';

export class SalesOrderItemDto {
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

  @ApiProperty({ description: 'Location ID to fulfill from' })
  @IsNumber()
  @IsOptional()
  location_id?: number;

  @ApiProperty({ description: 'Notes for this item (optional)' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateSalesOrderDto {
  @ApiProperty({ description: 'Organization ID' })
  @IsNumber()
  @IsNotEmpty()
  organization_id: number;

  @ApiProperty({ description: 'Customer ID' })
  @IsNumber()
  @IsNotEmpty()
  customer_id: number;

  @ApiProperty({ description: 'Customer email (for guest orders)' })
  @IsString()
  @IsOptional()
  customer_email?: string;

  @ApiProperty({ description: 'Customer name (for guest orders)' })
  @IsString()
  @IsOptional()
  customer_name?: string;

  @ApiProperty({
    description: 'Sales order status',
    enum: sales_order_status_enum,
  })
  @IsEnum(sales_order_status_enum)
  @IsOptional()
  status?: sales_order_status_enum = sales_order_status_enum.draft;

  @ApiProperty({ description: 'Order date' })
  @IsDateString()
  @IsOptional()
  order_date?: string;

  @ApiProperty({ description: 'Expected delivery date' })
  @IsDateString()
  @IsOptional()
  expected_delivery_date?: string;

  @ApiProperty({ description: 'Shipping address ID' })
  @IsNumber()
  @IsOptional()
  shipping_address_id?: number;

  @ApiProperty({ description: 'Billing address ID' })
  @IsNumber()
  @IsOptional()
  billing_address_id?: number;

  @ApiProperty({ description: 'Payment method' })
  @IsString()
  @IsOptional()
  payment_method?: string;

  @ApiProperty({ description: 'Payment status' })
  @IsString()
  @IsOptional()
  payment_status?: string;

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

  @ApiProperty({ description: 'Customer reference number' })
  @IsString()
  @IsOptional()
  customer_reference?: string;

  @ApiProperty({ description: 'Sales order items', type: [SalesOrderItemDto] })
  @ValidateNested({ each: true })
  @Type(() => SalesOrderItemDto)
  items: SalesOrderItemDto[];
}
