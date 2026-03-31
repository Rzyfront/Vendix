import { IsNumber, IsOptional, IsString, IsEnum, Min } from 'class-validator';

export enum AdjustmentType {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

export class AdjustWalletDto {
  @IsEnum(AdjustmentType)
  type: AdjustmentType;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  reference?: string;
}
