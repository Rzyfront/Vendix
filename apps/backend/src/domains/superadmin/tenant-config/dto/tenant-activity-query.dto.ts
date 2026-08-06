import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Ventana por defecto del panel de actividad, en días naturales del tenant. */
export const TENANT_ACTIVITY_DEFAULT_DAYS = 30;

/**
 * Techo de la ventana. No es una cifra estética: `actions_by_day` se rellena
 * con un bucket por día, así que `days` fija de forma directa el tamaño de la
 * respuesta y el número de iteraciones del zero-fill.
 */
export const TENANT_ACTIVITY_MAX_DAYS = 365;

/**
 * Ventana de las series de la ficha de actividad (`actions_by_day`,
 * `top_actions`, `top_users`, `modules_touched`).
 *
 * NO gobierna `active_users_7d` / `active_users_30d`: esos dos contadores
 * llevan su periodo en el nombre y se calculan siempre contra 7 y 30 días,
 * pase lo que pase en `days`. Si el parámetro los moviera, `active_users_7d`
 * con `days=3` mediría tres días y el nombre mentiría.
 */
export class TenantActivityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'days debe ser un entero' })
  @Min(1, { message: 'days debe ser al menos 1' })
  @Max(TENANT_ACTIVITY_MAX_DAYS, {
    message: `days no puede exceder ${TENANT_ACTIVITY_MAX_DAYS}`,
  })
  days?: number;
}
