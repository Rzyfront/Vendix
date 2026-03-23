import {
  IsNumber,
  IsString,
  IsOptional,
  Min,
  IsInt,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ApproveAdvanceDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount_approved?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  installments?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
