import { IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class CheckoutCommitDto {
  @Type(() => Number)
  @IsNumber()
  planId: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  paymentMethodId?: number;
}
