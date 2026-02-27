import {
  IsOptional,
  IsNumber,
  IsString,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { purchase_order_status_enum } from '@prisma/client';

export class PurchaseOrderQueryDto {
  @ApiProperty({ description: 'Organization ID', required: false })
  @IsNumber()
  @IsOptional()
  organization_id?: number;

  @ApiProperty({ description: 'Store ID', required: false })
  @IsNumber()
  @IsOptional()
  store_id?: number;

  @ApiProperty({ description: 'Supplier ID', required: false })
  @IsNumber()
  @IsOptional()
  supplier_id?: number;

  @ApiProperty({ description: 'Location ID', required: false })
  @IsNumber()
  @IsOptional()
  location_id?: number;

  @ApiProperty({
    description: 'Purchase order status',
    enum: purchase_order_status_enum,
    required: false,
  })
  @IsEnum(purchase_order_status_enum)
  @IsOptional()
  status?: purchase_order_status_enum;

  @ApiProperty({ description: 'Start date', required: false })
  @IsDateString()
  @IsOptional()
  start_date?: string;

  @ApiProperty({ description: 'End date', required: false })
  @IsDateString()
  @IsOptional()
  end_date?: string;

  @ApiProperty({ description: 'Search term', required: false })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiProperty({ description: 'Minimum total amount', required: false })
  @IsNumber()
  @IsOptional()
  min_total?: number;

  @ApiProperty({ description: 'Maximum total amount', required: false })
  @IsNumber()
  @IsOptional()
  max_total?: number;

  @ApiProperty({ description: 'Page number', required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @ApiProperty({ description: 'Items per page', required: false, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 10;

  @ApiProperty({ description: 'Sort field', required: false, default: 'order_date' })
  @IsOptional()
  @IsString()
  sort_by?: string = 'order_date';

  @ApiProperty({ description: 'Sort direction', required: false, default: 'desc' })
  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';
}
