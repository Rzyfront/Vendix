/**
 * Carrier pool CONTRACT — the single owner of "which order is in the pool".
 *
 * Antes de este archivo el predicado del pool vivía duplicado en tres lugares
 * (`listPool`, `claim` y la admisión de `sendToDispatchPool`) y uno de ellos
 * quedó desfasado: cuando el flujo pasó a crear la remisión AL PUBLICAR (antes
 * se creaba al reclamar), `orders.dispatch_fulfillment` empezó a quedar en
 * `'full'` para TODA orden pooleada — que es justo el caso sano — mientras el
 * lector seguía filtrando `dispatch_fulfillment != 'full'`. Resultado medido en
 * producción: la orden se pooleaba con `success: true` y jamás aparecía en la
 * app de reparto, y el único registro visible era una orden `finished` con el
 * flag de pool rancio.
 *
 * `dispatch_fulfillment` NO vuelve a usarse como predicado de pool: es un
 * rollup de cuánto se remitió, no una respuesta a "¿queda por entregar?". La
 * verdad de "todavía entregable" es el ESTADO DE LA ORDEN.
 *
 * Cualquier consumidor que lea, reclame o publique en el pool DEBE tomar sus
 * estados de aquí. Reescribir la lista en el call site es la regresión.
 */

import { Prisma, order_state_enum } from '@prisma/client';

/**
 * Estados desde los que un admin PUEDE publicar una orden al pool.
 *
 * `processing` es el canónico (stock reservado, mercancía lista para salir).
 * `pending_payment` se admite por el atajo COD: el repartidor cobra al
 * entregar, así que la orden puede no estar pagada todavía.
 *
 * Deliberadamente NO incluye `shipped`: publicar exige que la orden esté ANTES
 * del despacho. Una orden ya despachada por otro flujo (planilla, envío
 * directo) no se publica — su remisión ya tiene dueño.
 */
export const POOL_PUBLISHABLE_ORDER_STATES = [
  order_state_enum.processing,
  order_state_enum.pending_payment,
] as const;

/**
 * Estados en los que una orden pooleada SIGUE VISIBLE / reclamable.
 *
 * Superconjunto del publicable porque el ciclo de vida avanza la orden DESPUÉS
 * de publicarla: `sendToDispatchPool` crea la remisión en `confirmed`, y el
 * reconciliador (`reconcileOrderFromDispatch`) sube la orden a `shipped` en
 * cuanto existe una remisión despachada sin parada de ruta abierta que la
 * limite. Sin `shipped` aquí, la orden se autoexpulsaría del pool minutos
 * después de publicarla — la misma clase de bug que este contrato cierra.
 *
 * Lo que queda FUERA es lo importante: `delivered` / `finished` (la mercancía
 * ya llegó), `cancelled` / `refunded` (deshecha) y `draft` / `created` (no hay
 * nada que despachar). Eso mantiene el pool limpio incluso con órdenes que
 * arrastran un `dispatch_pool_at` rancio de un flujo antiguo, sin necesidad de
 * una migración correctiva de datos.
 */
export const POOL_VISIBLE_ORDER_STATES = [
  order_state_enum.processing,
  order_state_enum.pending_payment,
  order_state_enum.shipped,
] as const;

/**
 * Predicado Prisma de PERTENENCIA AL POOL, compartido literalmente por el
 * lector (`listPool`) y por el guard atómico del claim (`claim` STEP 1) para
 * que no puedan volver a divergir: publicada, sin reclamar y aún entregable.
 *
 * `orders` es auto-scoped por `StorePrismaService`, así que el filtro de tenant
 * NO va aquí. El claim, que escribe vía `updateMany`, añade su `store_id`
 * explícito por seguridad multi-tenant en la escritura.
 */
export function poolMembershipWhere(): Prisma.ordersWhereInput {
  return {
    dispatch_pool_at: { not: null },
    claimed_by_carrier_user_id: null,
    state: { in: [...POOL_VISIBLE_ORDER_STATES] },
  };
}
