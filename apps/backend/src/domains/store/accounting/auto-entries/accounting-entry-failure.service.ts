import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { AutoEntryEventData } from './auto-entry.service';

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
