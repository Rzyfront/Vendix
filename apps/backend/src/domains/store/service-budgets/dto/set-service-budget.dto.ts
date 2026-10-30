import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SetServiceBudgetDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @IsString()
  @MaxLength(10)
  currency: string;

  /** Optimistic concurrency check against the latest budget version. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedVersion?: number;
}
