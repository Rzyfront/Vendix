import { IsInt, IsNumber, IsEnum, IsDateString, IsOptional, IsString, Min, Max } from 'class-validator';

export class CreateCreditDto {
  @IsInt()
  order_id: number;

  @IsInt()
  customer_id: number;

  @IsInt()
  @Min(1)
  @Max(60)
  num_installments: number;

  @IsEnum(['weekly', 'biweekly', 'monthly'])
  frequency: string;

  @IsDateString()
  first_installment_date: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  interest_rate?: number;

  @IsOptional()
  @IsInt()
  default_payment_method_id?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  initial_payment?: number;

  @IsOptional()
  @IsInt()
  initial_payment_method_id?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
