import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum DepreciationMethodEnum {
  STRAIGHT_LINE = 'straight_line',
  DECLINING_BALANCE = 'declining_balance',
}

export class CreateFixedAssetDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  category_id?: number;

  @IsDateString()
  acquisition_date: string;

  @IsNumber()
  @Type(() => Number)
  acquisition_cost: number;

  @IsNumber()
  @Type(() => Number)
  salvage_value: number;

  @IsNumber()
  @Type(() => Number)
  useful_life_months: number;

  @IsEnum(DepreciationMethodEnum)
  depreciation_method: DepreciationMethodEnum;

  @IsOptional()
  @IsDateString()
  depreciation_start_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  store_id?: number;
}
