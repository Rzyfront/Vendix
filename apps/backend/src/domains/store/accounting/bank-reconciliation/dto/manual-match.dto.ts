import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class ManualMatchDto {
  @IsNumber()
  @Type(() => Number)
  bank_transaction_id: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  accounting_entry_id?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
