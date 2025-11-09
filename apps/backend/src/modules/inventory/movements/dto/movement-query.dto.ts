import {
  IsOptional,
  IsNumber,
  IsString,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { movement_type_enum } from '@prisma/client';

export class MovementQueryDto {
  @ApiProperty({ description: 'Organization ID', required: false })
  @IsNumber()
  @IsOptional()
  organization_id?: number;

  @ApiProperty({ description: 'Store ID', required: false })
  @IsNumber()
  @IsOptional()
  store_id?: number;

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
}
