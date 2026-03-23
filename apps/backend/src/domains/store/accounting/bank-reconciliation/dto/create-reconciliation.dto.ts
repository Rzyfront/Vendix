import { IsNumber, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateReconciliationDto {
  @IsNumber()
  @Type(() => Number)
  bank_account_id: number;

  @IsString()
  period_start: string;

  @IsString()
  period_end: string;

  @IsNumber()
  @Type(() => Number)
  statement_balance: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  opening_balance?: number;
}
