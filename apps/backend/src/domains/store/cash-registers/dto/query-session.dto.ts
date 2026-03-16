import { IsOptional, IsString, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class QuerySessionDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 10;

  @IsOptional()
  @IsString()
  status?: 'open' | 'closed' | 'suspended';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  cash_register_id?: number;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';
}
