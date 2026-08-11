/**
 * Equivalencia entre el catálogo de unidades de Vendix y los códigos UN/ECE
 * Recommendation 20 que la DIAN espera en `unitCode`.
 *
 * La DIAN valida la coherencia entre la cantidad declarada y su unidad: una
 * línea de 3 metros declarada como `EA` dice "3 unidades" y no "3 metros". Con
 * el catálogo de una sola dimensión el `'EA'` fijo era inofensivo; desde que
 * una ferretería puede facturar metros, deja de serlo.
 *
 * Lo que no está en la tabla cae a `EA` ("each"), que es el comportamiento
 * histórico: una unidad desconocida nunca debe impedir emitir la factura.
 */

const UNECE_BY_CODE: Record<string, string> = {
  // Conteo
  unit: 'EA',
  par: 'PR',
  med_doc: 'EA',
  doc: 'DZN',
  ciento: 'CEN',
  millar: 'MIL',
  // Masa
  mg: 'MGM',
  g: 'GRM',
  kg: 'KGM',
  lb: 'LBR',
  arroba: 'KGM',
  qq: 'KGM',
  ton: 'TNE',
  // Volumen
  ml: 'MLT',
  L: 'LTR',
  l: 'LTR',
  gal: 'GLL',
  m3: 'MTQ',
  // Longitud
  mm: 'MMT',
  cm: 'CMT',
  m: 'MTR',
  km: 'KMT',
  in: 'INH',
  ft: 'FOT',
  yd: 'YRD',
};

/** Código UN/ECE de una unidad del catálogo. `EA` cuando no hay equivalencia. */
export function resolveUneceUnitCode(uomCode?: string | null): string {
  if (!uomCode) return 'EA';
  const exact = UNECE_BY_CODE[uomCode];
  if (exact) return exact;
  const lower = UNECE_BY_CODE[String(uomCode).toLowerCase()];
  return lower ?? 'EA';
}
