/**
 * CP-print-token-flow A.1/A.2 — mapeo único de `users.addresses[0]` a
 * `StandardPrintParty`. Sin dirección devuelve `{}` para que el spread no
 * agregue claves y el compositor no emita fila (invariante 1 del plan).
 *
 * ## POR QUÉ NO SE RELLENA UNA UBICACIÓN POR DEFECTO
 *
 * Este mapeo alimenta la representación gráfica de documentos FISCALES:
 * `fiscal-document-print.mapper.ts` lo esparce en `customer` y de ahí sale a
 * `fiscal-invoice`, `fiscal-credit-note`, `credit-note` y
 * `pos-electronic-invoice`. Fabricar «Bogotá D.C., CO» cuando el adquirente no
 * tiene fila de dirección —el caso normal del «Consumidor Final» en POS—
 * imprime un domicilio legal del adquirente que es falso, y contradice al XML,
 * que sí omite la dirección cuando no la hay: el papel y el archivo firmado
 * dirían cosas distintas del mismo documento.
 *
 * Es la misma regla que este repositorio ya codificó, textual, del lado XML:
 *
 *   - `invoicing/providers/dian-direct/constants/dian-geography.ts`: «El
 *     llamador debe decidir explícitamente qué hacer (rechazar la emisión,
 *     pedir el dato, o documentar el sustituto), NUNCA rellenar Bogotá en
 *     silencio.»
 *   - `invoicing/providers/dian-direct/xml/ubl-common.builder.ts`: «Ese relleno
 *     no produce un documento rechazado: produce uno ACEPTADO que afirma que la
 *     operación ocurrió en Bogotá … no se corrige, se anula con nota crédito y
 *     se reemite, gastando dos consecutivos autorizados.»
 *
 * Ningún consumidor pedía el relleno: el tiquete de despacho
 * (`dispatch-ticket.provider.ts`) resuelve su dirección desde
 * `shipping_address_snapshot`/`billing_address_snapshot` y ni siquiera llama a
 * esta función, y el tiquete POS (`pos-sale-ticket.provider.ts`) documenta en
 * su propio comentario que sin direcciones la fila NO debe emitirse.
 *
 * ## PAÍS
 *
 * `country` de salida: `country_code` real > `country` legacy > fallback
 * `'CO'`, y SOLO cuando la fila trae algún dato real. `country` legacy se
 * acepta únicamente por compatibilidad con fixtures/specs viejos: la columna
 * real de `addresses` es `country_code`, y pedir `country: true` en un `select`
 * lanza `Unknown field 'country'` → 500 (candado en
 * `providers/__tests__/print-address-country-code.spec.ts`).
 */
const FALLBACK_COUNTRY = 'CO';

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

  // Invariante 1: sin ningún dato real no se inventa ubicación.
  if (!hasAny) return {};

  // La cadena de `address` corta en `state`: caer hasta el país imprimiría el
  // código ISO («CO») en el renglón de la calle.
  const address = full || state;

  return {
    ...(address ? { address } : {}),
    ...(line1 ? { address_line1: line1 } : {}),
    ...(line2 ? { address_line2: line2 } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state_province: state } : {}),
    country: countryCode || countryLegacy || FALLBACK_COUNTRY,
  };
}
