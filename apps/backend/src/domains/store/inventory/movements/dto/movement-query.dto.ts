import {
  IsOptional,
  IsNumber,
  IsString,
  IsEnum,
  IsDateString,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { movement_type_enum } from '@prisma/client';

export class MovementQueryDto {
  @ApiProperty({ description: 'Organization ID', required: false })
  @IsNumber()
  @IsOptional()
  organization_id?: number;

  // store_id deprecated (phase3-round2): scope is derived from RequestContextService
  // for /store/* endpoints.

  @ApiProperty({ description: 'Product ID', required: false })
  @IsNumber()
  @IsOptional()
  product_id?: number;

  @ApiProperty({ description: 'Product variant ID', required: false })
  @IsNumber()
  @IsOptional()
  product_variant_id?: number;

  @ApiProperty({ description: 'From location ID', required: false })
  @IsNumber()
  @IsOptional()
  from_location_id?: number;

  @ApiProperty({ description: 'To location ID', required: false })
  @IsNumber()
  @IsOptional()
  to_location_id?: number;

  @ApiProperty({
    description: 'Movement type',
    enum: movement_type_enum,
    required: false,
  })
  @IsEnum(movement_type_enum)
  @IsOptional()
  movement_type?: movement_type_enum;

  @ApiProperty({ description: 'User ID', required: false })
  @IsNumber()
  @IsOptional()
  user_id?: number;

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

  @ApiProperty({ description: 'Page number', required: false, default: 1 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  page?: number = 1;

  @ApiProperty({ description: 'Records per page', required: false, default: 25 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  limit?: number = 25;

  @ApiProperty({
    description: 'Sort by field',
    required: false,
    default: 'created_at',
  })
  @IsString()
  @IsOptional()
  sort_by?: string = 'created_at';

  @ApiProperty({
    description: 'Sort order',
    required: false,
    default: 'desc',
    enum: ['asc', 'desc'],
  })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  sort_order?: 'asc' | 'desc' = 'desc';
}
