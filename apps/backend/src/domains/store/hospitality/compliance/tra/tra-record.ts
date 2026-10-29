import { TRAVEL_PURPOSES } from '../../reservations/guests/lodging-guest-rules';

/**
 * Hospitality Suite (H4.1) — the TRA record of one guest (Res. 409/2022 art. 7):
 * the provider (RNT), the unit (accommodation type, value paid, room number)
 * and the guest or companion (document, name, residence and origin cities,
 * travel purpose, check-in and check-out). Pure, so the automatic sending, the
 * export file and the tests read the same fields.
 */

export type TraEvent = 'check_in' | 'check_out';

export const TRA_EVENT_LABELS: Record<TraEvent, string> = {
  check_in: 'Check-in',
  check_out: 'Check-out',
};

export interface TraSource {
  event: TraEvent;
  rnt_number: string | null | undefined;
  guest: {
    is_primary: boolean;
    document_type: string;
    document_number: string;
    first_name: string;
    last_name: string;
    nationality_country_code: string;
    residence_city: string;
    origin_city: string;
    travel_purpose: string;
  };
  room: {
    unit_type_name: string | null | undefined;
    unit_code: string | null | undefined;
    amount: number | string | null | undefined;
    arrival_date: Date | string;
    departure_date: Date | string;
  } | null;
}

export interface TraRecord {
  evento: TraEvent;
  prestador: { rnt: string };
  unidad: { tipo_acomodacion: string; numero_habitacion: string; valor_pagado: number };
  huesped: {
    tipo_huesped: 'titular' | 'acompanante';
    tipo_documento: string;
    numero_documento: string;
    nombres: string;
    apellidos: string;
    nacionalidad: string;
    ciudad_residencia: string;
    ciudad_procedencia: string;
    motivo_viaje: string;
    motivo_viaje_codigo: string;
    fecha_check_in: string;
    fecha_check_out: string;
  };
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/** Builds the record; missing data stays empty and is named by `missingTraFields`. */
export function buildTraRecord(source: TraSource): TraRecord {
  const { guest, room } = source;
  return {
    evento: source.event,
    prestador: { rnt: (source.rnt_number ?? '').trim() },
    unidad: {
      tipo_acomodacion: room?.unit_type_name?.trim() ?? '',
      numero_habitacion: room?.unit_code?.trim() ?? '',
      valor_pagado: Math.round(Number(room?.amount ?? 0) * 100) / 100,
    },
    huesped: {
      tipo_huesped: guest.is_primary ? 'titular' : 'acompanante',
      tipo_documento: guest.document_type,
      numero_documento: guest.document_number.trim(),
      nombres: guest.first_name.trim(),
      apellidos: guest.last_name.trim(),
      nacionalidad: guest.nationality_country_code,
      ciudad_residencia: guest.residence_city.trim(),
      ciudad_procedencia: guest.origin_city.trim(),
      motivo_viaje: TRAVEL_PURPOSES[guest.travel_purpose] ?? guest.travel_purpose,
      motivo_viaje_codigo: guest.travel_purpose,
      fecha_check_in: room ? dateOnly(room.arrival_date) : '',
      fecha_check_out: room ? dateOnly(room.departure_date) : '',
    },
  };
}

/** Plain-Spanish names of the fields the TRA needs and the record lacks. */
export function missingTraFields(record: TraRecord): string[] {
  const missing: string[] = [];
  if (!record.prestador.rnt) missing.push('RNT del hotel');
  if (!record.unidad.numero_habitacion) missing.push('número de habitación');
  if (!record.unidad.tipo_acomodacion) missing.push('tipo de acomodación');
  const h = record.huesped;
  if (!h.numero_documento) missing.push('documento');
  if (!h.nombres || !h.apellidos) missing.push('nombre');
  if (!h.ciudad_residencia) missing.push('ciudad de residencia');
  if (!h.ciudad_procedencia) missing.push('ciudad de procedencia');
  if (!h.motivo_viaje_codigo) missing.push('motivo de viaje');
  if (!h.fecha_check_in || !h.fecha_check_out) missing.push('fechas de la estadía');
  return missing;
}
