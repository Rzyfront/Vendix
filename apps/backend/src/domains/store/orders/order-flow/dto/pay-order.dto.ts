import {
  IsInt,
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

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

  // ── Propina (T3) ────────────────────────────────────────────────────────
  // Mismos nombres y validadores que `CreatePosPaymentDto`: el frontend usa
  // un solo `app-payment-collector` para POS, mesa y detalle de orden, así
  // que el contrato tiene que ser idéntico en los tres destinos. Cambiar un
  // nombre aquí convierte el envío del collector en un 400 por
  // `forbidNonWhitelisted`, no en un campo ignorado.
  //
  // La resolución (porcentaje → monto anclado) la hace `resolveTip`
  // (common/utils/tip.util.ts), compartida con el cierre de mesa del POS.

  /** Monto de propina. Si llega, gana sobre cualquier porcentaje. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  tip_amount?: number;

  /**
   * Modo elegido por el operador. 'percentage' → `tip_value` es el % (0-100)
   * y se calcula sobre el subtotal de venta. 'fixed' → `tip_value` es el
   * monto. Si no llega y hubo monto, el backend asume 'fixed'.
   */
  @IsOptional()
  @IsEnum(['percentage', 'fixed'])
  tip_type?: 'percentage' | 'fixed';

  /** Valor base: % si `tip_type='percentage'`, monto si 'fixed'. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  tip_value?: number;

  /**
   * Mesero que recibe la propina. Atribución para informes; esta iteración
   * NO reparte ni liquida. FK a users.id (ON DELETE SET NULL).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  tip_waiter_id?: number;
}
