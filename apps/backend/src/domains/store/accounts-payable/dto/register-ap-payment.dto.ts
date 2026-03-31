import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RegisterApPaymentDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  payment_method: string; // cash, bank_transfer, check

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  bank_export_ref?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
