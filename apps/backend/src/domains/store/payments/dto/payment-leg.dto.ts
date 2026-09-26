import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Un tramo del cobro multimétodo de contado (`payments[]`).
 *
 * Cada tramo es un pago directo e inmediato por su propio monto: misma forma
 * que los campos escalares de `CreatePosPaymentDto` / `PayOrderDto`, repetida
 * por método. Validadores espejados a propósito de los escalares:
 * `amount_received` admite `0` a nivel de DTO para que el normalizador
 * (`normalizePaymentLegs`) lo rechace con `PAY_MULTI_TENDER_CASH_INSUFFICIENT`
 * en vez de caer en un 422 genérico de validación.
 */
export class PaymentLegDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  store_payment_method_id: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  amount_received?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  payment_reference?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  bank_account_id?: number;
}
