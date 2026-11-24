import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { dateOnlyString } from '../../../../common/utils/store-timezone.util';
import {
  ClockWindow,
  Span,
  coverageForDate,
  intersectSpans,
  windowSpan,
} from '../../../../common/utils/schedule-window.util';
import { BusinessHoursService } from '../../reservations/business-hours/business-hours.service';

/**
 * Disponibilidad del prestador en la Agenda (agenda-unificada F1, requisito
 * de prestadores). Mismas reglas que Reservas (`availability.service.ts`,
 * `provider-availability.service.ts`): los bloques semanales activos de
 * `provider_schedules` (0 = domingo) definen el horario; una excepción del
 * día con `is_unavailable` lo bloquea entero, y si no, sus horas propias
 * reemplazan las del bloque. Igual que al generar franjas de reserva
 * (`availability.service.ts:291,317`), el resultado se recorta con el horario
 * del negocio: fuera de él no hay disponibilidad.
 */
export interface ProviderDayAvailability {
  staff_id: number;
  date: string;
  /** Franjas disponibles `HH:mm` (vacío = no trabaja ese día). */
  windows: { start: string; end: string }[];
  /** Día bloqueado por una excepción (vacaciones, permiso…). */
  unavailable: boolean;
  /** Motivo de la excepción, si la hay. */
  reason: string | null;
}

/** Tope de prestadores filtrados: el mismo que admite el filtro (`staff_ids`). */
export const AVAILABILITY_MAX_STAFF = 50;

interface ScheduleRow {
  provider_id: number;
  day_of_week: number;
  block_order: number;
  start_time: string;
  end_time: string;
}

interface ExceptionRow {
  provider_id: number;
  date: Date;
  is_unavailable: boolean;
  custom_start_time: string | null;
  custom_end_time: string | null;
  reason: string | null;
}

function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  const last = to;
  for (let ymd = from; ymd <= last; ) {
    out.push(ymd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    ymd = cursor.toISOString().slice(0, 10);
  }
  return out;
}

function clock(minutes: number): string {
  const m = Math.max(0, Math.min(minutes, 1440));
  if (m === 1440) return '24:00';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Recorta una franja `HH:mm` con la cobertura del negocio de ese día (lo que
 * pasa de medianoche se corta en 24:00, como en la rejilla).
 */
export function clipToStoreHours(
  window: { start: string; end: string },
  coverage: readonly Span[],
): { start: string; end: string }[] {
  const span = windowSpan({ start_time: window.start, end_time: window.end });
  return intersectSpans(span, [...coverage])
    .map((s) => ({ startMin: s.startMin, endMin: Math.min(s.endMin, 1440) }))
    .filter((s) => s.endMin > s.startMin && s.startMin < 1440)
    .map((s) => ({ start: clock(s.startMin), end: clock(s.endMin) }));
}

/**
 * Disponibilidad de un prestador en un día. Pura. `coverage` = horario del
 * negocio ese día (`coverageForDate`); sin él no se recorta.
 */
export function providerDayAvailability(
  staff_id: number,
  date: string,
  schedules: readonly ScheduleRow[],
  exception: ExceptionRow | undefined,
  coverage?: readonly Span[],
): ProviderDayAvailability {
  const [y, m, d] = date.split('-').map(Number);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const reason = exception?.reason ?? null;
  if (exception?.is_unavailable) {
    return { staff_id, date, windows: [], unavailable: true, reason };
  }
  const windows = schedules
    .filter((s) => s.provider_id === staff_id && s.day_of_week === dayOfWeek)
    .sort((a, b) => a.block_order - b.block_order)
    .map((s) => ({
      start: exception?.custom_start_time || s.start_time,
      end: exception?.custom_end_time || s.end_time,
    }))
    .flatMap((w) => (coverage ? clipToStoreHours(w, coverage) : [w]));
  return { staff_id, date, windows, unavailable: false, reason };
}

/**
 * Disponibilidad de los prestadores filtrados en el rango: dos lecturas
 * (bloques y excepciones) para todos, sin N+1. El Prisma de tienda acota a la
 * tienda vía `provider` (los ids ajenos no devuelven filas).
 */
export async function loadProviderAvailability(
  prisma: StorePrismaService,
  businessHours: Pick<BusinessHoursService, 'loadStoreHours'>,
  store_id: number,
  staffIds: readonly number[],
  from: string,
  to: string,
): Promise<ProviderDayAvailability[]> {
  const ids = [...new Set(staffIds)].slice(0, AVAILABILITY_MAX_STAFF);
  if (!ids.length) return [];
  const owned = await prisma.service_providers.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const ownedIds = owned.map((p) => p.id);
  if (!ownedIds.length) return [];
  const [schedules, exceptions, storeHours] = await Promise.all([
    prisma.provider_schedules.findMany({
      where: { provider_id: { in: ownedIds }, is_active: true },
      select: {
        provider_id: true,
        day_of_week: true,
        block_order: true,
        start_time: true,
        end_time: true,
      },
    }),
    prisma.provider_exceptions.findMany({
      where: {
        provider_id: { in: ownedIds },
        date: { gte: new Date(from), lte: new Date(to) },
      },
      select: {
        provider_id: true,
        date: true,
        is_unavailable: true,
        custom_start_time: true,
        custom_end_time: true,
        reason: true,
      },
    }),
    // Mismo horario maestro que usa la reserva (`settings.pos.business_hours`
    // o la tabla vieja). Sin horario configurado la reserva no ofrece franjas.
    businessHours.loadStoreHours(store_id, prisma),
  ]);
  const exceptionOf = new Map<string, ExceptionRow>();
  for (const e of exceptions as ExceptionRow[]) {
    exceptionOf.set(`${e.provider_id}:${dateOnlyString(e.date)}`, e);
  }
  const days = enumerateDays(from, to);
  const coverageOf = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return coverageForDate(storeHours as Map<number, ClockWindow[]>, new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  };
  return ownedIds.flatMap((id) =>
    days.map((date) =>
      providerDayAvailability(
        id,
        date,
        schedules as ScheduleRow[],
        exceptionOf.get(`${id}:${date}`),
        coverageOf(date),
      ),
    ),
  );
}
