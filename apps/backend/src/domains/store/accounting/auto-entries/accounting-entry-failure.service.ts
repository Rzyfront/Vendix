import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { AutoEntryEventData } from './auto-entry.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException } from '../../../../common/errors/vendix-http.exception';
import { ErrorCodes } from '../../../../common/errors/error-codes';

export const ACCOUNTING_ENTRY_RETRY_QUEUE = 'accounting-entry-retry';

export interface AccountingEntryRetryJob {
  failure_id: number;
}

/**
 * CP-PURCHASE-TRANSPARENCY C.9 — los CUATRO caminos por los que una operación
 * de negocio se completa SIN asiento contable y sin que nadie lance.
 *
 * Antes de este paso los cuatro eran indistinguibles: `postAutoEntry` devolvía
 * `null`, el listener imprimía «Auto-entry created» igual y
 * `accounting_entry_failures` quedaba vacía. Medido contra la base de
 * desarrollo: 21 de 79 recepciones sin asiento y CERO filas de fallo.
 *
 * El prefijo importa: `SKIPPED_*` marca una omisión que NO se re-encola sola
 * (a diferencia de un fallo real, que sí encola reintento). Reintentar una
 * omisión legítima —el flujo está apagado a propósito— sería ruido.
 *
 * - `SKIPPED_ZERO_AMOUNT`     el monto del evento es cero o negativo: no hay
 *                              nada que contabilizar. Omisión correcta, pero
 *                              tiene que ser visible para poder cuadrar conteos.
 * - `SKIPPED_FLOW_DISABLED`   el subflujo contable está apagado para la
 *                              organización/tienda (decisión de configuración).
 * - `SKIPPED_AREA_INACTIVE`   el área fiscal `accounting` está inactiva
 *                              (red de seguridad de `postAutoEntry`).
 * - `SKIPPED_MISSING_MAPPING` menos de dos líneas válidas: falta la clave de
 *                              mapeo o la cuenta PUC. Es un DEFECTO de
 *                              configuración contable, no una decisión.
 */
export type AutoEntrySkipCause =
  | 'SKIPPED_ZERO_AMOUNT'
  | 'SKIPPED_FLOW_DISABLED'
  | 'SKIPPED_AREA_INACTIVE'
  | 'SKIPPED_MISSING_MAPPING';

/** Contexto mínimo para dejar rastro de una omisión sin asiento. */
export interface AutoEntrySkipRecord {
  organization_id: number;
  store_id?: number | null;
  /** `source_type` del asiento que NO se creó (p.ej. `purchase_order.received`). */
  source_type: string;
  /** Id del hecho de negocio omitido (recepción, ajuste, factura…). */
  source_id?: number | null;
  cause: AutoEntrySkipCause;
  /** Detalle legible: qué se evaluó y con qué resultado. */
  detail: string;
  /** Payload del evento, para poder reprocesar cuando la causa se corrija. */
  event_payload?: unknown;
}

/**
 * Observabilidad de asientos automáticos fallidos.
 *
 * Antes, cualquier fallo dentro de `AutoEntryService.createAutoEntry` (mapping
 * o cuenta PUC inexistente, período cerrado, error de BD) se perdía: el
 * try/catch del AccountingEventsListener solo lo logueaba y el asiento nunca
 * se creaba, sin rastro recuperable. Este servicio persiste el evento crudo +
 * el error en `accounting_entry_failures` y encola un reintento en la cola
 * BullMQ `accounting-entry-retry`. El reintento es seguro porque
 * `createAutoEntry` es idempotente por `(source_type, source_id, entity)`.
 *
 * C2: cuando el fallo viene de un período fiscal CERRADO
 * (`FISCAL_PERIOD_CLOSED`), el reintento NO se encola: postear retroactivamente
 * sobre un mes cerrado rompe la contabilidad ya emitida (declaraciones,
 * exógena, informes). El fallo se persiste igual para auditoría pero el job
 * BullMQ se omite. La detección usa el `error_code` del `VendixHttpException`
 * y un fallback por substring del mensaje para tolerar serializaciones JSON.
 */
@Injectable()
export class AccountingEntryFailureService {
  private readonly logger = new Logger(AccountingEntryFailureService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    @InjectQueue(ACCOUNTING_ENTRY_RETRY_QUEUE)
    private readonly retry_queue: Queue,
  ) {}

