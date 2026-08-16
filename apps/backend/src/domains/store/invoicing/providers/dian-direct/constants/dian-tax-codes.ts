/**
 * Tributos DIAN (tabla «13.2.2 Tributos» del Anexo Técnico 1.9) y sus tarifas.
 *
 * Alimentan `cac:TaxScheme/cbc:ID` (columna Identificador) y
 * `cac:TaxScheme/cbc:Name` (columna Nombre), tanto en `cac:TaxTotal` como en
 * `cac:WithholdingTaxTotal`.
 *
 * FUENTES
 * -------
 * - `Caja_de_herramientas.../Listas de valores/TipoImpuesto-2.1.gc` — las 16
 *   filas de abajo, verbatim (código + nombre).
 * - Anexo Técnico 1.9 (Res. 000165/2023) §13.2.7.2 «Tributos», que remite la
 *   tabla a `Anexo Tecnico/Tablas Referenciadas`.
 * - Verificación cruzada CONTRA EL TEXTO del anexo 1.9, que sí cita códigos
 *   sueltos dentro de las reglas de validación:
 *     · `cac:TaxScheme/cbc:ID = '01'` (IVA) — reglas FAS/CAS de cuadre de IVA.
 *     · `cac:TaxScheme/cbc:ID = '05'` (ReteIVA) en `cac:WithholdingTaxTotal`.
 *     · `cac:TaxScheme/cbc:ID = '22'` (Bolsas) en la regla de impuesto nominal.
 *     · §11 CUFE: `CodImp1 = 01`, `CodImp2 = 04`, `CodImp3 = 03` — que fija
 *       IVA=01, INC=04, ICA=03 sin ambigüedad, porque son los tres tributos que
 *       entran en el hash del CUFE.
 *
 * PENDIENTE (no verificable con las fuentes disponibles)
 * -----------------------------------------------------
 * El control de cambios de la 1.9 (§2.1) dice: «13.2.2. Tributos; Se incluyen
 * los códigos 32, 33, 34, 35, 36» y «13.3.10 Tablas de tarifas por Impuesto;
 * INPP, IBUA, ICUI, ICL, ADV». Es decir: la 1.9 añade CINCO tributos nuevos
 * — INPP (productos plásticos), IBUA (bebidas azucaradas), ICUI (comestibles
 * ultraprocesados), ICL (consumo de licores) y ADV (ad valorem) — sobre los
 * códigos 32..36. La ASIGNACIÓN código→tributo NO aparece en el texto del anexo
 * (está solo en `Tablas Referenciadas/13.2.2 Tributos.xlsx`, que no viene en el
 * ZIP publicado, el cual es de la v1.8). NO se adivinan aquí: un código de
 * tributo equivocado es un rechazo que quema un consecutivo. Para completarlos,
 * abrir ese .xlsx y añadirlos abajo.
 */

/**
 * Tabla completa de tributos, verbatim de `TipoImpuesto-2.1.gc`.
 * La clave es el código que viaja en `cbc:ID`; el valor, el nombre de `cbc:Name`.
 */
const DIAN_TAX_TABLE = {
  '01': 'IVA',
  '02': 'IC',
  '03': 'ICA',
  '04': 'INC',
  '05': 'ReteIVA',
  '06': 'ReteFuente',
  '07': 'ReteICA',
  '08': 'ReteCREE',
  '20': 'FtoHorticultura',
  '21': 'Timbre',
  '22': 'Bolsas',
  '23': 'INCarbono',
  '24': 'INCombustibles',
  '25': 'Sobretasa Combustibles',
  '26': 'Sordicom',
  /** Comodín «Nombre de la figura tributaria»: el nombre lo pone el emisor. */
  ZZ: 'Nombre de la figura tributaria',
} as const;

/** Unión de los 16 códigos de tributo que la DIAN acepta en `cbc:ID`. */
export type DianTaxSchemeCode = keyof typeof DIAN_TAX_TABLE;

/**
 * Alias legibles de los tributos que Vendix emite hoy.
 *
 * Se conservan los tres nombres históricos (IVA/INC/ICA) porque son los que
 * `resolveTaxCodeFromTax` mapea desde `tax_type`, y se añaden los que el
 * contrato de retenciones ya modela (`retefuente`/`reteiva`/`reteica`) para que
 * el día que se emitan en `cac:WithholdingTaxTotal` no haya que inventar el
 * código en el sitio de uso.
 */
export const DIAN_TAX_CODES = {
  /** IVA — Impuesto al Valor Agregado. */
  IVA: '01',
  /** IC — Impuesto al Consumo (figura distinta del INC). */
  IC: '02',
  /** ICA — Impuesto de Industria y Comercio. */
  ICA: '03',
  /** INC — Impuesto Nacional al Consumo. */
  INC: '04',
  /** Retención de IVA practicada — `cac:WithholdingTaxTotal`. */
  RETE_IVA: '05',
  /** Retención en la fuente — `cac:WithholdingTaxTotal`. */
  RETE_FUENTE: '06',
  /** Retención de ICA — `cac:WithholdingTaxTotal`. */
  RETE_ICA: '07',
  /** Retención CREE (derogada, se conserva porque la lista la mantiene). */
  RETE_CREE: '08',
  /** Fondo de Fomento Hortifrutícola. */
  FTO_HORTICULTURA: '20',
  /** Impuesto de Timbre. */
  TIMBRE: '21',
  /** Impuesto al consumo de bolsas plásticas — tributo NOMINAL (por unidad). */
  BOLSAS: '22',
  /** Impuesto Nacional al Carbono. */
  INC_CARBONO: '23',
  /** Impuesto Nacional a los Combustibles. */
  INC_COMBUSTIBLES: '24',
  /** Sobretasa a los combustibles. */
  SOBRETASA_COMBUSTIBLES: '25',
  /** Contribución Sordicom. */
  SORDICOM: '26',
  /** Comodín: figura tributaria nombrada por el emisor. */
  OTHER: 'ZZ',
} as const satisfies Readonly<Record<string, DianTaxSchemeCode>>;

