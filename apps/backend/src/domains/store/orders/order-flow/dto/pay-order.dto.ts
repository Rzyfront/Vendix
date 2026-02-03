import { IsInt, IsEnum, IsOptional, IsNumber, Min } from 'class-validator';

export enum PaymentType {
  DIRECT = 'direct',
  ONLINE = 'online',
}

export class PayOrderDto {
  @IsInt()
  store_payment_method_id: number;

  @IsEnum(PaymentType)
  payment_type: PaymentType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount_received?: number;
}