  /**
   * Devuelve true si el error proviene de un período fiscal cerrado y por
   * tanto NO debe encolarse un reintento automático (el posteo retroactivo
   * sobre un mes cerrado es incorrecto y la fila queda solo como auditoría).
   *
   * Detección por dos vías (en orden):
   * 1. `error instanceof VendixHttpException` con `errorCode ===
   *    ErrorCodes.FISCAL_PERIOD_CLOSED.code` — caso ideal cuando el servicio
   *    lanzó la excepción tipada.
   * 2. Fallback por substring del mensaje: tolerante si la excepción fue
   *    serializada (p.ej. por `JSON.stringify` en el caller) o re-empaquetada
   *    por el global filter.
   */
  private isClosedPeriodError(error: Error): boolean {
    const targetCode = ErrorCodes.FISCAL_PERIOD_CLOSED.code;
    if (error instanceof VendixHttpException) {
      if ((error as VendixHttpException).errorCode === targetCode) return true;
    }
    const message = error?.message ?? String(error);
    return message.includes(targetCode);
  }

  /**
   * Best-effort: registra el fallo y encola el reintento. NUNCA lanza — el
   * llamador (createAutoEntry) re-lanza el error original para preservar el
   * logging y las semánticas existentes; registrar el fallo no debe enmascarar
   * la causa raíz.
   */
  async recordFailure(
    event_data: AutoEntryEventData,
    error: Error,
  ): Promise<void> {
    try {
      const db = this.prisma.withoutScope();
      const is_closed_period = this.isClosedPeriodError(error);
      // Dedup: si ya hay un fallo NO resuelto para el mismo origen, solo se
      // incrementa el contador de intentos (no se apila otro job/fila).
      const existing = event_data.source_id
        ? await db.accounting_entry_failures.findFirst({
            where: {
              organization_id: event_data.organization_id,
              source_type: event_data.source_type,
              source_id: event_data.source_id,
              resolved_at: null,
            },
            select: { id: true },
          })
        : null;

      if (existing) {
        await db.accounting_entry_failures.update({
          where: { id: existing.id },
          data: {
            attempt_count: { increment: 1 },
            error_message: error.message ?? String(error),
          },
        });
        // Si el primer fallo era reintable y este intento ya detectó período
        // cerrado, no encolar más.
        if (is_closed_period) {
          this.logger.warn(
            `Failure #${existing.id} for ${event_data.source_type}#${
              event_data.source_id ?? '?'
            } now classified as FISCAL_PERIOD_CLOSED — skipping retry.`,
          );
        }
        return;
      }

      const row = await db.accounting_entry_failures.create({
        data: {
          organization_id: event_data.organization_id,
          store_id: event_data.store_id ?? null,
          handler_key: event_data.source_type,
          source_type: event_data.source_type,
          source_id: event_data.source_id ?? null,
          event_payload: event_data as unknown as Prisma.InputJsonValue,
          error_message: error.message ?? String(error),
        },
      });
      if (is_closed_period) {
        // C2: NO encolar reintento. La fila queda como bitácora de auditoría.
        this.logger.warn(
          `Recorded auto-entry failure #${row.id} for ${event_data.source_type}` +
            `#${event_data.source_id ?? '?'} — FISCAL_PERIOD_CLOSED, no retry queued.`,
        );
        return;
      }
      await this.enqueueRetry(row.id);
      this.logger.warn(
        `Recorded auto-entry failure #${row.id} for ${event_data.source_type}` +
          `#${event_data.source_id ?? '?'} and enqueued retry: ${error.message}`,
      );
    } catch (persistError: any) {
      // Ni siquiera pudimos persistir el fallo: queda al menos en el log.
      this.logger.error(
        `Could not persist auto-entry failure for ${event_data.source_type}` +
          `#${event_data.source_id ?? '?'}: ${persistError.message}`,
      );
    }
  }

