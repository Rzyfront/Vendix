import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Job } from 'bullmq';
import { RequestContextService } from '../../../../../common/context/request-context.service';
import { AutoEntryService, AutoEntryEventData } from '../auto-entry.service';
import { ManualRefundDeliveryService, MANUAL_REFUND_DELIVERY_KEY } from '../manual-refund-delivery.service';
import {
  ACCOUNTING_ENTRY_RETRY_QUEUE,
  AccountingEntryRetryJob,
  AccountingEntryFailureService,
} from '../accounting-entry-failure.service';
import {
  MovementsService,
  REFUND_CASH_MOVEMENT_KEY,
} from '../../../cash-registers/movements/movements.service';

/**
 * Reintenta asientos automáticos fallidos. Reejecuta `postAutoEntry` con el
 * payload crudo guardado. El re-post es idempotente (createAutoEntry salta si
 * ya existe un asiento para el mismo `source_type/source_id/entity`), así que
 * un reintento nunca duplica. El re-throw en el catch deja que BullMQ aplique
 * el backoff exponencial hasta agotar `attempts`.
 *
 * Dos claves semánticas NO van a `postAutoEntry`: `manual_refund_delivery_v1`
 * (asiento de un refund manual) y `refund_cash_movement_v1` (movimiento de
 * caja de un refund en efectivo) — cada una va a su entrega durable.
 */
@Processor(ACCOUNTING_ENTRY_RETRY_QUEUE)
export class AccountingEntryRetryProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountingEntryRetryProcessor.name);

  constructor(
    private readonly auto_entry_service: AutoEntryService,
    private readonly failure_service: AccountingEntryFailureService,
    private readonly manualRefundDelivery: ManualRefundDeliveryService,
    private readonly moduleRef: ModuleRef,
  ) {
    super();
  }

  async process(job: Job<AccountingEntryRetryJob>): Promise<void> {
    const { failure_id } = job.data;
    const failure = await this.failure_service.findOne(failure_id);
    if (!failure) {
      this.logger.warn(`Retry job for missing failure #${failure_id}; skipping`);
      return;
    }
    if (failure.resolved_at) {
      // Ya se resolvió (p.ej. por un reintento manual o el evento original).
      return;
    }
    if (failure.handler_key === MANUAL_REFUND_DELIVERY_KEY) {
      await this.manualRefundDelivery.deliver(failure_id);
      return;
    }
    if (failure.handler_key === REFUND_CASH_MOVEMENT_KEY) {
      // Release-853 (paso 6): el reintento (manual desde la bandeja o de
      // cola) de un movimiento de caja va a la entrega durable, NUNCA a
      // `postAutoEntry` — el payload no es un asiento contable. `ModuleRef`
      // perezoso (`strict: false`) en vez de importar CashRegistersModule:
      // evita cablear módulos entre dominios y con eso cualquier ciclo.
      const movements = this.moduleRef.get(MovementsService, {
        strict: false,
      });
      await movements.deliverRefundCashMovement(failure_id);
      return;
    }

    const payload = this.revive(
      failure.event_payload as unknown as AutoEntryEventData,
    );

    try {
      const entry = await RequestContextService.run(
        {
          is_super_admin: false,
          is_owner: false,
          store_id: payload.store_id,
          organization_id: payload.organization_id,
          user_id: payload.user_id,
          request_id: `accounting-retry-${failure_id}`,
        },
        () => this.auto_entry_service.postAutoEntry(payload),
      );
      // CP-PURCHASE-TRANSPARENCY C.9 — `postAutoEntry` puede devolver `null`
      // sin lanzar (área contable inactiva, menos de dos líneas válidas). Antes
      // ese retorno nulo marcaba el fallo como RESUELTO: la bandeja se vaciaba
      // sola sin que ningún asiento existiera. La causa del salto ya quedó
      // escrita en la misma fila por `recordSkip`, así que aquí basta con no
      // mentir: sin asiento, el fallo sigue abierto.
      if (!entry) {
        this.logger.warn(
          `Retry of auto-entry failure #${failure_id} produced NO entry ` +
            `(${payload.source_type}#${payload.source_id ?? '?'}); leaving it unresolved.`,
        );
        return;
      }
      await this.failure_service.markResolved(failure_id);
      this.logger.log(
        `Auto-entry failure #${failure_id} resolved on retry ` +
          `(${payload.source_type}#${payload.source_id ?? '?'})`,
      );
    } catch (error: any) {
      await this.failure_service.recordAttempt(failure_id, error as Error);
      this.logger.error(
        `Retry of auto-entry failure #${failure_id} failed: ${error.message}`,
      );
      throw error; // BullMQ aplica backoff / agota attempts
    }
  }

  /**
   * El payload viaja por JSON en la cola/BD, así que `entry_date` llega como
   * string ISO. Se rehidrata a `Date` para que la búsqueda del período fiscal
   * (`start_date lte / end_date gte`) opere con un valor temporal real.
   */
  private revive(payload: AutoEntryEventData): AutoEntryEventData {
    const raw = payload as unknown as { entry_date?: unknown };
    if (typeof raw.entry_date === 'string') {
      return { ...payload, entry_date: new Date(raw.entry_date) };
    }
    return payload;
  }
}
