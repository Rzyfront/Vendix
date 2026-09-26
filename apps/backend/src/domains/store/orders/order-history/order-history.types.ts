import type { order_state_enum } from '@prisma/client';

/**
 * Plan order-truth-and-invoice-tz — Objetivo 5/6.
 *
 * Unión cerrada: `OrderHistoryService.record` solo acepta uno de estos tipos.
 * Un valor fuera de esta unión NO COMPILA — es la garantía de que
 * `order_events.event_type` nunca se puebla con un string libre inventado en
 * el sitio de la llamada.
 */
export type OrderEventType =
  | 'state_changed'
  | 'payment_registered'
  | 'payment_cancelled'
  | 'refund_created'
  | 'refund_resolved'
  | 'customer_changed'
  | 'item_delivered'
  | 'item_cancelled'
  | 'item_delivery_reverted'
  | 'shipping_assigned'
  | 'invoice_issued';

/**
 * Origen del cambio. Determina `actor_source` cuando el llamador no puede
 * resolver un actor humano desde `RequestContextService` (webhooks, jobs,
 * listeners de cocina/despacho, o el propio sistema).
 */
export type OrderEventSource = 'http' | 'webhook' | 'job' | 'listener' | 'system';

/**
 * Entrada de `OrderHistoryService.record`. `storeId` es SIEMPRE explícito —
 * nunca se infiere del contexto de request — porque `tx` (el cliente de
 * transacción) es, en el patrón actual de Vendix
 * (`BasePrismaService.$transaction` delega al `baseClient` sin scope), un
 * PrismaClient SIN scope de tienda: si `record` confiara en el contexto para
 * el `store_id`, una transacción cruzada (job, webhook) podría escribir un
 * evento sin tienda o con la tienda equivocada.
 */
export interface RecordOrderEventInput {
  orderId: number;
  storeId: number;
  organizationId?: number | null;
  type: OrderEventType;
  fromState?: order_state_enum | null;
  toState?: order_state_enum | null;
  source?: OrderEventSource;
  actorUserId?: number | null;
  paymentId?: number | null;
  orderItemId?: number | null;
  amount?: number | string | null;
  payload?: Record<string, unknown> | null;
}
