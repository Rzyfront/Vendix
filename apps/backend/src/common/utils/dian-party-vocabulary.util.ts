/**
 * Traductores entre los DOS vocabularios vivos que describen a una parte fiscal.
 *
 * No es una inconsistencia que haya dos: son dos capas distintas del mismo dato.
 *
 * | Concepto      | Columna de `organizations`     | Contrato del validador |
 * |---------------|--------------------------------|------------------------|
 * | `person_type` | código DIAN `'1'` / `'2'`      | `JURIDICA` / `NATURAL` |
 * | `tax_regime`  | código DIAN `'48'` / `'49'`    | `tax_regime_enum`      |
 *
 * La tabla de `organization-fiscal-columns.helper.ts` lo declara explícito:
 * `fiscal_data.person_type: 'JURIDICA'` se PROYECTA a `person_type: '1'`, y
 * `tax_responsibilities: ['O-48']` se proyecta a `tax_regime: '48'`. Las
 * columnas hablan el idioma del XML; `CustomerFiscalIdentityValidator` habla el
 * idioma del dominio, que es el de `customers` y de `persona_type_enum`.
 *
 * Sin traducir, cada factura de plataforma levantaba dos hallazgos
 * (`PERSON_TYPE_UNKNOWN`, `TAX_REGIME_UNKNOWN`) sobre datos que están BIEN. Son
 * advertencias, no bloqueos, y ese es justo el problema: una advertencia que
 * aparece siempre deja de leerse, y con ella dejan de leerse las que sí
 * importan.
 */

/**
 * Código DIAN de tipo de persona → vocabulario del validador.
 *
 * `'1'` es jurídica y `'2'` natural, tal como lo emite
 * `UblCommonBuilder.buildCustomerParty`
 * (`person_code = resolved_person_type === 'JURIDICA' ? '1' : '2'`).
 *
 * Devuelve `null` —no un valor por defecto— para lo desconocido: es lo que deja
 * al validador DERIVAR el tipo desde el documento, que es su comportamiento
 * correcto. Inventar aquí `'NATURAL'` le quitaría esa decisión y convertiría un
 * dato corrupto en uno que parece deliberado.
 */
export function normalizePersonType(
  value: string | null | undefined,
): 'NATURAL' | 'JURIDICA' | null {
  const raw = (value ?? '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'JURIDICA' || raw === 'JURÍDICA' || raw === '1') return 'JURIDICA';
  if (raw === 'NATURAL' || raw === '2') return 'NATURAL';
  return null;
}

/**
 * Códigos DIAN de régimen que NO pertenecen a `tax_regime_enum`.
 *
 * `'48'` (responsable de IVA) y `'49'` (no responsable) son los dos valores que
 * acepta `BILLING_TAX_REGIMES` en el checkout y los que la proyección del SSOT
 * escribe en la columna. Su equivalencia con `COMUN` / `SIMPLIFICADO` es
 * histórica y discutible —la reforma que eliminó el «régimen simplificado» dejó
 * el par sin correspondencia limpia—, así que aquí NO se mapean.
 */
const DIAN_TAX_REGIME_CODES: ReadonlySet<string> = new Set(['48', '49']);

/**
 * Régimen fiscal de la columna → vocabulario del validador.
 *
 * Un código DIAN se traduce a `null`, que el validador lee como «no declarado»
 * y por tanto no juzga. Es deliberado: la alternativa era inventar una
 * equivalencia con `tax_regime_enum` que nadie puede sostener, y un mapeo
 * inventado que pasa silenciosamente es peor que un campo ausente que se ve.
 *
 * Cualquier otro valor viaja INTACTO. Si está mal escrito, el validador tiene
 * que poder decirlo — silenciarlo acá escondería el dato corrupto.
 */
export function normalizeAcquirerTaxRegime(
  value: string | null | undefined,
): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  if (DIAN_TAX_REGIME_CODES.has(raw)) return null;
  return raw;
}
