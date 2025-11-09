import {
  IsOptional,
  IsNumber,
  IsString,
  IsEnum,
  IsDateString,
} from 'class-validator';
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
}
