import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import {
  localDateString,
  resolveStoreTimezone,
  zonedWallClockToUtc,
} from '../../../common/utils/store-timezone.util';
import { mergeStoreSettingsWithDefaults } from '../settings/defaults/default-store-settings';
import { ScheduledOrdersSettings } from '../settings/interfaces/store-settings.interface';

/** Estados que ocupan cupo. `cancelled` libera la franja. */
export const ACTIVE_FULFILLMENT_STATUSES = [
  'scheduled',
  'in_production',
  'ready',
  'delivered',
  'no_show',
] as const;

/** Rango máximo consultable de una vez (días). */
const MAX_RANGE_DAYS = 62;

export type SlotBlockedReason =
  | 'lead_time'
  | 'too_far'
  | 'slot_full'
  | 'day_full';

export type DayBlockedReason = 'day_blocked';

export interface FulfillmentSlot {
  /** Instantes UTC (ISO). */
  start: string;
  end: string;
  /** "HH:mm" en hora de tienda. */
  local_start: string;
  local_end: string;
  capacity: number;
  taken: number;
  available: boolean;
  blocked_reason: SlotBlockedReason | null;
}

export interface FulfillmentDay {
  /** "YYYY-MM-DD" en hora de tienda. */
  date: string;
  day_of_week: number;
  blocked_reason: DayBlockedReason | null;
  /** Motivo de la excepción, si la hay. */
  exception_reason: string | null;
  day_capacity: number | null;
  day_taken: number;
  slots: FulfillmentSlot[];
}

export interface ScheduleExceptionInput {
  date: Date | string;
  is_closed: boolean;
  start_time: string | null;
  end_time: string | null;
  slot_capacity: number | null;
  day_capacity: number | null;
  reason: string | null;
}

export interface BuildDaysInput {
  config: ScheduledOrdersSettings;
  timezone: string;
  from: string;
  to: string;
  now: Date;
  exceptions: ScheduleExceptionInput[];
  /** Inicio (UTC) de cada pedido que ocupa cupo. */
  taken_starts: Date[];
}

/** Lector mínimo que aceptan tanto el cliente scoped como un `tx` de Prisma. */
export interface SchedulingReader {
  order_fulfillment_schedules: {
    findMany: (args: any) => Promise<Array<{ scheduled_start: Date }>>;
  };
  fulfillment_schedule_exceptions: {
    findMany: (args: any) => Promise<ScheduleExceptionInput[]>;
  };
}

function parseDate(value: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new VendixHttpException(ErrorCodes.SCHED_INVALID_RANGE);
  return { y: +match[1], m: +match[2], d: +match[3] };
}

