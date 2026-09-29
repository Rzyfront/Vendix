import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import type {
  OrderEventSource,
  RecordOrderEventInput,
} from './order-history.types';

/**
 * Cliente de escritura aceptado por `record`.
 *
 * En el patrón actual de Vendix, `BasePrismaService.$transaction` delega
 * directo a `baseClient.$transaction` (ver `base-prisma.service.ts`), así que
 * el `tx` recibido dentro de `this.prisma.$transaction(async (tx) => ...)` es
 * SIEMPRE el PrismaClient SIN scope de tienda — nunca el cliente scopeado.
 * Por eso `record` nunca confía en el scoping automático de `store_id` y
 * siempre lo escribe explícito desde `evt.storeId` (ver `RecordOrderEventInput`).
 *
 * `StorePrismaService` se acepta también para el caso, más raro, de un
 * llamador que registra un evento fuera de una transacción explícita.
 */
type OrderHistoryTx = Prisma.TransactionClient | StorePrismaService;

@Injectable()
export class OrderHistoryService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Registra un evento de historial de orden DENTRO de `tx`. Si `tx` hace
   * rollback, el evento nunca existió — esa es la garantía de veracidad del
   * plan (Objetivo 5): el historial jamás puede desincronizarse del cambio
   * real porque comparten la misma transacción.
   *
   * NO atrapa errores a propósito: si `tx.order_events.create` falla, la
   * excepción se propaga sin envoltorio. Envolverla en try/catch reintroduce
   * el riesgo (escribir un evento cuyo cambio de negocio en realidad no
   * ocurrió, o viceversa) que esta tabla dedicada existe para eliminar.
   *
   * `state_changed` con `fromState === toState` no es una transición real
   * (p.ej. una escritura de estado que no cambia nada); no escribe fila y
   * retorna `null` en su lugar.
   *
   * El actor sale de `RequestContextService` cuando el llamador no lo fija
   * explícitamente; sin contexto de usuario, `actor_user_id` queda `null` y
   * `actor_source` cae a `'system'` salvo que el llamador indique otro origen
   * explícito (webhook/job/listener).
   */
  async record(
    tx: OrderHistoryTx,
    evt: RecordOrderEventInput,
  ): Promise<{ id: number } | null> {
    if (evt.type === 'state_changed') {
      const from = evt.fromState ?? null;
      const to = evt.toState ?? null;
      if (from === to) {
        return null;
      }
    }

    const contextUserId = RequestContextService.getUserId();
    const actorUserId = evt.actorUserId ?? contextUserId ?? null;
    const source: OrderEventSource =
      evt.source ?? (contextUserId ? 'http' : 'system');
    const requestId = RequestContextService.getRequestId() ?? null;

    const data: Prisma.order_eventsUncheckedCreateInput = {
      order_id: evt.orderId,
      store_id: evt.storeId,
      organization_id: evt.organizationId ?? null,
      event_type: evt.type,
      from_state: evt.fromState ?? null,
      to_state: evt.toState ?? null,
      actor_user_id: actorUserId,
      actor_source: source,
      payment_id: evt.paymentId ?? null,
      order_item_id: evt.orderItemId ?? null,
      amount: evt.amount ?? null,
      payload: evt.payload ?? undefined,
      request_id: requestId,
    };

    return tx.order_events.create({ data });
  }

  /**
   * Timeline crudo de una orden, orden cronológico ascendente, con el actor
   * (si lo hay). Alimenta el paso 7 (`getTimeline`); el fallback a
   * `audit_logs` para órdenes sin eventos vive en `orders.service.ts`, no acá.
   */
  async listForOrder(orderId: number) {
    return this.prisma.order_events.findMany({
      where: { order_id: orderId },
      orderBy: { created_at: 'asc' },
      include: {
        users: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });
  }
}
