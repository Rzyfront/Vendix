import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class PaymentRequestQueryDto {
  @IsOptional()
  @IsIn(['pending', 'awaiting_confirmation', 'paid', 'expired', 'cancelled'])
  status?: 'pending' | 'awaiting_confirmation' | 'paid' | 'expired' | 'cancelled';

  @IsOptional()
  @IsString()
  @MaxLength(30)
  purpose?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class RejectPaymentRequestDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}
