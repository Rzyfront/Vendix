import { IsOptional, IsString, IsInt, Min, IsIn } from 'class-validator';
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
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsIn(['draft', 'scheduled', 'active', 'paused', 'expired', 'cancelled'])
  state?: string;

  @IsOptional()
  @IsIn(['percentage', 'fixed_amount'])
  type?: string;

  @IsOptional()
  @IsIn(['order', 'product', 'category'])
  scope?: string;
}
