/**
 * CP-print-token-flow A.1/A.2 — mapeo único de `users.addresses[0]` a
 * `StandardPrintParty`. SIEMPRE emite ubicación: sin dirección
 * (null/undefined/vacía) devuelve el default Colombia / Bogotá D.C. para que
 * el spread agregue claves y el compositor pinte la fila.
 *
 * País (`country` de salida): `country_code` real > `country` legacy >
 * fallback `'CO'`. `country` legacy se acepta solo por compatibilidad con
 * fixtures/specs viejos; la columna real de `addresses` es `country_code`.
 */
const DEFAULT_CITY = 'Bogotá D.C.';
const DEFAULT_COUNTRY = 'CO';
const DEFAULT_ADDRESS = 'Bogotá D.C., CO';

export function mapUserAddress(addr?: {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  country?: string | null;
  country_code?: string | null;
} | null): {
  address?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  country?: string;
} {
  const raw = (addr ?? {}) as {
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state_province?: string | null;
    country?: string | null;
    country_code?: string | null;
  };
  const countryCode = raw.country_code?.trim() || '';
  const countryLegacy = raw.country?.trim() || '';
  const country = countryCode || countryLegacy || DEFAULT_COUNTRY;

  const line1 = raw.address_line1?.trim() || '';
  const line2 = raw.address_line2?.trim() || '';
  const city = raw.city?.trim() || '';
  const state = raw.state_province?.trim() || '';
  const full = [line1, line2, city].filter((s) => s.length > 0).join(', ');

  const hasAny =
    line1 !== '' ||
    line2 !== '' ||
    city !== '' ||
    state !== '' ||
    countryCode !== '' ||
    countryLegacy !== '';

  if (!hasAny) {
    return { address: DEFAULT_ADDRESS, city: DEFAULT_CITY, country };
  }

  return {
    address: full || state || country,
    ...(line1 ? { address_line1: line1 } : {}),
    ...(line2 ? { address_line2: line2 } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state_province: state } : {}),
    country,
  };
}
