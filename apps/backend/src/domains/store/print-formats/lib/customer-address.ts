/**
 * CP-print-token-flow A.1/A.2 — mapeo único de `users.addresses[0]` a
 * `StandardPrintParty`. Sin dirección devuelve `{}` para que el spread no
 * agregue claves y el compositor no emita fila (invariante 1 del plan).
 */
export function mapUserAddress(addr?: {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  country?: string | null;
} | null): {
  address?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  country?: string;
} {
  if (!addr) return {};
  const line1 = addr.address_line1?.trim() || '';
  const line2 = addr.address_line2?.trim() || '';
  const city = addr.city?.trim() || '';
  const full = [line1, line2, city].filter((s) => s.length > 0).join(', ');
  return {
    ...(full ? { address: full } : {}),
    ...(line1 ? { address_line1: line1 } : {}),
    ...(line2 ? { address_line2: line2 } : {}),
    ...(city ? { city } : {}),
    ...(addr.state_province?.trim() ? { state_province: addr.state_province.trim() } : {}),
    ...(addr.country?.trim() ? { country: addr.country.trim() } : {}),
  };
}
