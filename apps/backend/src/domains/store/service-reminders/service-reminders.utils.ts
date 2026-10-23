import { localDateString } from '@common/utils/store-timezone.util';

/**
 * Utilidades puras del registro de servicios / recordatorios recurrentes.
 * Sin DI ni Prisma para poder probarlas en aislamiento (ver spec).
 *
 * Regla de fechas (vendix-date-timezone): el "día" del servicio y el "hoy"
 * se calculan SIEMPRE en la zona horaria de la tienda; la aritmética de días
 * se hace sobre medianoches UTC de esas fechas civiles (sin DST ni horas).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Medianoche UTC de la fecha civil local (`YYYY-MM-DD`) de `date` en `tz`. */
export function localDayUtc(date: Date, tz: string): Date {
  const [y, m, d] = localDateString(date, tz).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIsoDate(dayUtc: Date): string {
  return dayUtc.toISOString().slice(0, 10);
}

export interface RecurrenceInfo {
  /** Fecha civil local del servicio (YYYY-MM-DD). */
  service_date: string;
  /** Días completos transcurridos desde el servicio (>= 0). */
  days_since: number;
  /** Próxima fecha recomendada (YYYY-MM-DD) o null si no es recurrente. */
  next_due_date: string | null;
  /** Días que faltan para la próxima fecha (negativo = vencido) o null. */
  days_remaining: number | null;
}

export function computeRecurrence(
  baseDate: Date,
  intervalDays: number | null | undefined,
  now: Date,
  tz: string,
): RecurrenceInfo {
  const baseDay = localDayUtc(baseDate, tz);
  const today = localDayUtc(now, tz);
  const daysSince = Math.max(0, Math.round((today.getTime() - baseDay.getTime()) / DAY_MS));
  if (!intervalDays || intervalDays <= 0) {
    return { service_date: toIsoDate(baseDay), days_since: daysSince, next_due_date: null, days_remaining: null };
  }
  const due = new Date(baseDay.getTime());
  due.setUTCDate(due.getUTCDate() + intervalDays);
  return {
    service_date: toIsoDate(baseDay),
    days_since: daysSince,
    next_due_date: toIsoDate(due),
    days_remaining: Math.round((due.getTime() - today.getTime()) / DAY_MS),
  };
}

/** "3 de oct" (o "3 de oct de 2025" si no es el año de referencia). */
export function formatDayEs(dayUtc: Date, referenceYear?: number): string {
  const base = `${dayUtc.getUTCDate()} de ${MONTHS_ES[dayUtc.getUTCMonth()]}`;
  return referenceYear && referenceYear !== dayUtc.getUTCFullYear() ? `${base} de ${dayUtc.getUTCFullYear()}` : base;
}

export interface SubjectLike {
  subject_type?: string | null;
  label?: string | null;
  metadata?: unknown;
}

export interface SubjectSummary {
  /** Texto para mostrar en la tabla: "Moto AKT · ABC12D". */
  display: string;
  /** Fragmento para el mensaje: "moto AKT (ABC12D)". */
  phrase: string;
  plate: string | null;
}

const COMMON_NOUNS = new Set([
  'moto', 'motocicleta', 'carro', 'auto', 'automóvil', 'automovil', 'camioneta', 'camión', 'camion',
  'bicicleta', 'vehículo', 'vehiculo', 'celular', 'teléfono', 'telefono', 'portátil', 'portatil', 'computador', 'tablet',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function lowerCommonNoun(name: string): string {
  const [first, ...rest] = name.split(' ');
  return COMMON_NOUNS.has(first.toLowerCase()) ? [first.toLowerCase(), ...rest].join(' ') : name;
}

/**
 * Resume el sujeto atendido (vehículo / equipo). Personas no generan resumen:
 * el cliente ya se nombra en el saludo.
 */
export function summarizeSubject(subject: SubjectLike | null | undefined): SubjectSummary | null {
  if (!subject) return null;
  const meta = asRecord(subject.metadata);
  const label = str(subject.label);
  if (subject.subject_type === 'vehicle') {
    let name = str(meta['vehicle_name']);
    let plate = str(meta['plate']);
    if ((!name || !plate) && label && label.includes(' - ')) {
      const parts = label.split(' - ');
      name = name ?? str(parts[0]);
      plate = plate ?? str(parts[parts.length - 1]);
    }
    name = name ?? (label && !label.includes(' - ') ? label : null);
    plate = plate ? plate.toUpperCase() : null;
    if (!name && !plate) return null;
    const display = [name, plate].filter(Boolean).join(' · ');
    const phrase = name ? (plate ? `${lowerCommonNoun(name)} (${plate})` : lowerCommonNoun(name)) : `vehículo de placa ${plate}`;
    return { display, phrase, plate };
  }
  if (subject.subject_type === 'other') {
    const device = str(meta['device_model']) ?? label;
    if (!device) return null;
    return { display: device, phrase: lowerCommonNoun(device), plate: null };
  }
  return null;
}

export interface ReminderMessageInput {
  customerName: string | null | undefined;
  storeName: string | null | undefined;
  productName: string | null | undefined;
  serviceDay: Date | null;
  subjectPhrase: string | null;
  intervalDays: number | null | undefined;
  daysSince: number;
  referenceYear?: number;
}

/**
 * Mensaje al cliente (tuteo, cercano, corto — tono vendix-contactar-clientes).
 * Ej: "Hola Juan, en Taller X te hicimos el servicio de cambio de aceite a tu
 * moto AKT (ABC12D) el 3 de oct. Ya pasaron 30 días, que es el periodo
 * recomendado; te sugerimos agendar de nuevo para repetirlo. ¡Te esperamos!"
 */
export function buildReminderMessage(input: ReminderMessageInput): string {
  const firstName = str(input.customerName)?.split(/\s+/)[0] ?? null;
  const greeting = firstName && firstName.toLowerCase() !== 'cliente' ? `Hola ${firstName}` : 'Hola';
  const storeName = str(input.storeName) ?? 'nuestra tienda';
  const service = str(input.productName) ?? 'tu servicio';
  // "Cambio de aceite" → "cambio de aceite", pero una sigla o marca al inicio
  // ("SOAT", "QA-REC", "iPhone") se deja tal cual.
  const firstWord = service.split(/\s+/)[0];
  const isAcronymOrBrand = firstWord.length > 1 && firstWord.slice(1) !== firstWord.slice(1).toLowerCase();
  const serviceLower = isAcronymOrBrand ? service : service.charAt(0).toLowerCase() + service.slice(1);
  const datePart = input.serviceDay ? ` el ${formatDayEs(input.serviceDay, input.referenceYear)}` : '';
  const what = input.subjectPhrase
    ? `te hicimos el servicio de ${serviceLower} a tu ${input.subjectPhrase}${datePart}`
    : `te hicimos el servicio de ${serviceLower}${datePart}`;
  const opening = `${greeting}, en ${storeName} ${what}.`;

  const interval = input.intervalDays && input.intervalDays > 0 ? input.intervalDays : null;
  const bring = 'agendar de nuevo';
  if (!interval) {
    return `${opening} Gracias por confiar en nosotros; cuando lo necesites otra vez, aquí estamos. ¡Te esperamos!`;
  }
  const days = input.daysSince;
  const dayWord = (n: number) => (n === 1 ? 'día' : 'días');
  if (days === interval) {
    return `${opening} Ya pasaron ${days} ${dayWord(days)}, que es el periodo recomendado; te sugerimos ${bring} para repetirlo. ¡Te esperamos!`;
  }
  if (days > interval) {
    return `${opening} Ya pasaron ${days} ${dayWord(days)} y el periodo recomendado es de ${interval} ${dayWord(interval)}; te sugerimos ${bring} para repetirlo pronto. ¡Te esperamos!`;
  }
  const remaining = interval - days;
  return `${opening} Te recomendamos repetirlo cada ${interval} ${dayWord(interval)}, así que en ${remaining} ${dayWord(remaining)} es buen momento para ${bring}. ¡Te esperamos!`;
}

/** Normaliza un teléfono colombiano para wa.me (10 dígitos → prefijo 57). */
export function normalizeWhatsappPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 ? `57${digits}` : digits;
}
