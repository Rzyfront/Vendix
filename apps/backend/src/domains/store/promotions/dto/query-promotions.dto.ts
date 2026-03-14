import { IsOptional, IsString, IsInt, IsEnum, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryPromotionsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsEnum(['draft', 'scheduled', 'active', 'paused', 'expired', 'cancelled'])
  state?: string;

  @IsOptional()
  @IsEnum(['percentage', 'fixed_amount'])
  type?: string;

  @IsOptional()
  @IsEnum(['order', 'product', 'category'])
  scope?: string;
}
