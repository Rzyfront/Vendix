import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { localCivil, resolveTimezoneCascade } from '../../../../common/utils/store-timezone.util';
import { mergeStoreSettingsWithDefaults } from '../../settings/defaults/default-store-settings';

/** Ventana de búsqueda: el cron corre cada 5 min; 10 min cubre un ciclo perdido. */
export const REMINDER_WINDOW_MS = 10 * 60 * 1000;

/** Solo pedidos aún por entregar reciben recordatorio. */
const REMINDABLE_STATUSES = ['scheduled', 'in_production', 'ready'] as const;

export type ReminderChannel = 'staff' | 'customer';

/** Payload de `scheduled_order.reminder` (una emisión por canal). */
export interface ScheduledOrderReminderEvent {
  store_id: number;
  store_name: string;
  schedule_id: number;
  order_id: number;
  order_number: string;
  channel: ReminderChannel;
  minutes_before: number;
  customer_name: string | null;
  customer_email: string | null;
  fulfillment_type: string;
  local_date: string;
  local_start: string;
  local_end: string;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/**
 * Recordatorios de pedidos programados (S5). Cada 5 min, por tienda con el
 * ajuste activo y por regla habilitada, busca agendamientos activos cuya
 * franja empieza dentro de `minutes_before` (ventana de 10 min) y emite
 * `scheduled_order.reminder` UNA sola vez por regla y canal: el log tiene
 * índice único (schedule_id, rule_key, channel).
 */
@Injectable()
export class ScheduledOrderRemindersJob {
  private readonly logger = new Logger(ScheduledOrderRemindersJob.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron('*/5 * * * *')
  async handle() {
    try {
      const sent = await this.run(new Date());
      if (sent > 0) this.logger.log(`Recordatorios de pedidos programados enviados: ${sent}`);
    } catch (error) {
      this.logger.error('Error en recordatorios de pedidos programados', error as Error);
    }
  }

  /** Devuelve cuántos recordatorios (por canal) se emitieron. */
  async run(now: Date): Promise<number> {
    const db = this.prisma.withoutScope();
    const rows = await db.store_settings.findMany({
      where: { stores: { is_active: true } },
      select: { store_id: true, settings: true, stores: { select: { name: true, timezone: true } } },
    });

    let sent = 0;
    for (const row of rows) {
      const settings = mergeStoreSettingsWithDefaults(row.settings).scheduled_orders;
      if (!settings?.enabled) continue;
      const timezone = resolveTimezoneCascade(
        row.stores?.timezone,
        (row.settings as { general?: { timezone?: string | null } } | null)?.general?.timezone,
      );

      for (const rule of settings.reminders ?? []) {
        if (!rule.enabled || !(rule.minutes_before > 0)) continue;
        const channels: ReminderChannel[] = [
          ...(rule.notify_staff ? (['staff'] as const) : []),
          ...(rule.notify_customer ? (['customer'] as const) : []),
        ];
        if (!channels.length) continue;

        const target = now.getTime() + rule.minutes_before * 60 * 1000;
        const schedules = await db.order_fulfillment_schedules.findMany({
          where: {
            store_id: row.store_id,
            status: { in: [...REMINDABLE_STATUSES] },
            scheduled_start: { gt: new Date(target - REMINDER_WINDOW_MS), lte: new Date(target) },
          },
          include: {
            order: {
              select: {
                id: true,
                order_number: true,
                users: { select: { first_name: true, last_name: true, email: true } },
              },
            },
          },
        });

        for (const schedule of schedules) {
          const customer = schedule.order.users;
          for (const channel of channels) {
            if (channel === 'customer' && !customer?.email) continue;
            // Dedupe atómico por el índice único: si ya existe, count = 0.
            const created = await db.scheduled_order_reminder_logs.createMany({
              data: [
                {
                  store_id: row.store_id,
                  schedule_id: schedule.id,
                  rule_key: `${rule.minutes_before}m`,
                  channel: channel === 'staff' ? 'bell' : 'email',
                },
              ],
              skipDuplicates: true,
            });
            if (created.count === 0) continue;

            const s = localCivil(schedule.scheduled_start, timezone);
            const e = localCivil(schedule.scheduled_end, timezone);
            const event: ScheduledOrderReminderEvent = {
              store_id: row.store_id,
              store_name: row.stores?.name ?? '',
              schedule_id: schedule.id,
              order_id: schedule.order.id,
              order_number: schedule.order.order_number,
              channel,
              minutes_before: rule.minutes_before,
              customer_name: customer
                ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || null
                : null,
              customer_email: customer?.email ?? null,
              fulfillment_type: schedule.fulfillment_type,
              local_date: `${s.year}-${pad(s.month)}-${pad(s.day)}`,
              local_start: `${pad(s.hour)}:${pad(s.minute)}`,
              local_end: `${pad(e.hour)}:${pad(e.minute)}`,
            };
            this.eventEmitter.emit('scheduled_order.reminder', event);
            sent++;
          }
        }
      }
    }
    return sent;
  }
}
