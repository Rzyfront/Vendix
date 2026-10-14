import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Matches } from 'class-validator';

/**
 * Cuerpo de `POST /superadmin/subscriptions/stores/:storeId/activate-plan/preview`.
 * Calcula la cotización de la activación sin escribir nada.
 */
export class ActivateStorePlanPreviewDto {
  @IsInt()
  plan_id!: number;

  /** Fecha de inicio `YYYY-MM-DD` (validada contra el rango permitido en el servicio). */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'starts_at must be a YYYY-MM-DD date',
  })
  starts_at?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'number' ? String(value) : value))
  @Matches(/^\d+(\.\d+)?$/, {
    message: 'amount must be a non-negative numeric value',
  })
  amount?: string;
}
