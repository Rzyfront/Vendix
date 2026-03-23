import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RegisterInstallmentPaymentDto {
  @IsInt()
  installment_id: number;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsInt()
  store_payment_method_id?: number;

  @IsOptional()
  @IsString()
  payment_reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
