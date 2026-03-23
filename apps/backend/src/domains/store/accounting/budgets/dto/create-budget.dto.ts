import {
  IsString,
  IsInt,
  IsOptional,
  IsNumber,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBudgetDto {
  @IsInt()
  @Type(() => Number)
  fiscal_period_id: number;

  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  variance_threshold?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;
}
