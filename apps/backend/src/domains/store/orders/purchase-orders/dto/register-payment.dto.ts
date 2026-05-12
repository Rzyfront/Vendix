import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class RegisterPaymentDto {
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsDateString()
  payment_date: string;

  @IsString()
  @IsNotEmpty()
  payment_method: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
