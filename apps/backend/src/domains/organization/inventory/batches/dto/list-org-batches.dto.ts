import {
  IsOptional,
  IsInt,
  IsString,
  IsDateString,
  IsBooleanString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListOrgBatchesDto {
  /** Optional breakdown filter when operating_scope=ORGANIZATION; required when STORE. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  location_id?: number;

  @IsOptional()
  @IsString()
  batch_number?: string;

  @IsOptional()
  @IsDateString()
  expires_before?: string;

  @IsOptional()
  @IsDateString()
  expires_after?: string;

  @IsOptional()
  @IsBooleanString()
  has_stock?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  limit?: number;
}
