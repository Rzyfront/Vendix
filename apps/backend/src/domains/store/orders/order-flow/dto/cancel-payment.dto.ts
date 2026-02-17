import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
