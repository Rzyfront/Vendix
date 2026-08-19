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

  // store_id deprecated (phase3-round2): scope is derived from RequestContextService
  // for /store/* endpoints.

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

  // CP-ID-VNDX-2026-08-18-PO-PROD — ADR-001 / F1.S5: sort_by cerrado (enum).
  // Antes el cliente podía inyectar un nombre de columna Prisma y reventar la
  // query como 500 silencioso. Ahora solo se aceptan 5 valores declarados.
  @ApiProperty({
    description: 'Sort field',
    enum: [
      'order_date',
      'next_payment_date',
      'supplier_name',
      'total',
      'status',
    ],
    required: false,
    default: 'next_payment_date',
  })
  @IsOptional()
  @IsEnum([
    'order_date',
    'next_payment_date',
    'supplier_name',
    'total',
    'status',
  ])
  sort_by?:
    | 'order_date'
    | 'next_payment_date'
    | 'supplier_name'
    | 'total'
    | 'status' = 'next_payment_date';

  @ApiProperty({
    description: 'Sort direction',
    required: false,
    default: 'desc',
  })
  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';
}
