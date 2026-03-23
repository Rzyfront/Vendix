import { IsOptional, IsString, IsNumber, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryBankTransactionDto {
  @IsNumber()
  @Type(() => Number)
  bank_account_id: number;

  @IsOptional()
  @IsString()
  date_from?: string;

  @IsOptional()
  @IsString()
  date_to?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  is_reconciled?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 50;
}
