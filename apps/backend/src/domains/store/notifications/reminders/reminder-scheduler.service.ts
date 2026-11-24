import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  localCivil,
  zonedWallClockToUtc,
} from '../../../../common/utils/store-timezone.util';
import {
  StoreReminderSettings,
  readStoreReminderSettings,
} from './reminder-settings';

/** Solo se dispara lo que venció hace menos de esto: un deploy nunca inunda. */
export const REMINDER_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** "Sigue vencida": aviso al creador 24 h después de la fecha. */
export const OVERDUE_ESCALATION_DELAY_MS = 24 * 60 * 60 * 1000;

export type DueReminderKind = 'due_soon' | 'due' | 'overdue_escalation';
export const DIGEST_REMINDER_KIND = 'digest';

/**
 * El resumen diario es UNA fila por tienda y día (`source_id` = tienda): lo
 * comparten todas las fuentes de ese tipo y nunca se cancela al cerrar una
 * de ellas; al disparar, si no queda nada que resumir, se salta.
 */
export function digestSourceType(source_type: string): string {
  return `${source_type}_digest`;
}

/** Estado de la fuente: solo `pending` con fecha tiene recordatorios vivos. */
export type ReminderSourceStatus = 'pending' | 'done' | 'cancelled' | 'deleted';

export interface ReminderSyncInput {
  source_type: string;
  source_id: number;
  store_id: number;
  due_at: Date | null;
  status: ReminderSourceStatus;
  /**
   * A quién avisaría hoy cada disparo, solo para PLANIFICAR: sin `notify` no
   * hay "por vencer" ni "vencida"; sin `escalate` no hay escalamiento. Al
   * disparar, el dueño relee la fuente y resuelve los destinatarios de nuevo.
   */
  recipients: { notify: number[]; escalate: number[] };
  /** Además, asegura el resumen diario de la tienda para el día de `due_at`. */
  digest?: boolean;
}

export interface PlannedReminder {
  kind: DueReminderKind;
  fire_at: Date;
}

export interface ReminderSyncResult {
  scheduled: PlannedReminder[];
  cancelled: number;
}

const reminderKey = (kind: string, fire_at: Date) => `${kind}@${fire_at.getTime()}`;

/**
 * Disparos que corresponden a una fuente pendiente con fecha:
 * - `due_soon` en `due_at - task_due_soon_minutes` (D2), solo si aún no pasó;
 * - `due` en `due_at`, salvo que haya vencido hace más de 24 h;
 * - `overdue_escalation` en `due_at + 24 h`, si hay a quién escalar.
 */
export function planDueReminders(
  input: Pick<ReminderSyncInput, 'due_at' | 'recipients'>,
  settings: Pick<StoreReminderSettings, 'due_soon_minutes'>,
  now: Date,
): PlannedReminder[] {
  if (!input.due_at) return [];
  const due = input.due_at.getTime();
  const oldest = now.getTime() - REMINDER_LOOKBACK_MS;
  const planned: PlannedReminder[] = [];
  if (input.recipients.notify.length > 0) {
    const soon = due - settings.due_soon_minutes * 60_000;
    if (soon > now.getTime()) {
      planned.push({ kind: 'due_soon', fire_at: new Date(soon) });
    }
    if (due >= oldest) planned.push({ kind: 'due', fire_at: new Date(due) });
  }
  if (input.recipients.escalate.length > 0) {
    const escalation = due + OVERDUE_ESCALATION_DELAY_MS;
    if (escalation >= oldest) {
      planned.push({ kind: 'overdue_escalation', fire_at: new Date(escalation) });
    }
  }
  return planned;
}

/** Instante UTC del resumen diario del día local de `date` en la tienda. */
export function digestInstantFor(
  date: Date,
  settings: Pick<StoreReminderSettings, 'digest_hour' | 'timezone'>,
): Date {
  const civil = localCivil(date, settings.timezone);
  return zonedWallClockToUtc(
    civil.year,
    civil.month,
    civil.day,
    settings.digest_hour,
    0,
    0,
    0,
    settings.timezone,
  );
}