  /**
   * CP-PURCHASE-TRANSPARENCY C.9 — deja rastro de un asiento OMITIDO.
   *
   * `recordFailure` cubre el fallo que lanza. Esto cubre lo contrario: los
   * cuatro caminos por los que `postAutoEntry` devuelve `null` (o el listener
   * ni siquiera lo llama) y la operación de negocio se completa sin asiento.
   * El silencio deja de ser un estado posible: siempre queda fila.
   *
   * Diferencias con `recordFailure`, deliberadas:
   * - `error_message` va PREFIJADO por la causa (`SKIPPED_*: …`), para que la
   *   consulta forense distinga «apagado a propósito» de «falló».
   * - NUNCA encola reintento. Una omisión no se reintenta sola; se corrige la
   *   causa (encender el flujo, mapear la cuenta) y se reintenta a mano desde
   *   `store/accounting/entry-failures/:id/retry`.
   * - `resolved_at` queda nulo, así que la fila aparece en la bandeja de
   *   `listUnresolved` hasta que alguien la atienda.
   *
   * Dedup por `(organization_id, source_type, source_id, resolved_at null)`,
   * el MISMO predicado de `recordFailure`: si el hecho ya tenía fila abierta
   * —porque falló antes, o porque se reintentó y volvió a omitirse— se
   * incrementa `attempt_count` y se reescribe el mensaje con la causa vigente,
   * en vez de apilar filas por el mismo hecho.
   *
   * Best-effort: nunca lanza. Registrar la omisión no puede tumbar la
   * operación de negocio que ya se completó.
   */
  async recordSkip(skip: AutoEntrySkipRecord): Promise<void> {
    const message = `${skip.cause}: ${skip.detail}`;
    try {
      const db = this.prisma.withoutScope();
      const request_id = RequestContextService.getRequestId();
      const payload = {
        ...(typeof skip.event_payload === 'object' && skip.event_payload
          ? (skip.event_payload as Record<string, unknown>)
          : { event_payload: skip.event_payload ?? null }),
        skip_cause: skip.cause,
        // El log del contenedor se borra en cada despliegue (`docker rm`), así
        // que el identificador de correlación tiene que vivir en la fila.
        ...(request_id ? { request_id } : {}),
      } as unknown as Prisma.InputJsonValue;

      const existing =
        skip.source_id != null
          ? await db.accounting_entry_failures.findFirst({
              where: {
                organization_id: skip.organization_id,
                source_type: skip.source_type,
                source_id: skip.source_id,
                resolved_at: null,
              },
              select: { id: true },
            })
          : null;

      if (existing) {
        await db.accounting_entry_failures.update({
          where: { id: existing.id },
          data: {
            attempt_count: { increment: 1 },
            error_message: message,
            event_payload: payload,
          },
        });
        this.logger.warn(
          `Auto-entry SKIPPED (${skip.cause}) for ${skip.source_type}#${
            skip.source_id ?? '?'
          } — updated failure row #${existing.id}. ${skip.detail}`,
        );
        return;
      }

      const row = await db.accounting_entry_failures.create({
        data: {
          organization_id: skip.organization_id,
          store_id: skip.store_id ?? null,
          handler_key: skip.source_type,
          source_type: skip.source_type,
          source_id: skip.source_id ?? null,
          event_payload: payload,
          error_message: message,
        },
      });
      this.logger.warn(
        `Auto-entry SKIPPED (${skip.cause}) for ${skip.source_type}#${
          skip.source_id ?? '?'
        } — recorded row #${row.id}, no retry queued. ${skip.detail}`,
      );
    } catch (persistError: any) {
      this.logger.error(
        `Could not persist auto-entry skip (${skip.cause}) for ${skip.source_type}` +
          `#${skip.source_id ?? '?'}: ${persistError.message}`,
      );
    }
  }

  async enqueueRetry(failure_id: number): Promise<void> {
    await this.retry_queue.add(
      'retry',
      { failure_id } as AccountingEntryRetryJob,
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    );
  }

  async listUnresolved(page = 1, limit = 20) {
    const db = this.prisma.withoutScope();
    const skip = (Math.max(1, page) - 1) * limit;
    const [data, total] = await Promise.all([
      db.accounting_entry_failures.findMany({
        where: { resolved_at: null },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      db.accounting_entry_failures.count({ where: { resolved_at: null } }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: number) {
    return this.prisma
      .withoutScope()
      .accounting_entry_failures.findUnique({ where: { id } });
  }

  async markResolved(id: number): Promise<void> {
    await this.prisma.withoutScope().accounting_entry_failures.update({
      where: { id },
      data: { resolved_at: new Date() },
    });
  }

  async recordAttempt(id: number, error: Error): Promise<void> {
    await this.prisma.withoutScope().accounting_entry_failures.update({
      where: { id },
      data: {
        attempt_count: { increment: 1 },
        error_message: error.message ?? String(error),
      },
    });
  }
}
