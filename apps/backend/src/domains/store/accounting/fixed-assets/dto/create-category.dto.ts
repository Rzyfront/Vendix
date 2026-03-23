import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DepreciationMethodEnum } from './create-fixed-asset.dto';

export class CreateFixedAssetCategoryDto {
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  default_useful_life_months?: number;

  @IsOptional()
  @IsEnum(DepreciationMethodEnum)
  default_depreciation_method?: DepreciationMethodEnum;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  default_salvage_percentage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  depreciation_account_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  expense_account_code?: string;
}
