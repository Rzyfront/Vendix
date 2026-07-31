/**
 * Normalización de nombres geográficos en el frontend.
 *
 * Espejo de `apps/backend/src/common/utils/geo-name.util.ts`: el backend
 * resuelve las zonas de envío comparando por forma normalizada, así que el
 * admin tiene que usar la MISMA definición para no dejar guardar dos entradas
 * que el backend va a tratar como la misma (`"Bogotá"` y `"bogota"`).
 *
 * Acá no vive ninguna ubicación concreta: sólo reglas de texto.
 */

const ADMINISTRATIVE_SUFFIX_PATTERNS: RegExp[] = [
  /\bd\.?\s?c\.?$/,
  /\bdistrito\s+capital$/,
  /\bdistrito\s+especial$/,
  /\bciudad\s+capital$/,
];

const ADMINISTRATIVE_PREFIX_PATTERNS: RegExp[] = [
  /^municipio\s+de\s+/,
  /^ciudad\s+de\s+/,
  /^departamento\s+de\s+/,
  /^provincia\s+de\s+/,
];

/** Forma canónica de un nombre geográfico para comparar. */
export function normalizeGeoName(value?: string | null): string {
  if (value === null || value === undefined) return '';

  let normalized = String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  for (const pattern of ADMINISTRATIVE_PREFIX_PATTERNS) {
    normalized = normalized.replace(pattern, '');
  }
  for (const pattern of ADMINISTRATIVE_SUFFIX_PATTERNS) {
    normalized = normalized.replace(pattern, '');
  }

  return normalized.replace(/[\s,.-]+$/, '').trim();
}

/**
 * Quita duplicados por forma normalizada conservando el primer nombre tal cual
 * lo escribió el catálogo (se persiste el nombre legible, se compara el
 * normalizado).
 */
export function dedupeGeoNames(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = normalizeGeoName(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}
