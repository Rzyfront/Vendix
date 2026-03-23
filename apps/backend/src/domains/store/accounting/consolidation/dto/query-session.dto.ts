import { IsEnum, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class QuerySessionDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  fiscal_period_id?: number;

  @IsOptional()
  @IsEnum(['draft', 'in_progress', 'completed', 'cancelled'])
  status?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;
}
