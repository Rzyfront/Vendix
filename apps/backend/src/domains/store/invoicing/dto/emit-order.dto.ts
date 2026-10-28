import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  Matches,
  ValidateNested,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isDianPaymentMeansCode } from '../providers/dian-direct/constants/dian-document-types';

@ValidatorConstraint({ name: 'isDianPaymentMeans', async: false })
class IsDianPaymentMeansConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isDianPaymentMeansCode(value);
  }
  defaultMessage(): string {
    return 'payment_means_code debe ser un código de la tabla de medios de pago de la DIAN (ej. "10", "42", "47").';
  }
}

/** Plazo de una factura a crédito emitida desde una orden sin cobrar. */
export class EmitOrderCreditDto {
  /** Fecha civil de vencimiento `YYYY-MM-DD` (se compara con el «hoy» de la tienda). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'due_date debe ser una fecha ISO 8601 de día (ej. "2026-09-15").',
  })
  due_date!: string;

  /** Medio de pago esperado (DIAN `MediosPago`); sin él se declara «sin definir» (`ZZZ`). */
  @IsOptional()
  @Validate(IsDianPaymentMeansConstraint)
  payment_means_code?: string;
}

/** Cuerpo opcional de `POST invoicing/orders/:orderId/emit`. */
export class EmitOrderDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EmitOrderCreditDto)
  credit?: EmitOrderCreditDto;

  /**
   * Opt-in explícito: si el cliente de la orden no tiene datos para una
   * factura nominativa, emitir a Consumidor final (`222222222222`) en vez de
   * responder 409 `INVOICING_HOLDER_INCOMPLETE_001`. Se ignora si el titular
   * está completo o si el problema no es sobrescribible.
   */
  @IsOptional()
  @IsBoolean()
  allow_final_consumer?: boolean;
}
