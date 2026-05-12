import {
  IsOptional,
  IsNumber,
  IsString,
  IsEnum,
  IsDateString,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { movement_type_enum } from '@prisma/client';

export class OrgMovementQueryDto {
  /** Optional breakdown filter when operating_scope=ORGANIZATION; required when STORE. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  product_variant_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  from_location_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  to_location_id?: number;

  @IsOptional()
  @IsEnum(movement_type_enum)
  movement_type?: movement_type_enum;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  user_id?: number;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  limit?: number;
}
