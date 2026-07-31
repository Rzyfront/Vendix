/**
 * Normalización de nombres geográficos (país, departamento/región, ciudad).
 *
 * ¿Por qué existe? La cobertura de envío (`shipping_zones.regions` /
 * `shipping_zones.cities`) se guarda como texto libre elegido por el
 * comerciante, mientras que la dirección del comprador llega desde tres
 * fuentes distintas que escriben el mismo lugar de formas distintas:
 *
 *   - el catálogo de api-colombia (`"Bogotá D.C."`, `"La Guajira"`)
 *   - el reverse-geocoding de Nominatim (`"Bogota"`, `"BOGOTÁ"`)
 *   - direcciones viejas tipeadas a mano (`"riohacha "`)
 *
 * Comparar esos strings con `===` o `Array.includes()` hace que el comprador
 * quede sin opciones de envío por una tilde. Estas utilidades comparan por
 * forma normalizada.
 *
 * IMPORTANTE: acá no vive ninguna ubicación concreta. Las reglas son
 * lingüísticas (diacríticos, mayúsculas, espacios) y de estándar ISO, nunca
 * "esta ciudad" o "este departamento". Toda la geografía es dato del tenant.
 */

/**
 * Sufijos administrativos que los catálogos agregan al nombre de una misma
 * ciudad de forma inconsistente. Se describen como patrón, no como lista de
 * ciudades: aplica a cualquier nombre que los traiga.
 *
 * Caso real: api-colombia expone la ciudad como `"Bogotá D.C."` pero el
 * departamento como `"Bogotá"`, y un comerciante que tipeó la zona a mano
 * casi siempre escribió `"Bogotá"`.
 */
const ADMINISTRATIVE_SUFFIX_PATTERNS: RegExp[] = [
  /\bd\.?\s?c\.?$/, // "d.c." | "dc" | "d c" al final
  /\bdistrito\s+capital$/,
  /\bdistrito\s+especial$/,
  /\bciudad\s+capital$/,
];

/** Prefijos genéricos de división administrativa. */
const ADMINISTRATIVE_PREFIX_PATTERNS: RegExp[] = [
  /^municipio\s+de\s+/,
  /^ciudad\s+de\s+/,
  /^departamento\s+de\s+/,
  /^provincia\s+de\s+/,
];

/**
 * Mapa ISO 3166-1 alfa-3 → alfa-2 acotado a los países que la plataforma
 * ofrece (espejo de `country.service.ts` en el frontend). Es dato de estándar,
 * no configuración de tenant: existe sólo porque hay direcciones históricas
 * guardadas en alfa-3 (`"COL"`) mientras las zonas usan alfa-2 (`"CO"`), y
 * comparar por prefijo sería incorrecto (`CHL` Chile vs `CH` Suiza).
 */
const ISO_ALPHA3_TO_ALPHA2: Readonly<Record<string, string>> = Object.freeze({
  COL: 'CO',
  MEX: 'MX',
  ARG: 'AR',
  BRA: 'BR',
  CHL: 'CL',
  PER: 'PE',
  ECU: 'EC',
  VEN: 'VE',
  USA: 'US',
  ESP: 'ES',
  CAN: 'CA',
  GBR: 'GB',
  FRA: 'FR',
  DEU: 'DE',
  ITA: 'IT',
  PRT: 'PT',
  NLD: 'NL',
  BEL: 'BE',
  CHE: 'CH',
  AUT: 'AT',
  SWE: 'SE',
  NOR: 'NO',
  DNK: 'DK',
  FIN: 'FI',
  POL: 'PL',
  CZE: 'CZ',
  HUN: 'HU',
  GRC: 'GR',
  TUR: 'TR',
  ISR: 'IL',
  ARE: 'AE',
  SAU: 'SA',
  EGY: 'EG',
  ZAF: 'ZA',
  AUS: 'AU',
  NZL: 'NZ',
  IND: 'IN',
  SGP: 'SG',
  MYS: 'MY',
  THA: 'TH',
  PHL: 'PH',
  IDN: 'ID',
  VNM: 'VN',
  KOR: 'KR',
  JPN: 'JP',
  CHN: 'CN',
  PAN: 'PA',
  CRI: 'CR',
  GTM: 'GT',
  HND: 'HN',
  NIC: 'NI',
  SLV: 'SV',
  DOM: 'DO',
  CUB: 'CU',
  PRI: 'PR',
  URY: 'UY',
  PRY: 'PY',
  BOL: 'BO',
});

