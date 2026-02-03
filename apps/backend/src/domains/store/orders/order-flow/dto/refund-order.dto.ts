import { IsOptional, IsNumber, IsString, MaxLength, Min } from 'class-validator';

export class RefundOrderDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsString()
  @MaxLength(500)
  reason: string;
}
