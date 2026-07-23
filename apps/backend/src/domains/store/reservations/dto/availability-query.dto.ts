import { IsDateString, IsInt, IsOptional, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class AvailabilityQueryDto {
  @IsDateString()
  date_from: string;

  @IsDateString()
  date_to: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provider_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  product_variant_id?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  include_booked?: boolean;
}
