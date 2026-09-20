import {
  IsNumber,
  IsString,
  IsOptional,
  IsObject,
  IsEnum,
  IsIn,
  IsBoolean,
  Min,
  MaxLength,
  IsArray,
  Max,
  IsInt,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { payment_methods_type_enum } from '@prisma/client';

/**
 * Contrato CERRADO de `metadata` para los endpoints de pago sobre orden
 * existente. Antes era `Record<string, any>`: el `ValidationPipe` global
 * (`whitelist` + `forbidNonWhitelisted`) NO recurre dentro de un objeto sin
 * tipo, así que cualquier llave del cliente entraba intacta al servicio. Por ahí
 * viajaba `is_pos_payment`, que el gateway leía para saltarse la validación de
 * orden y la compuerta anti-sobrepago.
 *
 * Con `@ValidateNested()` + `@Type()` el pipe sí recurre: una llave no declarada
 * se rechaza en el borde con 400 `SYS_VALIDATION_001`, que es ruidoso y seguro
 * (no mueve plata), en vez de colarse en silencio.
 *
 * Reglas para extenderlo:
 * - Solo datos de auditoría/contexto que el servidor persiste en
 *   `payments.gateway_response` o que el processor consume.
 * - NUNCA una bandera que altere validación, autorización o cálculo de dinero:
 *   eso lo decide el servidor a partir de sus propios datos, no del body.
 */
export class PaymentMetadataDto {
  /** Marca de auditoría: el cobro viene del POS sobre una orden ya existente. */
  @IsOptional()
  @IsBoolean()
  is_adopted_order?: boolean;

  /** Caja registradora que cobra (`cash_registers.id`), para el arqueo. */
  @IsOptional()
  @IsString()
  register_id?: string;

  /** Vendedor que atiende, para comisiones y reportes. */
  @IsOptional()
  @IsString()
  seller_user_id?: string;

  /** Tipo de medio Wompi elegido en el POS (CARD, NEQUI, ...). */
  @IsOptional()
  @IsString()
  wompi_payment_method?: string;

  /**
   * Monedero del cliente cuando el medio es `wallet`. Numérico: el POS lo toma
   * de `walletInfo().wallet_id` (`payment.model.ts` → `walletId?: number`).
   * Declararlo `@IsString()` no habría fallado —`enableImplicitConversion`
   * lo habría convertido a texto en silencio— pero habría guardado "5" en vez
   * de 5 en `gateway_response`.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  wallet_id?: number;

  /** Efectivo entregado por el cliente; el vuelto lo calcula el servidor. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cash_received?: number;

  /** Sesión de mesa (restaurante) que este cobro cierra. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  table_session_id?: number;

  /** Mesa (restaurante) asociada al cobro. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  table_id?: number;
}

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

  /**
   * QUI-728 — cuenta bancaria de destino del pago por transferencia
   * (`bank_accounts.id`). `@IsInt()` en el DTO es solo shape; la validación
   * real (existe + activa + organización + scope de tienda) vive en el
   * servicio (`payment-gateway.service.ts`).
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  bank_account_id?: number;

  /**
   * Carga OPACA de auditoría/contexto. El servidor la persiste y la pasa al
   * processor; nunca decide con ella qué validaciones corren. Ver
   * `PaymentMetadataDto`.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PaymentMetadataDto)
  metadata?: PaymentMetadataDto;

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
  @IsIn([
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