/**
 * Programa los recordatorios de una fuente con fecha (plan §3.1b) en
 * `scheduled_reminders`. Cada módulo lo llama al crear, editar, cerrar o
 * reabrir lo suyo; es idempotente:
 * - fuente cerrada o sin fecha → cancela sus disparos pendientes;
 * - fecha nueva → cancela los que ya no corresponden y crea los nuevos;
 * - un disparo cancelado o saltado que vuelve a corresponder se re-arma;
 *   uno ya enviado (misma fuente, tipo e instante) no se repite.
 *
 * Usa el cliente global con la tienda explícita: corre igual desde una
 * petición que desde un cron.
 */
@Injectable()
export class ReminderScheduler {
  constructor(private readonly global_prisma: GlobalPrismaService) {}

  async sync(input: ReminderSyncInput, now: Date = new Date()): Promise<ReminderSyncResult> {
    const source = { source_type: input.source_type, source_id: input.source_id };

    if (input.status !== 'pending' || !input.due_at) {
      const { count } = await this.global_prisma.scheduled_reminders.updateMany({
        where: { ...source, status: 'pending' },
        data: { status: 'cancelled' },
      });
      return { scheduled: [], cancelled: count };
    }

    const settings = await readStoreReminderSettings(this.global_prisma, input.store_id);
    const planned = planDueReminders(input, settings, now);
    const wanted = new Set(planned.map((p) => reminderKey(p.kind, p.fire_at)));

    const existing = await this.global_prisma.scheduled_reminders.findMany({
      where: source,
      select: { id: true, kind: true, fire_at: true, status: true },
    });
    const byKey = new Map(existing.map((row) => [reminderKey(row.kind, row.fire_at), row]));

    const stale = existing.filter(
      (row) => row.status === 'pending' && !wanted.has(reminderKey(row.kind, row.fire_at)),
    );
    if (stale.length > 0) {
      await this.global_prisma.scheduled_reminders.updateMany({
        where: { id: { in: stale.map((row) => row.id) }, status: 'pending' },
        data: { status: 'cancelled' },
      });
    }

    const missing = planned.filter((p) => !byKey.has(reminderKey(p.kind, p.fire_at)));
    if (missing.length > 0) {
      await this.global_prisma.scheduled_reminders.createMany({
        data: missing.map((p) => ({
          store_id: input.store_id,
          ...source,
          kind: p.kind,
          fire_at: p.fire_at,
        })),
        skipDuplicates: true,
      });
    }

    const rearm = planned
      .map((p) => byKey.get(reminderKey(p.kind, p.fire_at)))
      .filter((row) => row && (row.status === 'cancelled' || row.status === 'skipped'))
      .map((row) => row!.id);
    if (rearm.length > 0) {
      await this.global_prisma.scheduled_reminders.updateMany({
        where: { id: { in: rearm }, status: { in: ['cancelled', 'skipped'] } },
        data: { status: 'pending', attempts: 0, last_error: null },
      });
    }

    if (input.digest) await this.ensureDigest(input, settings, now);
    return { scheduled: planned, cancelled: stale.length };
  }

  /**
   * Resumen de la mañana del día local de `due_at`, si ese instante aún no
   * pasó (una tarea creada después del resumen no lo vuelve a mandar).
   */
  private async ensureDigest(
    input: ReminderSyncInput,
    settings: StoreReminderSettings,
    now: Date,
  ): Promise<void> {
    if (!input.due_at) return;
    const fire_at = digestInstantFor(input.due_at, settings);
    if (fire_at.getTime() <= now.getTime()) return;
    await this.global_prisma.scheduled_reminders.createMany({
      data: [
        {
          store_id: input.store_id,
          source_type: digestSourceType(input.source_type),
          source_id: input.store_id,
          kind: DIGEST_REMINDER_KIND,
          fire_at,
        },
      ],
      skipDuplicates: true,
    });
  }
}
