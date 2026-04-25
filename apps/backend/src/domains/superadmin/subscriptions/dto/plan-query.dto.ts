import { IsOptional, IsString, IsInt, IsEnum, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PlanQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(['base', 'partner_custom', 'promotional'])
  plan_type?: string;

  @IsOptional()
  @IsEnum(['draft', 'active', 'archived'])
  state?: string;

  @IsOptional()
  @IsEnum(['monthly', 'quarterly', 'semiannual', 'annual', 'lifetime'])
  billing_cycle?: string;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';
}
