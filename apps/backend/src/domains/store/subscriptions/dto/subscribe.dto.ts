import { IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class SubscribeDto {
  @Type(() => Number)
  @IsNumber()
  planId: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  partnerOverrideId?: number;
}
