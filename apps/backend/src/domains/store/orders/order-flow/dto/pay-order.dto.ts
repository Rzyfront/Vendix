import {
  IsInt,
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  IsString,
} from 'class-validator';

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

  // Credit payment fields
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsInt()
  installment_id?: number;

  @IsOptional()
  @IsString()
  payment_reference?: string;
}
