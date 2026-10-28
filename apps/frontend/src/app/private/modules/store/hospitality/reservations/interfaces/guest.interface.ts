/**
 * Hospitality Suite (H3.1) — guest register of a reservation. Mirrors the
 * backend rules in `guests/lodging-guest-rules.ts` so the desk sees what is
 * missing before saving; the API applies the same checks.
 */

export interface LodgingGuest {
  id: number;
  reservation_id: number;
  reservation_room_id: number | null;
  customer_id: number | null;
  is_primary: boolean;
  document_type: string;
  document_number: string;
  first_name: string;
  last_name: string;
  nationality_country_code: string;
  birth_date: string | null;
  residence_city: string;
  origin_city: string;
  travel_purpose: string;
  travel_purpose_label: string;
  entry_permit_type: string | null;
  is_non_resident: boolean;
  data_consent_at: string;
  /** Foreign guest: Migración Colombia (SIRE) must be told. */
  reports_sire: boolean;
}

export interface LodgingGuestRequest {
  reservation_room_id?: number;
  customer_id?: number;
  is_primary?: boolean;
  document_type: string;
  document_number: string;
  first_name: string;
  last_name: string;
  nationality_country_code?: string;
  birth_date?: string;
  residence_city: string;
  origin_city: string;
  travel_purpose: string;
  entry_permit_type?: string;
  is_non_resident?: boolean;
  data_consent: boolean;
}

/** Country whose nationals the SIRE does not report. */
export const HOME_COUNTRY_CODE = 'CO';

/** Travel purposes of the TRA register (same codes as the API). */
export const TRAVEL_PURPOSES: Record<string, string> = {
  vacation: 'Vacaciones, recreo y ocio',
  family: 'Visita a familiares y amigos',
  business: 'Negocios y motivos profesionales',
  education: 'Educación y formación',
  health: 'Salud y atención médica',
  religion: 'Religión y peregrinaciones',
  shopping: 'Compras',
  transit: 'Tránsito',
  other: 'Otro',
};

/** Documents that do not prove a nationality by themselves. */
export const FOREIGN_DOCUMENT_TYPES = ['PA', 'CE', 'PEP', 'PPT', 'DIE'];

/** Given nationality (upper case), CO for a Colombian document, else null. */
export function resolveNationality(
  documentType: string,
  nationality: string | null | undefined,
): string | null {
  const given = nationality?.trim().toUpperCase();
  if (given) return given;
  return FOREIGN_DOCUMENT_TYPES.includes(documentType) ? null : HOME_COUNTRY_CODE;
}

export function reportsSire(nationality: string | null): boolean {
  return !!nationality && nationality !== HOME_COUNTRY_CODE;
}

/** Fields of the guest form that can carry an error under them. */
export type GuestField =
  | 'document_type'
  | 'document_number'
  | 'first_name'
  | 'last_name'
  | 'nationality_country_code'
  | 'birth_date'
  | 'residence_city'
  | 'origin_city'
  | 'travel_purpose';

/** U5 — the message under each missing field ("Escribe la ciudad de residencia"). */
export function guestFieldErrorMap(guest: LodgingGuestRequest): Partial<Record<GuestField, string>> {
  const filled = (value: string | undefined) => !!value?.trim();
  const errors: Partial<Record<GuestField, string>> = {};
  if (!filled(guest.document_type)) errors.document_type = 'Elige el tipo de documento';
  if (!filled(guest.document_number)) errors.document_number = 'Escribe el número de documento';
  if (!filled(guest.first_name)) errors.first_name = 'Escribe los nombres';
  if (!filled(guest.last_name)) errors.last_name = 'Escribe los apellidos';
  const nationality = resolveNationality(guest.document_type, guest.nationality_country_code);
  if (!nationality) {
    errors.nationality_country_code =
      guest.document_type === 'PA'
        ? 'El pasaporte exige nacionalidad'
        : 'El documento extranjero exige nacionalidad';
  }
  if (!filled(guest.residence_city)) errors.residence_city = 'Escribe la ciudad de residencia';
  if (!filled(guest.origin_city)) errors.origin_city = 'Escribe la ciudad de procedencia';
  if (!TRAVEL_PURPOSES[guest.travel_purpose]) errors.travel_purpose = 'Elige el motivo de viaje';
  if (reportsSire(nationality) && !guest.birth_date) {
    errors.birth_date = 'Escribe la fecha de nacimiento: se reporta a Migración';
  }
  return errors;
}
