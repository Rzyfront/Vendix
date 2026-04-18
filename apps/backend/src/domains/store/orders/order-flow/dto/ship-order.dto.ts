import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ShipOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tracking_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  carrier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_method_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_rate_id?: number;
}
