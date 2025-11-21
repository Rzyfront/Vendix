import {
  IsNumber,
  IsString,
  IsOptional,
  IsObject,
  IsEnum,
  Min,
  MaxLength,
  IsArray,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { payment_methods_type_enum } from '@prisma/client';

export class CreatePaymentDto {
  @IsNumber()
  @Type(() => Number)
  orderId: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  customerId?: number;

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @IsString()
  @MaxLength(10)
  currency: string;

  @IsNumber()
  @Type(() => Number)
  storePaymentMethodId: number;

  @IsNumber()
  @Type(() => Number)
  storeId: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  returnUrl?: string;

  @IsOptional()
  @IsString()
  cancelUrl?: string;
}

export class CreateOrderPaymentDto extends CreatePaymentDto {
  @IsString()
  @MaxLength(255)
  customerEmail: string;

  @IsString()
  @MaxLength(100)
  customerName: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerPhone?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  billingAddressId?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  shippingAddressId?: number;

  @IsOptional()
  @IsArray()
  items?: OrderItemDto[];
}

export class OrderItemDto {
  @IsNumber()
  @Type(() => Number)
  productId: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  productVariantId?: number;

  @IsString()
  productName: string;

  @IsOptional()
  @IsString()
  variantSku?: string;

  @IsOptional()
  @IsObject()
  variantAttributes?: Record<string, any>;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitPrice: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  totalPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  taxRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  taxAmountItem?: number;
}

export class RefundPaymentDto {
  @IsString()
  paymentId: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class PaymentQueryDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum([
    'pending',
    'succeeded',
    'failed',
    'authorized',
    'captured',
    'refunded',
    'partially_refunded',
  ])
  status?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  orderId?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  customerId?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  storeId?: number;

  @IsOptional()
  @IsEnum(payment_methods_type_enum)
  paymentMethodType?: payment_methods_type_enum;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  sort?: string;
}
