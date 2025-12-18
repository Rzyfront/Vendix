import {
  IsOptional,
  IsNumber,
  IsString,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class SupplierQueryDto {
  @ApiProperty({ description: 'Page number', required: false })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ description: 'Items per page', required: false })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiProperty({ description: 'Organization ID', required: false })
  @IsNumber()
  @IsOptional()
  organization_id?: number;

  @ApiProperty({ description: 'Store ID', required: false })
  @IsNumber()
  @IsOptional()
  store_id?: number;

  @ApiProperty({ description: 'Search term', required: false })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiProperty({ description: 'Is supplier active', required: false })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({ description: 'Email filter', required: false })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiProperty({ description: 'Phone filter', required: false })
  @IsString()
  @IsOptional()
  phone?: string;
}
