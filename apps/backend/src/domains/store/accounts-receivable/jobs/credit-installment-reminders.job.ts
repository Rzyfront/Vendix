import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { localCivil, resolveTimezoneCascade } from '../../../../common/utils/store-timezone.util';
import { mergeStoreSettingsWithDefaults } from '../../settings/defaults/default-store-settings';

/**
 * Hora local de la tienda desde la que se envían los avisos del día. El cron
 * corre cada hora; antes de esta hora la tienda se salta (nadie recibe un
 * correo de cobro a medianoche) y el log evita repetir después.
 */
export const CREDIT_REMINDER_SEND_HOUR = 8;

/** Solo cuotas con saldo vivo reciben aviso (pagadas/condonadas/anuladas no). */
const REMINDABLE_STATES = ['pending', 'partial'] as const;

export type CreditReminderChannel = 'staff' | 'customer';

/** Payload de `credit_installment.reminder` (una emisión por canal). */
export interface CreditInstallmentReminderEvent {
  store_id: number;
  store_name: string;
  installment_id: number;
  installment_number: number;
  installments_total: number;
  order_id: number;
  order_number: string;
  channel: CreditReminderChannel;
  days_before: number;
  /** `YYYY-MM-DD` (fecha civil, sin zona). */
  due_date: string;
  amount: number;
  installment_balance: number;
  credit_balance: number;
  customer_name: string | null;
  customer_email: string | null;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` de (hoy local + días). Aritmética en UTC sobre la fecha civil. */
export function addDaysToCivilDate(year: number, month: number, day: number, days: number): string {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Recordatorios de cuotas de venta a crédito. Cada hora, por tienda activa con
 * `credit_reminders.enabled` y ya pasada la hora de envío local, y por regla
 * habilitada, busca cuotas pendientes/parciales de órdenes a crédito
 * (`payment_form = '2'`) no canceladas cuyo vencimiento es hoy local +
 * `days_before`, y emite `credit_installment.reminder` UNA sola vez por regla
 * y canal: el log tiene índice único (installment_id, rule_key, channel).
 */
@Injectable()
export class CreditInstallmentRemindersJob {
  private readonly logger = new Logger(CreditInstallmentRemindersJob.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron('0 * * * *')
  async handle() {
    try {
      const sent = await this.run(new Date());
      if (sent > 0) this.logger.log(`Recordatorios de cuotas a crédito enviados: ${sent}`);
    } catch (error) {
      this.logger.error('Error en recordatorios de cuotas a crédito', error as Error);
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
      const settings = mergeStoreSettingsWithDefaults(row.settings).credit_reminders;
      if (!settings?.enabled) continue;
      const timezone = resolveTimezoneCascade(
        row.stores?.timezone,
        (row.settings as { general?: { timezone?: string | null } } | null)?.general?.timezone,
      );
      const today = localCivil(now, timezone);
      if (today.hour < CREDIT_REMINDER_SEND_HOUR) continue;

      for (const rule of settings.reminders ?? []) {
        if (!rule.enabled || !(rule.days_before >= 0)) continue;
        const channels: CreditReminderChannel[] = [
          ...(rule.notify_staff ? (['staff'] as const) : []),
          ...(rule.notify_customer ? (['customer'] as const) : []),
        ];
        if (!channels.length) continue;

        const dueDate = addDaysToCivilDate(today.year, today.month, today.day, rule.days_before);
        const installments = await db.order_installments.findMany({
          where: {
            state: { in: [...REMINDABLE_STATES] },
            // `@db.Date`: Prisma lo materializa como medianoche UTC.
            due_date: new Date(`${dueDate}T00:00:00.000Z`),
            orders: {
              store_id: row.store_id,
              payment_form: '2',
              state: { not: 'cancelled' },
            },
          },
          include: {
            orders: {
              select: {
                id: true,
                order_number: true,
                remaining_balance: true,
                users: { select: { first_name: true, last_name: true, email: true } },
                order_installments: {
                  where: { state: { not: 'cancelled' } },
                  select: { id: true },
                },
              },
            },
          },
        });

        for (const inst of installments) {
          const order = inst.orders;
          const customer = order.users;
          for (const channel of channels) {
            if (channel === 'customer' && !customer?.email) continue;
            // Dedupe atómico por el índice único: si ya existe, count = 0.
            const created = await db.credit_installment_reminder_logs.createMany({
              data: [
                {
                  store_id: row.store_id,
                  installment_id: inst.id,
                  rule_key: `${rule.days_before}d`,
                  channel: channel === 'staff' ? 'bell' : 'email',
                },
              ],
              skipDuplicates: true,
            });
            if (created.count === 0) continue;

            const event: CreditInstallmentReminderEvent = {
              store_id: row.store_id,
              store_name: row.stores?.name ?? '',
              installment_id: inst.id,
              installment_number: inst.installment_number,
              installments_total: order.order_installments.length,
              order_id: order.id,
              order_number: order.order_number,
              channel,
              days_before: rule.days_before,
              due_date: dueDate,
              amount: Number(inst.amount),
              installment_balance: Number(inst.remaining_balance),
              credit_balance: Math.max(Number(order.remaining_balance ?? 0), 0),
              customer_name: customer
                ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || null
                : null,
              customer_email: customer?.email ?? null,
            };
            this.eventEmitter.emit('credit_installment.reminder', event);
            sent++;
          }
        }
      }
    }
    return sent;
  }
}
