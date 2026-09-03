import { IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body de la acción "Asignar cuenta" sobre un pago sin asignar.
 *
 * CP-POLLO-ARABE-727 / E.2 (cross-ref QUI-728).
 * El `payment_id` viaja en el path (`:payment_id`); el body solo lleva la cuenta.
 */
export class AssignPaymentAccountDto {
  @IsNumber()
  @Type(() => Number)
  bank_account_id: number;
}
