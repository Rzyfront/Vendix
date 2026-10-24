import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

export class StationAvailabilityQueryDto {
  @IsDateString()
  date_from: string;

  @IsDateString()
  date_to: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  service_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_variant_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  provider_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  station_id?: number;
}
