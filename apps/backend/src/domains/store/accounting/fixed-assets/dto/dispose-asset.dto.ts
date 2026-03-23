import { IsDateString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class DisposeAssetDto {
  @IsDateString()
  disposal_date: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  disposal_amount?: number;
}