function addDays(value: string, days: number): string {
  const { y, m, d } = parseDate(value);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round(
    (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000,
  );
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function exceptionDateKey(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/**
 * Núcleo puro: genera los días y franjas del rango con su cupo. Sin I/O para
 * poder probar franja llena, anticipación, excepción y zona horaria aislados.
 */
export function buildFulfillmentDays(input: BuildDaysInput): FulfillmentDay[] {
  const { config, timezone, from, to, now, exceptions, taken_starts } = input;
  const exceptionsByDate = new Map(
    exceptions.map((e) => [exceptionDateKey(e.date), e]),
  );

  const takenBySlot = new Map<number, number>();
  const takenByDay = new Map<string, number>();
  for (const start of taken_starts) {
    takenBySlot.set(start.getTime(), (takenBySlot.get(start.getTime()) ?? 0) + 1);
    const day = localDateString(start, timezone);
    takenByDay.set(day, (takenByDay.get(day) ?? 0) + 1);
  }

  const earliest = now.getTime() + config.min_lead_time_hours * 3_600_000;
  const lastAllowedDay = addDays(localDateString(now, timezone), config.max_days_ahead);
  const duration = config.slot_duration_minutes;
  const days: FulfillmentDay[] = [];

  for (let date = from; daysBetween(date, to) >= 0; date = addDays(date, 1)) {
    const { y, m, d } = parseDate(date);
    const day_of_week = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const exception = exceptionsByDate.get(date);

    let blocks: Array<{ start_time: string; end_time: string }>;
    if (exception?.is_closed) {
      blocks = [];
    } else if (exception?.start_time && exception?.end_time) {
      blocks = [{ start_time: exception.start_time, end_time: exception.end_time }];
    } else {
      blocks = config.weekly_schedule.filter((b) => b.day_of_week === day_of_week);
    }

    const slot_capacity = exception?.slot_capacity ?? config.slot_capacity;
    const day_capacity = exception?.day_capacity ?? config.day_capacity ?? null;
    const day_taken = takenByDay.get(date) ?? 0;
    const tooFar = daysBetween(lastAllowedDay, date) > 0;

    const slots: FulfillmentSlot[] = [];
    for (const block of blocks) {
      const blockEnd = toMinutes(block.end_time);
      for (let s = toMinutes(block.start_time); s + duration <= blockEnd; s += duration) {
        const start = zonedWallClockToUtc(y, m, d, Math.floor(s / 60), s % 60, 0, 0, timezone);
        const end = new Date(start.getTime() + duration * 60_000);
        const taken = takenBySlot.get(start.getTime()) ?? 0;

        let blocked_reason: SlotBlockedReason | null = null;
        if (start.getTime() < earliest) blocked_reason = 'lead_time';
        else if (tooFar) blocked_reason = 'too_far';
        else if (taken >= slot_capacity) blocked_reason = 'slot_full';
        else if (day_capacity !== null && day_taken >= day_capacity) blocked_reason = 'day_full';

        slots.push({
          start: start.toISOString(),
          end: end.toISOString(),
          local_start: fromMinutes(s),
          local_end: fromMinutes(s + duration),
          capacity: slot_capacity,
          taken,
          available: blocked_reason === null,
          blocked_reason,
        });
      }
    }

    days.push({
      date,
      day_of_week,
      blocked_reason: slots.length === 0 ? 'day_blocked' : null,
      exception_reason: exception?.reason ?? null,
      day_capacity,
      day_taken,
      slots,
    });
  }

  return days;
}

/**
 * Disponibilidad de la agenda de cumplimiento. Un solo servicio para POS,
 * tienda en línea y agenda: copia el patrón de `reservations/availability`,
 * no lo importa.
 */
@Injectable()
export class FulfillmentAvailabilityService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getConfig(store_id: number): Promise<ScheduledOrdersSettings> {
    const row = await this.prisma.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    return mergeStoreSettingsWithDefaults(row?.settings).scheduled_orders as ScheduledOrdersSettings;
  }

  /** Lanza `SCHED_DISABLED` si la tienda no activó los pedidos programados. */
  async getEnabledConfig(store_id: number): Promise<ScheduledOrdersSettings> {
    const config = await this.getConfig(store_id);
    if (!config?.enabled) throw new VendixHttpException(ErrorCodes.SCHED_DISABLED);
    return config;
  }

  async getAvailability(
    store_id: number,
    from: string,
    to: string,
    options: { now?: Date; exclude_schedule_id?: number; client?: SchedulingReader } = {},
  ): Promise<FulfillmentDay[]> {
    parseDate(from);
    parseDate(to);
    const span = daysBetween(from, to);
    if (span < 0 || span > MAX_RANGE_DAYS) {
      throw new VendixHttpException(ErrorCodes.SCHED_INVALID_RANGE);
    }

    const config = await this.getEnabledConfig(store_id);
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const now = options.now ?? new Date();
    const client = options.client ?? (this.prisma as unknown as SchedulingReader);

    const a = parseDate(from);
    const b = parseDate(addDays(to, 1));
    const rangeStart = zonedWallClockToUtc(a.y, a.m, a.d, 0, 0, 0, 0, timezone);
    const rangeEnd = zonedWallClockToUtc(b.y, b.m, b.d, 0, 0, 0, 0, timezone);

    const [exceptions, taken] = await Promise.all([
      client.fulfillment_schedule_exceptions.findMany({
        where: {
          store_id,
          date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
        },
      }),
      client.order_fulfillment_schedules.findMany({
        where: {
          store_id,
          status: { in: [...ACTIVE_FULFILLMENT_STATUSES] },
          scheduled_start: { gte: rangeStart, lt: rangeEnd },
          ...(options.exclude_schedule_id ? { id: { not: options.exclude_schedule_id } } : {}),
          // Un hold vencido de la tienda en línea ya no sostiene la franja.
          OR: [{ hold_expires_at: null }, { hold_expires_at: { gt: now } }],
        },
        select: { scheduled_start: true },
      }),
    ]);

    return buildFulfillmentDays({
      config,
      timezone,
      from,
      to,
      now,
      exceptions,
      taken_starts: taken.map((t) => t.scheduled_start),
    });
  }

  /**
   * Valida en el servidor que la franja [start, end) existe y tiene cupo.
   * Llamar dentro de la transacción que crea o mueve el agendamiento, después
   * de tomar el bloqueo de la tienda.
   */
  async assertSlotAvailable(
    store_id: number,
    start: Date,
    end: Date,
    options: { now?: Date; exclude_schedule_id?: number; client?: SchedulingReader } = {},
  ): Promise<FulfillmentSlot> {
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const date = localDateString(start, timezone);
    const [day] = await this.getAvailability(store_id, date, date, options);
    const config = await this.getConfig(store_id);

    if (!day || day.blocked_reason === 'day_blocked') {
      throw new VendixHttpException(ErrorCodes.SCHED_DAY_BLOCKED);
    }
    const slot = day.slots.find(
      (s) => s.start === start.toISOString() && s.end === end.toISOString(),
    );
    if (!slot) throw new VendixHttpException(ErrorCodes.SCHED_OUT_OF_HOURS);

    switch (slot.blocked_reason) {
      case 'lead_time':
        throw new VendixHttpException(
          ErrorCodes.SCHED_LEAD_TIME,
          `Este pedido requiere al menos ${config.min_lead_time_hours} horas de anticipación.`,
        );
      case 'too_far':
        throw new VendixHttpException(ErrorCodes.SCHED_TOO_FAR);
      case 'slot_full':
      case 'day_full':
        throw new VendixHttpException(ErrorCodes.SCHED_SLOT_FULL);
      default:
        return slot;
    }
  }
}
