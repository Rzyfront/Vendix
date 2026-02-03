import { IsOptional, IsString, MaxLength } from 'class-validator';

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
}
