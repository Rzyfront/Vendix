import { IsDateString, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class AvailabilityQueryDto {
  @IsDateString()
  date_from: string;

  @IsDateString()
  date_to: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  product_variant_id?: number;
}
