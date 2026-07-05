import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { AutoEntryEventData } from './auto-entry.service';
import { VendixHttpException } from '../../../../common/errors/vendix-http.exception';
import { ErrorCodes } from '../../../../common/errors/error-codes';

export const ACCOUNTING_ENTRY_RETRY_QUEUE = 'accounting-entry-retry';

export interface AccountingEntryRetryJob {
  failure_id: number;
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
