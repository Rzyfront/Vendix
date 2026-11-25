import { zonedWallClockToUtc } from '@common/utils/store-timezone.util';

/** QUI-1060 F3: con un tercero, la tarea es confirmar con él 48 h antes de la actividad. */
export const SUPPLIER_CONFIRM_LEAD_MS = 48 * 60 * 60 * 1000;

/** Línea de la descripción que lleva la fecha: se reescribe al cambiar las fechas de la reserva. */
const DATE_LINE_PREFIX = 'Fecha de la actividad: ';

export type PlanTaskKind = 'internal' | 'supplier' | 'none';

/** `YYYY-MM-DD` del día N del plan (día 1 = fecha de inicio de la reserva). */
export function activityDate(startDate: string, dayNumber: number): string {
  const [y, m, d] = startDate.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + Math.max(dayNumber, 1) - 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Instante real de la actividad: su día a su hora (`HH:mm`) en la zona de la tienda;
 * sin hora, el inicio de ese día.
 */
export function activityStartsAt(
  startDate: string,
  dayNumber: number,
  startTime: string | null,
  tz: string,
): Date {
  const [y, m, d] = activityDate(startDate, dayNumber).split('-').map(Number);
  const match = /^(\d{2}):(\d{2})/.exec(startTime ?? '');
  const hour = match ? Number(match[1]) : 0;
  const minute = match ? Number(match[2]) : 0;
  return zonedWallClockToUtc(y, m, d, hour, minute, 0, 0, tz);
}

/** Vencimiento de la tarea: la actividad misma, o 48 h antes con un tercero (nunca en el pasado). */
export function planTaskDueAt(kind: PlanTaskKind, startsAt: Date, now: Date): Date {
  if (kind !== 'supplier') return startsAt;
  const due = new Date(startsAt.getTime() - SUPPLIER_CONFIRM_LEAD_MS);
  return due.getTime() < now.getTime() ? now : due;
}

export function planTaskKind(activity: {
  provider_id: number | null;
  supplier_id?: number | null;
  supplier_name: string | null;
}): PlanTaskKind {
  if (activity.provider_id != null) return 'internal';
  if (activity.supplier_id != null || activity.supplier_name) return 'supplier';
  return 'none';
}

/** `DD/MM/YYYY` de una fecha `YYYY-MM-DD`, sin pasar por zonas horarias. */
export function formatPlanDate(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function dateLine(date: string, startTime: string | null): string {
  return `${DATE_LINE_PREFIX}${formatPlanDate(date)}${startTime ? ` ${startTime.slice(0, 5)}` : ' (sin hora)'}`;
}

export interface PlanTaskContentInput {
  kind: PlanTaskKind;
  activityTitle: string;
  dayNumber: number;
  date: string;
  startTime: string | null;
  planName: string;
  bookingNumber: string;
  supplierName?: string | null;
  supplierContact?: string | null;
  /** Interno cuyo prestador no tiene usuario en Vendix (legacy `employee_id`). */
  providerName?: string | null;
  providerWithoutUser?: boolean;
}

/** Título (≤ 200) y descripción de la tarea CRM de una actividad. */
export function buildPlanTaskContent(input: PlanTaskContentInput): { title: string; description: string } {
  const title =
    input.kind === 'supplier'
      ? `Confirmar con proveedor: ${input.supplierName?.trim() || 'Proveedor'} · ${input.activityTitle}`
      : input.activityTitle;
  const lines = [
    `Plan: ${input.planName} · reserva ${input.bookingNumber}`,
    `Actividad: día ${input.dayNumber} · ${input.activityTitle}`,
    dateLine(input.date, input.startTime),
  ];
  if (input.kind === 'supplier') {
    lines.push(`Proveedor: ${input.supplierName?.trim() || 'Proveedor'}`);
    lines.push(`Contacto: ${input.supplierContact?.trim() || 'sin contacto registrado'}`);
  } else if (input.kind === 'internal' && input.providerWithoutUser) {
    lines.push(
      `Responsable: ${input.providerName?.trim() || 'el prestador'} no tiene usuario en Vendix; la tarea queda sin asignar.`,
    );
  } else if (input.kind === 'internal' && input.providerName) {
    lines.push(`Responsable: ${input.providerName.trim()}`);
  } else if (input.kind === 'none') {
    lines.push('La actividad no tiene responsable definido en el itinerario.');
  }
  return { title: title.slice(0, 200), description: lines.join('\n') };
}

/** Reescribe la línea de fecha de una descripción generada; null si no la encuentra. */
export function replacePlanTaskDateLine(
  description: string | null,
  date: string,
  startTime: string | null,
): string | null {
  if (!description) return null;
  const lines = description.split('\n');
  const index = lines.findIndex((l) => l.startsWith(DATE_LINE_PREFIX));
  if (index < 0) return null;
  lines[index] = dateLine(date, startTime);
  return lines.join('\n');
}

/** Contacto de un proveedor registrado en una línea: persona · celular/teléfono · correo. */
export function supplierContactLine(s: {
  contact_person?: string | null;
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
}): string | null {
  const parts = [s.contact_person, s.mobile || s.phone, s.email]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(' · ').slice(0, 200) : null;
}
