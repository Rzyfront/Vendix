import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const ACTIVATE_PLAN_PAYMENT_METHODS = [
  'consignacion',
  'transferencia',
  'efectivo',
  'otro',
] as const;

/**
 * Cuerpo de `POST /superadmin/subscriptions/stores/:storeId/activate-plan`.
 *
 * Solo `plan_id` es obligatorio: el superadmin activa un plan a una tienda
 * que pagó por fuera de la pasarela (consignación). Todo lo demás es
 * opcional; sin `amount` se registra el total de la factura como pagado.
 */
export class ActivateStorePlanDto {
  @IsInt()
  plan_id!: number;

  /**
   * Monto acreditado, >= 0. Se acepta number o string numérico y se
   * normaliza a string para construir un `Prisma.Decimal` sin pasar por
   * coma flotante.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'number' ? String(value) : value))
  @Matches(/^\d+(\.\d+)?$/, {
    message: 'amount must be a non-negative numeric value',
  })
  amount?: string;

  @IsOptional()
  @IsIn(ACTIVATE_PLAN_PAYMENT_METHODS as unknown as string[])
  payment_method?: (typeof ACTIVATE_PLAN_PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  reference?: string;

  @IsOptional()
  @IsDateString()
  paid_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
