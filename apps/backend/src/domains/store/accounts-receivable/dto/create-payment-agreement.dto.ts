import {
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaymentAgreementDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  num_installments: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  interest_rate?: number = 0;

  @IsDateString()
  start_date: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
