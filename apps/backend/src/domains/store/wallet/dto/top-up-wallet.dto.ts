import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class TopUpWalletDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  payment_method?: string; // cash, bank_transfer, wompi

  @IsOptional()
  @IsString()
  reference?: string;
}
