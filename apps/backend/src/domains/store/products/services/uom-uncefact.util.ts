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
  // `KTM`, no `KMT`. No es un typo de este archivo: la lista de la DIAN está
  // corrompida en el ORIGEN y hay que enviarle el código corrompido.
  //
  // La DIAN publicó su catálogo de unidades pasado por un traductor automático
  // que alcanzó también a la columna de CÓDIGOS, no sólo a los nombres. Su
  // Schematron —el validador ejecutable, no la documentación— acepta `LUN` (mes,
  // por «Monday»), `SÍ` (montaje, por «AY»), `ÉL` (por «HE»), `ANA` (año, por
  // «ANN») y `G K` **con un espacio en medio** (por «GK»); y rechaza los códigos
  // UN/ECE correctos `MON`, `AY`, `HE`, `ANN`, `GK`. El kilómetro sigue el mismo
  // patrón: el validador acepta `KTM` y rechaza `KMT`.
  //
  // Verificado extrayendo los 1089 códigos del `contains()` de
  // `DIAN_UBL21-listacodigos_v1.6.sch` y contrastando esta tabla entera contra
  // ellos: de las 25 unidades de Vendix, ésta era la única rechazada.
  km: 'KTM',
  in: 'INH',
  ft: 'FOT',
  yd: 'YRD',
};

/**
 * Código UN/ECE de una unidad del catálogo, o `null` cuando NO hay equivalencia.
 *
 * Es la variante que distingue «se cuenta por unidades» de «no sé traducir esta
 * unidad», dos casos que `resolveUneceUnitCode` colapsa en el mismo `'EA'`.
 *
 * La distinción sólo importa donde el valor viaja a la DIAN: emitir `EA` por una
 * unidad de masa que esta tabla no cubre declara piezas donde hubo kilos, y el
 * documento queda aceptado y falso. Quien emite usa ESTA función y rechaza el
 * `null` (ver `DIAN_UNIT_CODE_001`); quien sólo persiste un snapshot o muestra
 * un valor puede seguir usando la versión tolerante.
 *
 * `uomCode` vacío/`null` devuelve `null` también: la ausencia de unidad la
 * interpreta quien llama, no esta tabla.
 */
export function resolveUneceUnitCodeStrict(
  uomCode?: string | null,
): string | null {
  if (!uomCode) return null;
  const exact = UNECE_BY_CODE[uomCode];
  if (exact) return exact;
  return UNECE_BY_CODE[String(uomCode).toLowerCase()] ?? null;
}

/** Código UN/ECE de una unidad del catálogo. `EA` cuando no hay equivalencia. */
export function resolveUneceUnitCode(uomCode?: string | null): string {
  return resolveUneceUnitCodeStrict(uomCode) ?? 'EA';
}
