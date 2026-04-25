import { IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CheckoutPreviewDto {
  @Type(() => Number)
  @IsNumber()
  planId: number;
}
