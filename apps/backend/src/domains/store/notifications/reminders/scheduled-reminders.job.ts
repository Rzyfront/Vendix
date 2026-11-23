import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { NotificationDispatcher } from '../notification-dispatcher.service';
import { REMINDER_LOOKBACK_MS } from './reminder-scheduler.service';
import {
  ClaimedReminder,
  ReminderResolution,
  ReminderSourceRegistry,
} from './reminder-source.registry';

export const REMINDER_BATCH = 100;
/** Intentos por recordatorio ante errores (relectura, despacho). */
export const REMINDER_MAX_ATTEMPTS = 3;
/** Mientras un worker procesa una fila, nadie más la toma; si muere, vuelve. */
export const REMINDER_LEASE_MINUTES = 10;

export interface ScheduledRemindersRun {
  sent: number;
  skipped: number;
  retried: number;
  expired: number;
}

type ProcessOutcome = 'sent' | 'skipped' | 'retried';

/**
 * Motor de recordatorios (plan §3.1b). Cada minuto, solo en el worker (la API
 * desmonta los `@Cron` en `main.ts`):
 *
 * 1. Lo pendiente que venció hace más de 24 h se marca `skipped`: un deploy o
 *    una caída larga nunca sueltan una avalancha de avisos viejos.
 * 2. Reclama lo vencido (`fire_at <= now`) con un único
 *    `UPDATE … WHERE id IN (… FOR UPDATE SKIP LOCKED) RETURNING` y un lease
 *    sobre `updated_at`: dos workers nunca toman la misma fila.
 * 3. Por cada fila, el dueño de la fuente la relee (`ReminderSourceRegistry`):
 *    si ya está resuelta o cambió la fecha queda `skipped`; si no, sus avisos
 *    salen por `NotificationDispatcher` con `dedupe_key` estable.
 *
 * Corre sin contexto de tienda: cada fila nombra su tienda.
 */
@Injectable()
export class ScheduledRemindersJob {
  private readonly logger = new Logger(ScheduledRemindersJob.name);
  private running = false;

  constructor(
    private readonly global_prisma: GlobalPrismaService,
    private readonly registry: ReminderSourceRegistry,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run(new Date());
    } catch (error) {
      this.logger.error(`Scheduled reminders failed: ${(error as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }

  async run(now: Date): Promise<ScheduledRemindersRun> {
    const result: ScheduledRemindersRun = { sent: 0, skipped: 0, retried: 0, expired: 0 };
    result.expired = await this.expireMissed(now);
    await this.buryAbandoned(now);

    const claimed = await this.claim(now);
    for (const row of claimed) {
      result[await this.process(row, now)]++;
    }
    return result;
  }

  private async expireMissed(now: Date): Promise<number> {
    const { count } = await this.global_prisma.scheduled_reminders.updateMany({
      where: {
        status: 'pending',
        fire_at: { lt: new Date(now.getTime() - REMINDER_LOOKBACK_MS) },
      },
      data: { status: 'skipped', last_error: 'Missed the 24 h delivery window' },
    });
    if (count > 0) this.logger.warn(`${count} reminders older than 24 h skipped`);
    return count;
  }

  /** Un worker murió procesando el último intento: no vuelve a la cola. */
  private async buryAbandoned(now: Date): Promise<void> {
    await this.global_prisma.scheduled_reminders.updateMany({
      where: {
        status: 'pending',
        attempts: { gte: REMINDER_MAX_ATTEMPTS },
        updated_at: { lte: new Date(now.getTime() - REMINDER_LEASE_MINUTES * 60_000) },
      },
      data: { status: 'skipped', last_error: `Gave up after ${REMINDER_MAX_ATTEMPTS} attempts` },
    });
  }

  private async claim(now: Date): Promise<ClaimedReminder[]> {
    // `fire_at`/`updated_at` son `timestamp` sin zona en UTC: los instantes se
    // pasan en ISO y se bajan a UTC, sin depender de la zona de la sesión.
    const at = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
    const oldest = new Date(now.getTime() - REMINDER_LOOKBACK_MS);
    const leaseCutoff = new Date(now.getTime() - REMINDER_LEASE_MINUTES * 60_000);
    return this.global_prisma.$queryRaw<ClaimedReminder[]>(
      Prisma.sql`
        UPDATE scheduled_reminders SET
          attempts = attempts + 1,
          updated_at = ${at(now)}
        WHERE id IN (
          SELECT id FROM scheduled_reminders
          WHERE status = 'pending'
            AND fire_at <= ${at(now)}
            AND fire_at >= ${at(oldest)}
            AND attempts < ${REMINDER_MAX_ATTEMPTS}::int
            AND (attempts = 0 OR updated_at <= ${at(leaseCutoff)})
          ORDER BY fire_at, id
          LIMIT ${REMINDER_BATCH}::int
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, store_id, source_type, source_id, kind, fire_at, attempts`,
    );
  }

  private async process(row: ClaimedReminder, now: Date): Promise<ProcessOutcome> {
    const handler = this.registry.get(row.source_type);
    if (!handler) {
      await this.finish(row, { action: 'skip', reason: `No handler for ${row.source_type}` });
      return 'skipped';
    }
    let resolution: ReminderResolution;
    try {
      resolution = await handler.resolve(row, now);
      // Como mucho una vez: la fila queda `sent` ANTES de despachar. Si esa
      // escritura falla, se reintenta sin haber avisado; si `sync` la canceló
      // mientras tanto (0 filas), no se avisa.
      const closed = await this.finish(row, resolution);
      if (resolution.action !== 'notify') return 'skipped';
      if (!closed) return 'skipped';
    } catch (error) {
      return this.fail(row, error);
    }
    try {
      for (const notification of resolution.notifications) {
        await this.dispatcher.notify(notification);
      }
    } catch (error) {
      // Ya está `sent`: reintentar duplicaría campana y push.
      this.logger.error(
        `Reminder ${row.id} dispatch failed after being marked sent: ${(error as Error)?.message ?? String(error)}`,
      );
    }
    return 'sent';
  }

  /** Cierra la fila; answers false when it was no longer pending. */
  private async finish(row: ClaimedReminder, resolution: ReminderResolution): Promise<boolean> {
    // Solo si sigue pendiente: si `sync` la canceló mientras tanto, gana eso.
    const { count } = await this.global_prisma.scheduled_reminders.updateMany({
      where: { id: row.id, status: 'pending' },
      data:
        resolution.action === 'notify'
          ? { status: 'sent', last_error: null }
          : { status: 'skipped', last_error: resolution.reason.slice(0, 1000) },
    });
    return count === 1;
  }

  private async fail(row: ClaimedReminder, error: unknown): Promise<ProcessOutcome> {
    const message = ((error as Error)?.message ?? String(error)).slice(0, 1000);
    const exhausted = row.attempts >= REMINDER_MAX_ATTEMPTS;
    try {
      await this.global_prisma.scheduled_reminders.updateMany({
        where: { id: row.id, status: 'pending' },
        data: exhausted ? { status: 'skipped', last_error: message } : { last_error: message },
      });
    } catch (e) {
      // El lease la devuelve a la cola aunque esta escritura falle.
      this.logger.error(`Reminder ${row.id} outcome not recorded: ${(e as Error)?.message}`);
    }
    this.logger.warn(
      `Reminder ${row.id} (${row.source_type}:${row.source_id} ${row.kind}) attempt ${row.attempts} ${
        exhausted ? 'GAVE UP' : 'will retry'
      }: ${message}`,
    );
    return exhausted ? 'skipped' : 'retried';
  }
}
