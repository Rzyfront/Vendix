import { IsEnum, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { payments_state_enum } from '@prisma/client';
import { AnalyticsQueryDto } from './analytics-query.dto';

/**
 * Normaliza un filtro multi-valor: params repetidos (`?state=a&state=b`) llegan
 * como array, el frontend serializa con coma (`?state=a,b`) y el valor único
 * es un string. Réplica local de `normalizeMultiValue` de order-query.dto.ts
 * (allí no es exportable). undefined/vacío -> undefined.
 */
export function normalizeMultiValue({
  value,
}: {
  value: unknown;
}): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const parts = value
      .flatMap((v) => String(v).split(','))
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    return parts.length > 0 ? parts : undefined;
  }
  if (typeof value !== 'string') return [String(value)];
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

/** Igual que {@link normalizeMultiValue} pero convierte cada elemento a entero. */
function normalizeIntMultiValue({
  value,
}: {
  value: unknown;
}): number[] | undefined {
  const parts = normalizeMultiValue({ value });
  if (!parts) return undefined;
  // NaN se conserva a propósito: @IsInt({each}) lo rechaza con 400.
  return parts.map((part) => Number(part));
}

export const PAYMENTS_SORT_FIELDS = [
  'effective_date',
  'amount',
  'state',
] as const;
export type PaymentsSortField = (typeof PAYMENTS_SORT_FIELDS)[number];

/**
 * Filtros del reporte y la analítica de pagos. Sin `state` se incluyen todos
 * los estados. La fecha efectiva es `COALESCE(paid_at, created_at)` en la zona
 * horaria de la tienda (rango resuelto por `parseDateRange`).
 */
export class PaymentsAnalyticsQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @Transform(normalizeMultiValue)
  @IsEnum(payments_state_enum, { each: true })
  state?: payments_state_enum[];

  /** `store_payment_methods.id` (multi: CSV o repetido). */
  @IsOptional()
  @Transform(normalizeIntMultiValue)
  @IsInt({ each: true })
  payment_method_id?: number[];

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(PAYMENTS_SORT_FIELDS)
  sort_by?: PaymentsSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';
}
