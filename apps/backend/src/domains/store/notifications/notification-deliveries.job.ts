import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { notification_type_enum, Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { NotificationRecipientsService } from './notification-recipients.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationEmailService } from './notification-email.service';
import { NotificationDeliveryPayload } from './notification-dispatcher.service';

export const DELIVERY_BATCH = 20;
export const DELIVERY_MAX_ATTEMPTS = 5;
/** Espera antes de los intentos 2..5 (minutos): 1m, 5m, 30m, 2h. */
export const DELIVERY_BACKOFF_MINUTES = [1, 5, 30, 120];
/**
 * Lease del claim: mientras un worker procesa la fila, `next_attempt_at` queda
 * en el futuro. Si el worker muere, la fila vuelve a estar disponible al vencer.
 */
export const DELIVERY_LEASE_MINUTES = 10;
/** Un ciclo drena lotes seguidos hasta vaciar la cola o gastar este tiempo. */
export const DELIVERY_CYCLE_BUDGET_MS = 50_000;
/** `error` de una fila que agotó sus intentos sin que su worker terminara. */
export const DELIVERY_ABANDONED_ERROR =
  'Abandoned while sending after the last attempt (worker died)';

export interface ClaimedDelivery {
  id: number;
  store_id: number;
  user_id: number;
  type: notification_type_enum;
  payload: Prisma.JsonValue;
  attempts: number;
}

export interface DeliverySummary {
  claimed: number;
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
}

type DeliveryOutcome = { status: 'sent' } | { status: 'skipped'; reason: string };

/**
 * Entrega el correo de los avisos personales encolados por
 * `NotificationDispatcher` en `notification_deliveries` (plan §3.1c, §3.4).
 * Mismo patrón que `WorkflowOutboxDispatcher`: los crons solo corren en el
 * worker (la API los desmonta, ver `unmountScheduledJobs` en main.ts) y el
 * claim es un único `UPDATE … WHERE id IN (… FOR UPDATE SKIP LOCKED)
 * RETURNING`, así dos workers nunca toman la misma fila. Entrega al menos una
 * vez.
 *
 * Antes de enviar vuelve a comprobar todo, porque entre encolar y enviar pudo
 * cambiar: el destinatario sigue siendo personal activo de ESA tienda, tiene
 * correo, su preferencia de Correo sigue encendida y el maestro de tienda no
 * lo apagó. Si algo falla, la fila queda `skipped` con el motivo, sin enviar.
 */
@Injectable()
export class NotificationDeliveriesJob {
  private readonly logger = new Logger(NotificationDeliveriesJob.name);
  private running = false;

  constructor(
    private readonly global_prisma: GlobalPrismaService,
    private readonly recipients: NotificationRecipientsService,
    private readonly preferences: NotificationPreferencesService,
    private readonly email_service: NotificationEmailService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handle(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.drain();
    } catch (error) {
      this.logger.error(
        `Notification deliveries failed: ${(error as Error)?.message}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Lotes seguidos hasta que no quede nada vencido o se gaste el presupuesto. */
  async drain(
    budgetMs = DELIVERY_CYCLE_BUDGET_MS,
    clock: () => number = Date.now,
  ): Promise<number> {
    const startedAt = clock();
    let processed = 0;
    for (;;) {
      const summary = await this.dispatchBatch();
      processed += summary.sent + summary.skipped + summary.retried + summary.failed;
      if (summary.claimed === 0 || clock() - startedAt >= budgetMs) break;
    }
    return processed;
  }

  async dispatchBatch(
    limit = DELIVERY_BATCH,
    now = new Date(),
  ): Promise<DeliverySummary> {
    const buried = await this.buryAbandoned(now);
    const rows = await this.claim(limit);
    const summary: DeliverySummary = {
      claimed: rows.length,
      sent: 0,
      skipped: 0,
      retried: 0,
      failed: buried,
    };
    for (const row of rows) {
      try {
        const outcome = await this.deliver(row);
        await this.finish(row, outcome);
        summary[outcome.status]++;
      } catch (error) {
        summary[await this.fail(row, error, now)]++;
      }
    }
    return summary;
  }

  /**
   * Una fila `pending` con el lease vencido y sin intentos restantes la dejó
   * un worker que murió en su último intento: pasa a `failed` en vez de quedar
   * en la cola para siempre. CAS por fila sobre el estado y el lease.
   */
  private async buryAbandoned(now: Date): Promise<number> {
    const { count } = await this.global_prisma.notification_deliveries.updateMany({
      where: {
        status: 'pending',
        channel: 'email',
        attempts: { gte: DELIVERY_MAX_ATTEMPTS },
        next_attempt_at: { lte: now },
      },
      data: { status: 'failed', error: DELIVERY_ABANDONED_ERROR },
    });
    if (count > 0) {
      this.logger.warn(`${count} e-mail deliveries FAILED: abandoned at their last attempt`);
    }
    return count;
  }

  private async claim(limit: number): Promise<ClaimedDelivery[]> {
    return this.global_prisma.$queryRaw<ClaimedDelivery[]>(
      Prisma.sql`
        UPDATE notification_deliveries SET
          attempts = attempts + 1,
          next_attempt_at = now() + ${Prisma.raw(`interval '${DELIVERY_LEASE_MINUTES} minutes'`)},
          updated_at = now()
        WHERE id IN (
          SELECT id FROM notification_deliveries
          WHERE status = 'pending'
            AND channel = 'email'
            AND next_attempt_at <= now()
            AND attempts < ${Prisma.raw(String(DELIVERY_MAX_ATTEMPTS))}
          ORDER BY next_attempt_at, id
          LIMIT ${limit}::int
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, store_id, user_id, type, payload, attempts`,
    );
  }

  private async deliver(row: ClaimedDelivery): Promise<DeliveryOutcome> {
    const recipient = (
      await this.recipients.classify(row.store_id, [row.user_id])
    ).get(row.user_id);
    if (!recipient || recipient.kind !== 'staff') {
      return { status: 'skipped', reason: 'Recipient is no longer active staff of the store' };
    }
    if (!recipient.email) {
      return { status: 'skipped', reason: 'Recipient has no e-mail' };
    }
    const prefs = await this.preferences.resolveForUsers(row.store_id, [row.user_id], row.type);
    if (!prefs.get(row.user_id)?.email) {
      return { status: 'skipped', reason: 'E-mail preference is off' };
    }
    if (!(await this.email_service.isStoreEmailEnabled(row.store_id))) {
      return { status: 'skipped', reason: 'Store e-mail notifications are disabled' };
    }

    const payload = parsePayload(row.payload);
    const result = await this.email_service.send({
      store_id: row.store_id,
      to: recipient.email,
      first_name: recipient.first_name,
      title: payload.title,
      body: payload.body,
      url: payload.url,
    });
    if (!result.success) {
      throw new Error(result.error || 'E-mail provider rejected the message');
    }
    return { status: 'sent' };
  }

  private async finish(row: ClaimedDelivery, outcome: DeliveryOutcome): Promise<void> {
    const now = new Date();
    await this.global_prisma.notification_deliveries.updateMany({
      where: { id: row.id, status: 'pending' },
      data:
        outcome.status === 'sent'
          ? { status: 'sent', sent_at: now, error: null }
          : { status: 'skipped', error: outcome.reason },
    });
  }

  private async fail(
    row: ClaimedDelivery,
    error: unknown,
    now: Date,
  ): Promise<'retried' | 'failed'> {
    const message = ((error as Error)?.message ?? String(error)).slice(0, 1000);
    const exhausted = row.attempts >= DELIVERY_MAX_ATTEMPTS;
    const delayMin =
      DELIVERY_BACKOFF_MINUTES[
        Math.min(row.attempts, DELIVERY_BACKOFF_MINUTES.length) - 1
      ];
    try {
      await this.global_prisma.notification_deliveries.updateMany({
        where: { id: row.id, status: 'pending' },
        data: exhausted
          ? { status: 'failed', error: message }
          : {
              error: message,
              next_attempt_at: new Date(now.getTime() + delayMin * 60_000),
            },
      });
    } catch (e) {
      // El lease devuelve la fila a la cola aunque esta escritura falle.
      this.logger.error(
        `Delivery ${row.id} outcome not recorded: ${(e as Error)?.message}`,
      );
    }
    this.logger.warn(
      `E-mail delivery ${row.id} attempt ${row.attempts} ${exhausted ? 'FAILED' : 'retry'}: ${message}`,
    );
    return exhausted ? 'failed' : 'retried';
  }
}

function parsePayload(value: Prisma.JsonValue): NotificationDeliveryPayload {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    title: typeof raw.title === 'string' ? raw.title : 'Aviso',
    body: typeof raw.body === 'string' ? raw.body : '',
    url: typeof raw.url === 'string' ? raw.url : null,
  };
}
