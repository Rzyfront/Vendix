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
 *  - Opcional. Si llega, debe ser uno de los tres valores canónicos.
 *  - Si no llega, el backend lo deriva:
 *      - `before_fire`     → `inventory_consumed_at_fire=false`
 *      - `after_fire_waste`→ `inventory_consumed_at_fire=true`
 *    La derivación es segura: depende solo del flag persistido, no del
 *    estado del ticket KDS en runtime.
 *
 * | Carril | Valor persistido | ¿Habilita remake? |
 * | --- | --- | --- |
 * | Línea sin fire | `before_fire` | No |
 * | Línea/mesa/orden disparada, reuso | `after_fire_reused` | Sí |
 * | Línea/mesa/orden disparada, merma | `after_fire_waste` | Sí |
 * | Reversa de entrega, restock | `after_fire_reused` | Sí si fue disparada |
 * | Reversa de entrega, waste | `after_fire_waste` | Sí si fue disparada |
 * `delivered_restock` / `delivered_waste` son sólo lectura histórica.
 */
export type CancellationType = 'before_fire' | 'after_fire_reused' | 'after_fire_waste';

export class CancelOrderItemDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsEnum(['before_fire', 'after_fire_reused', 'after_fire_waste'])
  cancellation_type?: CancellationType;
}

/**
 * 1060 paso 2 — body de la reversa de entrega
 * (`POST /store/orders/:orderId/flow/items/:orderItemId/cancel-delivered`).
 *
 * Extiende `CancelOrderItemDto` (hereda `reason` 3–500 obligatorio) y exige
 * `destination`: `restock` devuelve las unidades al stock vía
 * `StockLevelManager`, `waste` deja la merma auditada sin tocar stock.
 * Ambas variantes escriben `audit_logs` (`order_item.cancel_delivered`).
 */
export type CancelDeliveredDestination = 'restock' | 'waste';

export class CancelDeliveredOrderItemDto extends CancelOrderItemDto {
  @IsEnum(['restock', 'waste'])
  destination!: CancelDeliveredDestination;
}
