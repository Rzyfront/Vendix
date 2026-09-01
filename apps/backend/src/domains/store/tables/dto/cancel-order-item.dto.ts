import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * carril D / lina — D2: body del endpoint POST de cancelación de ítem.
 *
 * El endpoint es DEFINITIVO en `TableSessionsController` (no provisional;
 * no migra después a `orders.controller.ts`): la cancelación tiene su
 * contexto completo aquí — sesión de mesa abierta, KDS disparado, stock
 * comprometido — y moverlo dejaría un segundo callsite duplicado.
 *
 * Reglas del campo `reason`:
 *  - Obligatorio siempre (min 3, max 500) — el dueño cancela un plato
 *    y queda registro escrito de por qué.
 *  - Auditoría: se persiste en `order_items.cancellation_reason` para
 *    que el KDS y el listado de órdenes puedan mostrarlo.
 *
 * Reglas del campo `cancellation_type`:
 *  - Opcional. Si llega, debe ser uno de los dos valores canónicos.
 *  - Si no llega, el backend lo deriva:
 *      - `before_fire`     → `inventory_consumed_at_fire=false`
 *      - `after_fire_waste`→ `inventory_consumed_at_fire=true`
 *    La derivación es segura: depende solo del flag persistido, no del
 *    estado del ticket KDS en runtime.
 */
export type CancellationType = 'before_fire' | 'after_fire_waste';

export class CancelOrderItemDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsEnum(['before_fire', 'after_fire_waste'])
  cancellation_type?: CancellationType;
}
