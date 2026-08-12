import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  Min,
  Max,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * QUI-647 — Configuración del plan de pago de una OC YA CREADA (PATCH).
 *
 * Permite ajustar el plan después de crear la orden (desde el detalle, modal
 * "Configurar plan de pago"). El service valida que la OC admita el cambio
 * (no recibida/anulada/cerrada y sin pagos reales que bloqueen). Mismas
 * reglas de validación de negocio que `CreatePurchaseOrderDto` (reutiliza
 * el mismo flujo de `IsValidPaymentPlan` + códigos `PO_PAYMENT_*`).
 */
export type ConfigurePaymentPlanMode =
  | 'immediate'
  | 'partial'
  | 'deferred'
  | 'installments';

export class ConfigurePaymentPlanInstallmentDto {
  @IsDateString()
  scheduled_date!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999999999.99)
  amount!: number;
}

export class ConfigurePaymentPlanDto {
  @IsIn(['immediate', 'partial', 'deferred', 'installments'])
  payment_plan!: ConfigurePaymentPlanMode;

  @ValidateIf((o: ConfigurePaymentPlanDto) => o.payment_plan === 'partial')
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999999999.99)
  @IsOptional()
  down_payment_amount?: number;

  @IsOptional()
  @IsDateString()
  payment_due_date?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfigurePaymentPlanInstallmentDto)
  payment_installments?: ConfigurePaymentPlanInstallmentDto[];
}
