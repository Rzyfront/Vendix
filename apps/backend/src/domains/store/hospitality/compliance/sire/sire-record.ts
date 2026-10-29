import { HOME_COUNTRY_CODE, reportsSire } from '../../reservations/guests/lodging-guest-rules';

/**
 * Hospitality Suite (H4.2) — the SIRE record of one foreign guest (Migración
 * Colombia, "Planilla de viajeros"): movement (entry / exit) and its date,
 * document, nationality, surnames split in two, names, birth date, origin and
 * residence. Pure, so the list, the copyable sheet, the export file and the
 * tests read the same fields. Assisted only: Vendix does not send it (no SIRE
 * API confirmed, D2); the desk reports it in the portal and marks it.
 */

export type SireEvent = 'check_in' | 'check_out';
export type SireStatus = 'pending' | 'manual';

export const SIRE_AUTHORITY = 'sire';
export const SIRE_DEFAULT_OVERDUE_HOURS = 24;

/** The SIRE form calls each movement "Entrada" or "Salida". */
export const SIRE_EVENT_LABELS: Record<SireEvent, string> = {
  check_in: 'Entrada',
  check_out: 'Salida',
};

/** Documents a foreign guest may show (Vendix code → label of the portal). */
export const SIRE_DOCUMENT_LABELS: Record<string, string> = {
  PA: 'Pasaporte',
  CE: 'Cédula de extranjería',
  PEP: 'Permiso especial de permanencia',
  PPT: 'Permiso por protección temporal',
  DIE: 'Documento de identificación extranjero',
  CC: 'Cédula de ciudadanía',
  TI: 'Tarjeta de identidad',
};

const COUNTRY_NAMES = new Intl.DisplayNames(['es'], { type: 'region' });

/** "US" → "Estados Unidos"; an unknown code stays as stored. */
export function countryName(code: string | null | undefined): string {
  const clean = code?.trim().toUpperCase();
  if (!clean) return '';
  try {
    return COUNTRY_NAMES.of(clean) ?? clean;
  } catch {
    return clean;
  }
}

/** Only foreign guests are reported to the SIRE. */
export function isSireGuest(nationality_country_code: string | null | undefined): boolean {
  return reportsSire(nationality_country_code?.trim().toUpperCase() || HOME_COUNTRY_CODE);
}

/** "García López" → first and second surname (the rest stays in the second). */
export function splitSurnames(last_name: string): { first: string; second: string } {
  const parts = last_name.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? '', second: parts.slice(1).join(' ') };
}

/** `Date` → "dd/mm/aaaa" in the hotel's time zone, as the SIRE form asks. */
export function dayMonthYear(value: Date | string | null | undefined, timeZone = 'America/Bogota'): string {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
  return parts;
}

export interface SireSource {
  event: SireEvent;
  /** When the movement happened (the moment the check-in/out was recorded). */
  moved_at: Date;
  time_zone?: string;
  guest: {
    document_type: string;
    document_number: string;
    first_name: string;
    last_name: string;
    nationality_country_code: string;
    birth_date: Date | string | null;
    residence_city: string;
    origin_city: string;
  };
  room_code: string | null | undefined;
}

export interface SireRecord {
  tipo_movimiento: string;
  fecha_movimiento: string;
  tipo_documento: string;
  numero_documento: string;
  nacionalidad: string;
  primer_apellido: string;
  segundo_apellido: string;
  nombres: string;
  fecha_nacimiento: string;
  procedencia: string;
  residencia: string;
  habitacion: string;
}

/** Builds the record; missing data stays empty and is named by `missingSireFields`. */
export function buildSireRecord(source: SireSource): SireRecord {
  const { guest } = source;
  const tz = source.time_zone || 'America/Bogota';
  const surnames = splitSurnames(guest.last_name);
  const birth =
    guest.birth_date instanceof Date ? guest.birth_date.toISOString().slice(0, 10) : guest.birth_date;
  return {
    tipo_movimiento: SIRE_EVENT_LABELS[source.event],
    fecha_movimiento: dayMonthYear(source.moved_at, tz),
    tipo_documento: SIRE_DOCUMENT_LABELS[guest.document_type] ?? guest.document_type,
    numero_documento: guest.document_number.trim(),
    nacionalidad: countryName(guest.nationality_country_code),
    primer_apellido: surnames.first,
    segundo_apellido: surnames.second,
    nombres: guest.first_name.trim(),
    fecha_nacimiento: dayMonthYear(birth ?? null, tz),
    procedencia: guest.origin_city.trim(),
    residencia: guest.residence_city.trim(),
    habitacion: source.room_code?.trim() ?? '',
  };
}

/** Plain-Spanish names of the fields the SIRE form needs and the record lacks. */
export function missingSireFields(record: SireRecord): string[] {
  const missing: string[] = [];
  if (!record.numero_documento) missing.push('documento');
  if (!record.nacionalidad) missing.push('nacionalidad');
  if (!record.nombres || !record.primer_apellido) missing.push('nombre');
  if (!record.fecha_nacimiento) missing.push('fecha de nacimiento');
  if (!record.procedencia) missing.push('procedencia');
  return missing;
}

/** Whole hours since the movement (never negative). */
export function ageHours(moved_at: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - moved_at.getTime()) / 3_600_000));
}

/** Threshold of the store; any invalid value falls back to 24 h. */
export function overdueHours(value: unknown): number {
  const hours = Number(value);
  return Number.isInteger(hours) && hours >= 1 ? hours : SIRE_DEFAULT_OVERDUE_HOURS;
}

/** A pending movement older than the threshold is shown in red. */
export function isOverdue(status: string, moved_at: Date, now: Date, threshold_hours: number): boolean {
  return status === 'pending' && now.getTime() - moved_at.getTime() > threshold_hours * 3_600_000;
}
