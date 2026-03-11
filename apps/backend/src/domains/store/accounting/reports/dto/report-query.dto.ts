import { IsNumber, IsOptional, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class ReportQueryDto {
  @IsNumber()
  @Type(() => Number)
  fiscal_period_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  store_id?: number;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  account_id?: number;
}
