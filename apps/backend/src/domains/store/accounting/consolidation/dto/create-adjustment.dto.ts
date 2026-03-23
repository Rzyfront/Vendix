import { IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAdjustmentDto {
  @IsNumber()
  @Type(() => Number)
  account_id: number;

  @IsEnum(['elimination', 'reclassification', 'adjustment'])
  type: string;

  @IsNumber()
  @Type(() => Number)
  debit_amount: number;

  @IsNumber()
  @Type(() => Number)
  credit_amount: number;

  @IsString()
  @MaxLength(500)
  description: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  store_id?: number;
}
