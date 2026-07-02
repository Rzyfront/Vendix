import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * DTO to partially update a gym plan. All fields are optional.
 *
 * `code` is updatable but still unique per store — the service re-checks the
 * uniqueness constraint when the code changes.
 */
export class UpdateGymPlanDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  duration_days?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  access_limit_per_period?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  class_limit_per_period?: number;

  @IsOptional()
  @IsObject()
  features?: Record<string, any>;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  sort_order?: number;
}