/**
 * Forma canónica de un nombre geográfico para comparar.
 *
 * `"  Bogotá D.C. "` → `"bogota"`; `"LA GUAJIRA"` → `"la guajira"`.
 *
 * Devuelve `''` para valores vacíos o no utilizables, de modo que quien compare
 * pueda distinguir "no informado" de "no coincide" con {@link isUsableGeoName}.
 */
export function normalizeGeoName(value?: string | null): string {
  if (value === null || value === undefined) return '';

  let normalized = String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // marcas diacríticas combinantes
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  for (const pattern of ADMINISTRATIVE_PREFIX_PATTERNS) {
    normalized = normalized.replace(pattern, '');
  }
  for (const pattern of ADMINISTRATIVE_SUFFIX_PATTERNS) {
    normalized = normalized.replace(pattern, '');
  }

  // Los sufijos pueden dejar una coma o espacios colgando: "bogota ," → "bogota"
  return normalized.replace(/[\s,.-]+$/, '').trim();
}

/**
 * `true` cuando el valor sirve para comparar geografía.
 *
 * Descarta el vacío y —clave— los valores puramente numéricos: hay direcciones
 * guardadas con el **ID** del catálogo de api-colombia en vez del nombre
 * (`city = "694"`, `state_province = "19"`), porque el formulario que las
 * escribió mandaba el `value` del selector sin resolverlo. Tratar `"694"` como
 * nombre de ciudad produce comparaciones que nunca matchean, en silencio.
 */
export function isUsableGeoName(value?: string | null): boolean {
  const normalized = normalizeGeoName(value);
  if (!normalized) return false;
  return !/^\d+$/.test(normalized);
}

/** Igualdad de nombres geográficos por forma normalizada. */
export function geoNamesMatch(a?: string | null, b?: string | null): boolean {
  const left = normalizeGeoName(a);
  const right = normalizeGeoName(b);
  if (!left || !right) return false;
  return left === right;
}

/**
 * `true` si `value` coincide con alguno de los nombres de `candidates`.
 * Ignora las entradas vacías de la lista.
 */
export function geoNameInList(
  value: string | null | undefined,
  candidates: readonly (string | null | undefined)[],
): boolean {
  const target = normalizeGeoName(value);
  if (!target) return false;
  return candidates.some((candidate) => normalizeGeoName(candidate) === target);
}

/**
 * Código de país en forma canónica alfa-2 y mayúsculas.
 * `"col"` / `"COL"` / `" co "` → `"CO"`.
 */
export function normalizeCountryCode(value?: string | null): string {
  if (value === null || value === undefined) return '';
  const upper = String(value).trim().toUpperCase();
  if (!upper) return '';
  if (upper.length === 3 && ISO_ALPHA3_TO_ALPHA2[upper]) {
    return ISO_ALPHA3_TO_ALPHA2[upper];
  }
  return upper;
}

/** Igualdad de códigos de país tolerante a alfa-2 vs alfa-3 y a mayúsculas. */
export function countryCodesMatch(
  a?: string | null,
  b?: string | null,
): boolean {
  const left = normalizeCountryCode(a);
  const right = normalizeCountryCode(b);
  if (!left || !right) return false;
  return left === right;
}

/**
 * Compara un código de país contra una lista (p. ej. `shipping_zones.countries`).
 */
export function countryCodeInList(
  value: string | null | undefined,
  candidates: readonly (string | null | undefined)[],
): boolean {
  const target = normalizeCountryCode(value);
  if (!target) return false;
  return candidates.some(
    (candidate) => normalizeCountryCode(candidate) === target,
  );
}

/**
 * Normaliza un código postal para comparar: sin espacios internos ni guiones
 * decorativos, en mayúsculas (hay países con letras en el código).
 */
export function normalizePostalCode(value?: string | null): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\s-]+/g, '').toUpperCase().trim();
}

/** Compara un código postal contra una lista de patrones exactos. */
export function postalCodeInList(
  value: string | null | undefined,
  candidates: readonly (string | null | undefined)[],
): boolean {
  const target = normalizePostalCode(value);
  if (!target) return false;
  return candidates.some(
    (candidate) => normalizePostalCode(candidate) === target,
  );
}