/**
 * Nombres para `cac:TaxScheme/cbc:Name`.
 *
 * Se declara `Record<string, string>` A PROPÓSITO, no `as const`: los llamadores
 * lo indexan con un `string` calculado (`DIAN_TAX_NAMES[code] || code`), y un
 * objeto `as const` haría fallar esa indexación en compilación. El tipado
 * estricto vive arriba, en `DianTaxSchemeCode`.
 */
export const DIAN_TAX_NAMES: Record<string, string> = DIAN_TAX_TABLE;

/** `true` si el código pertenece a la tabla de tributos de la DIAN. */
export function isDianTaxSchemeCode(
  value: unknown,
): value is DianTaxSchemeCode {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(DIAN_TAX_TABLE, value)
  );
}

/**
 * Tarifas de IVA admitidas en `cac:TaxCategory[TaxScheme/ID='01']/cbc:Percent`.
 *
 * Fuente: `Listas de valores/TarifaImpuestoIVA-2.1.gc` (columnas code/name/
 * description). La DIAN valida la tarifa contra esta lista, así que un 12 % o un
 * 10 % inventados son rechazo, no redondeo.
 *
 * DISCREPANCIA DE FUENTES: el Schematron `DIAN_UBL21-listacodigos_v1.6.sch`
 * (generado en 2019) admite además `20.00` y `35.00`. El `.gc` de la v1.8 —
 * posterior — solo lista las cuatro de abajo. Se toman las cuatro del `.gc` por
 * ser la fuente más reciente de las dos disponibles.
 */
export const DIAN_IVA_RATES = {
  /** Exento / excluido. */
  EXEMPT: '0.00',
  /** Bienes y servicios al 5 %. */
  REDUCED: '5.00',
  /** Contratos firmados con el Estado antes de la Ley 1819. */
  LEGACY_STATE_CONTRACT: '16.00',
  /** Tarifa general. */
  GENERAL: '19.00',
} as const;

export type DianIvaRate = (typeof DIAN_IVA_RATES)[keyof typeof DIAN_IVA_RATES];

/**
 * Alias histórico de `DIAN_IVA_RATES`. Se conserva porque hay código que lo
 * importa por este nombre; la definición es única.
 */
export const COMMON_IVA_RATES = DIAN_IVA_RATES;

/**
 * Tarifas de INC admitidas en `cac:TaxCategory[TaxScheme/ID='04']/cbc:Percent`.
 * Fuente: `Listas de valores/TarifaImpuestoINC-2.1.gc`.
 *
 * DISCREPANCIA DE FUENTES: el Schematron de 2019 solo admitía `8.00` y `4.00`;
 * el `.gc` de la v1.8 añade `2.00` y `16.00`. Manda el `.gc`.
 */
export const DIAN_INC_RATES = {
  /** Tarifa especial 2 %. */
  SPECIAL_2: '2.00',
  /** Tarifa especial 4 % (típica de restaurantes y bares). */
  SPECIAL_4: '4.00',
  /** Tarifa general 8 %. */
  GENERAL: '8.00',
  /** Tarifa especial 16 %. */
  SPECIAL_16: '16.00',
} as const;

export type DianIncRate = (typeof DIAN_INC_RATES)[keyof typeof DIAN_INC_RATES];

/**
 * Única tarifa de ReteIVA admitida en
 * `cac:WithholdingTaxTotal//cac:TaxCategory[TaxScheme/ID='05']/cbc:Percent`.
 * Fuente: `Listas de valores/TarifaImpuestoReteIVA-2.1.gc` (una sola fila).
 *
 * Ojo: es el 15 % DEL IVA de la operación, no del subtotal — el mismo matiz que
 * documenta el skill `vendix-tax-typing` para la base de reteIVA.
 */
export const DIAN_RETE_IVA_RATE = '15.00' as const;

/**
 * Tarifas de retención en la fuente.
 *
 * NO se enumeran aquí. `TarifaImpuestoReteFuente-2.1.gc` trae 40 filas cuya
 * clave real es el CONCEPTO de retención (honorarios, servicios, compras…), no
 * el porcentaje: hay porcentajes repetidos para conceptos distintos (`3.50`
 * aparece 8 veces). Una constante de porcentajes sueltos daría una falsa
 * sensación de validación y no impediría el error que importa — aplicar la
 * tarifa de un concepto a otro. Esa lógica ya vive, con su resolutor puro y sus
 * umbrales en UVT, en `WithholdingResolverService` (skill `vendix-tax-typing`).
 */
