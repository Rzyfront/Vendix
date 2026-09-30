import { IsOptional, IsNumber, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { AnalyticsQueryDto } from './analytics-query.dto';

export class PurchaseTrendsQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  supplier_id?: number;

  @IsOptional()
  @IsString()
  search?: string;
}
