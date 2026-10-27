/**
 * Hospitality Suite (H3.1) — field rules of the guest register.
 *
 * TRA (Res. 409/2022 art. 7) asks every guest and companion for document,
 * name, city of residence, city of origin and travel purpose. SIRE
 * (Migración Colombia) reports foreign guests and also needs nationality and
 * birth date. Pure functions so the desk and the API apply the same rules.
 */

/** Country whose nationals the SIRE does not report. */
export const HOME_COUNTRY_CODE = 'CO';

/** Travel purposes of the TRA register (code → label shown at the desk). */
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

export interface GuestFields {
  document_type?: string | null;
  document_number?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nationality_country_code?: string | null;
  birth_date?: string | Date | null;
  residence_city?: string | null;
  origin_city?: string | null;
  travel_purpose?: string | null;
}

const filled = (value: string | null | undefined) => !!value?.trim();

/**
 * Nationality to store: the one given (upper case) or, for a Colombian
 * document, CO. Null when a foreign document came without it.
 */
export function resolveNationality(guest: GuestFields): string | null {
  const given = guest.nationality_country_code?.trim().toUpperCase();
  if (given) return given;
  if (guest.document_type && FOREIGN_DOCUMENT_TYPES.includes(guest.document_type)) {
    return null;
  }
  return HOME_COUNTRY_CODE;
}

/** A foreign guest is reported to the SIRE ("Reporta SIRE"). */
export function reportsSire(nationality: string | null): boolean {
  return !!nationality && nationality !== HOME_COUNTRY_CODE;
}

/** Desk messages of the missing or invalid fields; empty when it can be saved. */
export function guestFieldErrors(guest: GuestFields): string[] {
  const errors: string[] = [];
  if (!filled(guest.document_type)) errors.push('Falta tipo de documento');
  if (!filled(guest.document_number)) errors.push('Falta número de documento');
  if (!filled(guest.first_name)) errors.push('Falta nombre');
  if (!filled(guest.last_name)) errors.push('Falta apellido');
  const nationality = resolveNationality(guest);
  if (!nationality) {
    errors.push(
      guest.document_type === 'PA'
        ? 'El pasaporte exige nacionalidad'
        : 'El documento extranjero exige nacionalidad',
    );
  }
  if (!filled(guest.residence_city)) errors.push('Falta ciudad de residencia');
  if (!filled(guest.origin_city)) errors.push('Falta ciudad de procedencia');
  if (!guest.travel_purpose || !TRAVEL_PURPOSES[guest.travel_purpose]) {
    errors.push('Falta motivo de viaje');
  }
  if (reportsSire(nationality) && !guest.birth_date) {
    errors.push('Falta fecha de nacimiento (reporta SIRE)');
  }
  return errors;
}
