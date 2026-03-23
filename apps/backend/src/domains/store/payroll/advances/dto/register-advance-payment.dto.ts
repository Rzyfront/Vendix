import {
  IsNumber,
  IsString,
  IsOptional,
  Min,
  MaxLength,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RegisterAdvancePaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @IsDateString()
  payment_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
