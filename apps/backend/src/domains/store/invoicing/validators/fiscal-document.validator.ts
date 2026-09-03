import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DIAN_DOCUMENT_CURRENCY,
  DOCUMENT_NUMBER_MAX_LENGTH,
  DOCUMENT_NUMBER_PATTERN,
  DianRuleCitation,
  DianRuleKey,
  FiscalDocumentType,
  RESOLUTION_PREFIX_MAX_LENGTH,
  RESOLUTION_RANGE_MAX_DIGITS,
  TECHNICAL_KEY_LENGTHS,
  TECHNICAL_KEY_LENGTHS_LABEL,
  acceptsTechnicalKey,
  dianRuleFor,
  emitsDocumentAllowanceCharge,
  isWellFormedTechnicalKey,
  monetaryTotalElementFor,
  normalizeTechnicalKey,
  requirementsFor,
  requiresAuthorizedRange,
  requiresLines,
  ublRootDocumentFor,
  usesInvoiceOperationTypes,
} from '../fiscal-document-requirements';
import {
  DianNumericInput,
  dianAmount,
  dianArithmetic,
  dianLineExtension,
  dianLineExtensionTotal,
  dianRate,
  dianSum,
  toDecimal,
} from '../utils/dian-money.util';
import {
  DIAN_DEFAULT_UNIT_CODE,
  isDianUnitCode,
} from '../providers/dian-direct/constants/dian-unit-codes';
import { DIAN_TAX_CODES } from '../providers/dian-direct/constants/dian-tax-codes';
import { DIAN_INVOICE_OPERATION_TYPES } from '../providers/dian-direct/constants/dian-document-types';
import { UblCommonBuilder } from '../providers/dian-direct/xml/ubl-common.builder';
import { ProviderInvoiceTax } from '../providers/invoice-provider.interface';
import {
  DEFAULT_STORE_TIMEZONE,
  localDateString,
} from '../../../../common/utils/store-timezone.util';

/**
 * PREVALIDADOR FISCAL DEL DOCUMENTO — rechaza en local lo que la DIAN rechazaría.
 *
 * ## El defecto que cierra
 *
 * Vendix descubría los errores de un documento **después** de firmarlo y
 * transmitirlo, leyéndolos en la respuesta de la DIAN. Para entonces el
 * consecutivo autorizado ya está gastado y no se recupera: no se puede reintentar
 * con el mismo número, y el hueco en la numeración hay que justificarlo. Un
 * rechazo no cuesta un reintento — cuesta un consecutivo.
 *
 * El caso que motivó este archivo: el 14/08/2026 una clave técnica de **38**
 * caracteres (dos perdidos al copiarla, todos hexadecimales, nada a la vista que
 * lo delatara) hizo que la DIAN recomputara el CUFE con la clave verdadera,
 * obtuviera otro hash y rechazara. La ClTec es la ÚNICA entrada del hash que el
 * XML **no transporta**, así que la DIAN es el primer sistema capaz de notar que
 * está mal — a menos que alguien la mire antes. Eso es lo que hace este archivo.
 *
 * ## Qué juzga (y qué NO)
 *
 * Juzga el DOCUMENTO: su aritmética, su numeración y su contenido declarable.
 * NO juzga al adquiriente — de eso se ocupa
 * {@link ../validators/customer-fiscal-identity.validator.ts}, que ya está
 * cableado en la misma puerta. Los dos son complementarios y ninguno repite al
 * otro; juntos son el veredicto completo de `InvoiceFlowService.validate()`.
 *
 * Reglas cubiertas (Anexo Técnico 1.9, Res. DIAN 000165/2023). El identificador
 * de cada una es el que la DIAN devolverá si el documento la incumple, y viaja
 * en `finding.dian_rule` para que un rechazo real se pueda correlacionar con la
 * regla local que debió atajarlo. La tabla vive en
 * `fiscal-document-requirements.ts` → `DIAN_RULES`, resuelta por elemento raíz
 * (`FA*` Invoice · `CA*` CreditNote · `DA*` DebitNote):
 *
 *   1. `FAU02` / `CAU02` / `DAU02` — el `LineExtensionAmount` de cabecera contra
 *      la suma de los importes de línea **ya truncados**, que es lo que la DIAN
 *      recomputa.
 *   2. `FAS07` / `CAS07` / `DAS07` — `TaxAmount = TaxableAmount × Percent/100`
 *      por cada `cac:TaxSubtotal`; y `FAS04` para la colisión de dos tarifas
 *      dentro de un mismo tributo.
 *   3. `FAU14` / `CAU14` / `DAU14` — `PayableAmount = LineExtension − Allowance
 *      + Impuestos`, y —lo crítico— SIN restar `cac:WithholdingTaxTotal`
 *      (§11.9.1) ni `cbc:PrepaidAmount` (§11.9.2).
 *   4. `FAB05a` / `FAB10b` / `FAB11a` / `FAD05d` / `FAD09a` — resolución de
 *      numeración: vigente en la FECHA DE EMISIÓN, con consecutivo disponible y
 *      prefijo coherente con el número que se va a emitir.
 *   5. `FAD06` / `CAD06` / `DAD06` — ClTec presente y de 40 caracteres
 *      hexadecimales cuando el documento la exige. **Es la regla del incidente**:
 *      la DIAN no rechaza «la clave está mal», rechaza «el CUFE no está
 *      calculado correctamente», que es lo que produce una ClTec incompleta.
 *   6. `FAD15a` / `CAD15a` / `DAD15a` — moneda del documento = COP.
 *   7. `FAV05` / `CAV05` / `DAV05` — unidad de medida de cada línea dentro del
 *      catálogo que la DIAN acepta.
 *   8. `FAD02` / `CAD02` / `DAD02` — `CustomizationID` coherente con el contenido
 *      (AIU '09').
 *   9. `FAV01` / `FAV04b` / `FAZ02` — al menos una línea, con cantidad positiva y
 *      descripción.
 *  10. `FAD05a` — el número de documento sólo admite letras y dígitos: ni
 *      espacios, ni guiones. Es el rechazo que produce un prefijo mal capturado,
 *      que hoy entra sin validar (`CreateResolutionDto.prefix` sólo limita
 *      longitud).
 *  11. `VLR01` — ningún importe ni porcentaje del documento puede ser negativo.
 *  12. `FAU08` / `CAU08` / `DAU08` — un `AllowanceTotalAmount` mayor que cero
 *      exige `cac:AllowanceCharge` que lo respalde, y hay tipos de documento cuyo
 *      constructor publica el total sin el grupo.
 *  13. `FAD09e` / `CAD09e` / `DAD09e` — la fecha de emisión debe ser la fecha de
 *      firma. Sólo se juzga cuando quien invoca aporta `signing_date`.
 *
 * ## Lo que NO se hace acá porque YA SE HACE en otro sitio
 *
 * La comprobación estructural contra los `.xsd` de la Caja de Herramientas SÍ
 * existe y no hay que reimplementarla: los 20 esquemas están versionados en
 * `providers/dian-direct/schemas/` y la compuerta corre dentro de
 * `DianDirectProvider.signXml()`, respaldada por
 * `providers/dian-direct/xml/ubl-structure.validator.ts`, que además delega
 * explícitamente en ESTE validador las facetas de tipo simple.
 *
 * El reparto es deliberado y no se debe cruzar: un XSD dice «el elemento X
 * falta» —diagnóstico para quien programa el builder— y estas reglas dicen «el
 * IVA no cuadra y se corrige en tal pantalla» —instrucción para el comerciante—.
 * Además corren en momentos distintos: estas ANTES de asignar consecutivo, el
 * XSD ya sobre el XML armado.
 *
 * ## Forma
 *
 * PURO: sin Prisma, sin AsyncLocalStorage, sin HTTP, sin `Date.now()` implícito.
 * Entra data, sale un veredicto. `@Injectable` solo para poder inyectarlo; se
 * instancia con `new` en un test sin levantar Nest. Traducir un bloqueante a
 * `VendixHttpException` es trabajo de quien lo consume — por eso cada hallazgo
 * declara su {@link FiscalDocumentFindingCategory} en vez de un código HTTP.
 *
 * UNA SOLA PUERTA: las reglas viven acá y nada más las reimplementa. Lo que
 * cambia entre superficies (POS, facturación manual, e-commerce) es qué se
 * captura y qué se hace ante el fallo — nunca la regla.
 */

// -----------------------------------------------------------------------------
// TOLERANCIAS
// -----------------------------------------------------------------------------

/**
 * Un centavo. Es la tolerancia que IMPONE el truncado, no una licencia.
 *
 * El Anexo §11.2 exige importes truncados a 2 decimales (nunca redondeados), así
 * que `base × tarifa` en precisión plena y el importe emitido pueden separarse
 * hasta un centavo por construcción. Más que eso ya no es truncado: es un importe
 * que no se deriva de su base.
 */
const ONE_CENT = new Prisma.Decimal('0.01');

/** Cero exacto en espacio `Decimal`. */
const ZERO = new Prisma.Decimal(0);

/**
 * Códigos que la traducción automática de la DIAN corrompió, y a qué hay que
 * cambiarlos. La lista oficial ejecutable (el `.gc` y el Schematron) contiene el
 * valor CORROMPIDO, así que enviar el código correcto de UN/ECE es lo que la
 * DIAN no reconoce.
 *
 * No se re-deriva la tabla: `dian-unit-codes.ts` es el catálogo, y esto es solo
 * el mapa de sugerencias para que el mensaje diga QUÉ escribir en vez de
 * «unidad desconocida». Ver el aviso completo en aquel archivo.
 */
const CORRUPTED_UNIT_CODE_HINTS: Readonly<Record<string, string>> =
  Object.freeze({
    MON: 'LUN',
    ANN: 'ANA',
    AY: 'SÍ',
    HE: 'ÉL',
    GK: 'G K',
    KMT: 'KTM',
    ON: 'EN',
    AS: 'COMO',
    BE: 'SER',
    NMI: 'MNI',
    SCO: 'OCS',
    STI: 'ITS',
    SW: 'SO',
  });

// -----------------------------------------------------------------------------
// CONTRATO DE ENTRADA
//
// Estructural y NO derivado de Prisma a propósito: la fila real satisface esta
// forma y se pasa tal cual, pero el validador se puede ejercitar con literales en
// un test sin base de datos ni fábricas.
// -----------------------------------------------------------------------------

/** Una línea del documento, con lo que hace falta para juzgar su aritmética. */
export interface FiscalDocumentLineInput {
  /** Número de línea 1-based para los mensajes. Si falta se usa el índice. */
  line_number?: number | null;
  description?: string | null;
  quantity?: DianNumericInput;
  unit_price?: DianNumericInput;
  discount_amount?: DianNumericInput;
  /** `products.price_unit_quantity`: a cuántas unidades corresponde el precio. */
  price_unit_quantity?: DianNumericInput;
  tax_amount?: DianNumericInput;
  /** Código UN/ECE que se va a emitir. `null` ⇒ el emisor caerá a `EA`. */
  unit_code?: string | null;
  /** `administracion` | `imprevistos` | `utilidad`, o `null` si no es AIU. */
  aiu_component?: string | null;
}

/** Una fila de `invoice_taxes` — futuro `cac:TaxSubtotal`. */
export interface FiscalDocumentTaxInput {
  tax_name?: string | null;
  /** Clasificación persistida (`iva` | `inc` | `ica` | `withholding` | …). */
  tax_type?: string | null;
  /** Tarifa TAL COMO SE GUARDA: el ICA va por mil, todo lo demás en porcentaje. */
  tax_rate?: DianNumericInput;
  taxable_amount?: DianNumericInput;
  tax_amount?: DianNumericInput;
}

/** Lo que el prevalidador necesita de la fila `invoice_resolutions`. */
export interface FiscalDocumentResolutionInput {
  id?: number | null;
  resolution_number?: string | null;
  prefix?: string | null;
  range_from?: number | null;
  range_to?: number | null;
  /** Último consecutivo consumido. `0` = todavía no se emitió ninguno. */
  current_number?: number | null;
  valid_from?: Date | string | null;
  valid_to?: Date | string | null;
  is_active?: boolean | null;
  technical_key?: string | null;
}

/** El documento completo, tal como se va a emitir. */
export interface FiscalDocumentValidationInput {
  document_type: FiscalDocumentType;
  /** Consecutivo ya asignado (`FE-1234`). */
  invoice_number?: string | null;
  /** Fecha de emisión. Es CONTRA ESTA que se juzga la vigencia del rango. */
  issue_date?: Date | string | null;
  /**
   * Instante en que se va a FIRMAR el documento — `ds:SigningTime`.
   *
   * OPCIONAL A PROPÓSITO, y ya NO dormido en toda la cadena. `FAD09e` exige que
   * `cbc:IssueDate` sea igual a la fecha de firma, y Vendix puede violarla sin
   * que nada lo note: un borrador creado el viernes y transmitido el lunes
   * declara la fecha del viernes y se firma el lunes.
   *
   * `InvoiceFlowService.validate()` sigue sin aportarlo: ese método corre ANTES
   * de que exista un momento de firma real, y asumir «ahora» ahí sería
   * falsificar la evidencia y bloquear documentos legítimos (borrador validado
   * hoy, transmitido después). `InvoiceFlowService.send()` SÍ lo aporta —con
   * `new Date()`— en el único punto donde revalida antes de reenviar un
   * documento `rejected`: ahí «ahora» ya no es una invención, es literalmente
   * el instante en que el proveedor va a firmar segundos después. Sin el campo
   * la regla no se juzga; con él se juzga exacta.
   */
  signing_date?: Date | string | null;
  /**
   * Zona del emisor, para resolver el DÍA CIVIL de `issue_date`.
   *
   * `issue_date` es un instante y la vigencia de la resolución son fechas-sólo:
   * sin la zona, una factura hecha a las 19:00 en Bogotá el último día de
   * vigencia cae en el día siguiente en UTC y se rechazaría estando bien.
   * Ausente ⇒ `America/Bogota`, que es donde está todo emisor de factura
   * electrónica colombiana.
   */
  timezone?: string | null;
  /** `invoices.currency`. */
  currency?: string | null;
  /** `invoices.operation_type` — el `cbc:CustomizationID`. */
  operation_type?: string | null;
  /** Cabecera persistida: base gravable declarada. */
  subtotal_amount?: DianNumericInput;
  /** Descuento total declarado en la cabecera (líneas + pie). */
  discount_amount?: DianNumericInput;
  /** Impuesto total declarado en la cabecera. */
  tax_amount?: DianNumericInput;
  /** Retención acumulada. Informativa: NUNCA resta del total (§11.9.1). */
  withholding_amount?: DianNumericInput;
  /**
   * Anticipo (`cbc:PrepaidAmount`). Informativo: tampoco resta (§11.9.2).
   * Hoy no hay columna en `invoices`; queda en el contrato para el día que la
   * haya, y para que la regla exista antes que el campo.
   */
  prepaid_amount?: DianNumericInput;
  /** Total declarado = `ValTot` del CUFE = `cbc:PayableAmount`. */
  total_amount?: DianNumericInput;
  items?: FiscalDocumentLineInput[] | null;
  taxes?: FiscalDocumentTaxInput[] | null;
  resolution?: FiscalDocumentResolutionInput | null;
}

// -----------------------------------------------------------------------------
// CONTRATO DE SALIDA
// -----------------------------------------------------------------------------

export type FiscalDocumentSeverity = 'blocker' | 'warning';

/**
 * Familia del hallazgo. Determina QUÉ SE VA A CORREGIR y, por tanto, con qué
 * `ErrorCodes` lo traduce quien lo consume. Se declara acá —y no el código
 * HTTP— para que el validador siga sin conocer la capa de transporte.
 */
export type FiscalDocumentFindingCategory =
  /** La aritmética del documento no cuadra: FAU14, TaxSubtotal, PayableAmount. */
  | 'arithmetic'
  /** La resolución no respalda el número que se va a emitir. */
  | 'resolution'
  /** La clave técnica (ClTec) falta o no tiene la forma que emite la DIAN. */
  | 'technical_key'
  /** El contenido declarable: moneda, unidades, líneas, CustomizationID. */
  | 'content';

/** Código estable de hallazgo, para que la UI mapee sin parsear texto. */
export type FiscalDocumentFindingCode =
  // Contenido del documento
  | 'NO_LINES'
  | 'LINE_QUANTITY_NOT_POSITIVE'
  | 'LINE_DESCRIPTION_REQUIRED'
  | 'LINE_UNIT_CODE_UNKNOWN'
  | 'LINE_UNIT_CODE_MISSING'
  | 'LINE_AMOUNT_NEGATIVE'
  | 'CURRENCY_NOT_COP'
  | 'CURRENCY_MISSING'
  | 'OPERATION_TYPE_UNKNOWN'
  | 'AIU_WITHOUT_OPERATION_TYPE'
  | 'OPERATION_TYPE_AIU_WITHOUT_LINES'
  | 'NEGATIVE_MONETARY_VALUE'
  | 'ISSUE_DATE_AFTER_SIGNING_DATE'
  // Aritmética
  | 'ALLOWANCE_TOTAL_UNBACKED'
  | 'HEADER_LINE_EXTENSION_MISMATCH'
  | 'HEADER_TAX_TOTAL_MISMATCH'
  | 'TAX_SUBTOTAL_MISMATCH'
  | 'TAX_SCHEME_RATE_COLLISION'
  | 'TAX_RATE_MISSING'
  | 'TAX_ROW_IS_WITHHOLDING'
  | 'PAYABLE_AMOUNT_MISMATCH'
  | 'PAYABLE_NETS_WITHHOLDING'
  | 'PAYABLE_NETS_PREPAID'
  // Numeración
  | 'RESOLUTION_MISSING'
  | 'RESOLUTION_INACTIVE'
  | 'RESOLUTION_NUMBER_MISSING'
  | 'RESOLUTION_PREFIX_MISSING'
  | 'RESOLUTION_VALIDITY_WINDOW_INVALID'
  | 'RESOLUTION_NOT_VALID_AT_ISSUE_DATE'
  | 'RESOLUTION_RANGE_INVALID'
  | 'RESOLUTION_RANGE_EXHAUSTED'
  | 'RESOLUTION_PREFIX_TOO_LONG'
  | 'RESOLUTION_PREFIX_NOT_ALPHANUMERIC'
  | 'RESOLUTION_RANGE_TOO_MANY_DIGITS'
  | 'DOCUMENT_NUMBER_PREFIX_MISMATCH'
  | 'DOCUMENT_NUMBER_OUT_OF_RANGE'
  | 'DOCUMENT_NUMBER_MISSING'
  | 'DOCUMENT_NUMBER_NOT_ALPHANUMERIC'
  | 'DOCUMENT_NUMBER_TOO_LONG'
  // Clave técnica
  | 'TECHNICAL_KEY_REQUIRED'
  | 'TECHNICAL_KEY_MALFORMED'
  | 'TECHNICAL_KEY_NOT_APPLICABLE';

/**
 * Un hallazgo. `problem` dice QUÉ está mal y por qué la DIAN lo rechaza; `fix`
 * dice CÓMO se corrige y DÓNDE. Un bloqueante sin `fix` deja al operador parado
 * frente al formulario sin saber qué tocar, así que ambos son obligatorios.
 */
export interface FiscalDocumentFinding {
  code: FiscalDocumentFindingCode;
  severity: FiscalDocumentSeverity;
  category: FiscalDocumentFindingCategory;
  /** Campo o elemento al que apunta el hallazgo. */
  field: string;
  problem: string;
  fix: string;
  /**
   * La regla oficial del Anexo 1.9 que este hallazgo anticipa: identificador que
   * la DIAN devolverá, su mensaje literal y su XPath.
   *
   * `null` cuando el hallazgo es POLÍTICA DE VENDIX y no una regla del anexo
   * (por ejemplo `TAX_ROW_IS_WITHHOLDING`: la DIAN no la rechaza porque el dato
   * ni siquiera viaja), o cuando el anexo no publica la regla para el elemento
   * raíz de este documento. Las dos son respuestas honestas; inventar un
   * identificador para no dejar el campo vacío haría inútil el diccionario.
   *
   * Lo pone {@link FiscalDocumentValidator.annotate} desde una sola tabla, para
   * que la correlación se pueda auditar en un sitio en vez de en 40 literales.
   */
  dian_rule?: DianRuleCitation | null;
  /** Datos seguros para el cliente. NUNCA un secreto fiscal. */
  details?: Record<string, unknown>;
}

/**
 * CÓDIGO LOCAL → REGLA OFICIAL. El diccionario que faltaba.
 *
 * Cuando la DIAN devuelva `FAU02`, esta tabla dice qué hallazgo local debió
 * atajarlo; cuando un hallazgo local bloquee, dice qué rechazo evitó. Se lee en
 * las dos direcciones y por eso está completa: un código ausente de aquí es un
 * código sin cita, y eso debe ser una decisión explícita, no un olvido.
 *
 * Los códigos deliberadamente AUSENTES, con su motivo:
 *
 *  · `TAX_ROW_IS_WITHHOLDING` — el emisor descarta la fila antes de escribir el
 *    XML, así que la DIAN nunca la ve y no hay regla que citar. Es un aviso de
 *    captura, no la anticipación de un rechazo.
 *  · `RESOLUTION_INACTIVE` — «activa/inactiva» es un estado de Vendix. El anexo
 *    no conoce el concepto: para la DIAN la resolución existe o no.
 *  · `TECHNICAL_KEY_NOT_APPLICABLE` — sobra un dato que no viaja. Sin rechazo
 *    posible, sin regla.
 */
const FINDING_RULE_KEYS: Readonly<
  Partial<Record<FiscalDocumentFindingCode, DianRuleKey>>
> = Object.freeze({
  // Contenido
  NO_LINES: 'line_group_required',
  LINE_QUANTITY_NOT_POSITIVE: 'line_quantity_positive',
  LINE_DESCRIPTION_REQUIRED: 'line_description',
  LINE_UNIT_CODE_UNKNOWN: 'line_unit_code',
  LINE_UNIT_CODE_MISSING: 'line_unit_code',
  LINE_AMOUNT_NEGATIVE: 'positive_monetary_values',
  NEGATIVE_MONETARY_VALUE: 'positive_monetary_values',
  CURRENCY_NOT_COP: 'document_currency',
  CURRENCY_MISSING: 'document_currency',
  OPERATION_TYPE_UNKNOWN: 'operation_type',
  AIU_WITHOUT_OPERATION_TYPE: 'operation_type',
  OPERATION_TYPE_AIU_WITHOUT_LINES: 'operation_type',
  ISSUE_DATE_AFTER_SIGNING_DATE: 'issue_date_equals_signing_date',
  // Aritmética
  ALLOWANCE_TOTAL_UNBACKED: 'allowance_total_backed',
  HEADER_LINE_EXTENSION_MISMATCH: 'header_line_extension',
  HEADER_TAX_TOTAL_MISMATCH: 'header_tax_inclusive',
  TAX_SUBTOTAL_MISMATCH: 'tax_subtotal_amount',
  TAX_RATE_MISSING: 'tax_subtotal_amount',
  TAX_SCHEME_RATE_COLLISION: 'tax_subtotal_per_rate',
  PAYABLE_AMOUNT_MISMATCH: 'payable_amount',
  PAYABLE_NETS_WITHHOLDING: 'payable_amount',
  PAYABLE_NETS_PREPAID: 'payable_amount',
  // Numeración
  RESOLUTION_MISSING: 'authorization_number',
  RESOLUTION_NUMBER_MISSING: 'authorization_number',
  RESOLUTION_PREFIX_MISSING: 'authorization_prefix',
  RESOLUTION_PREFIX_TOO_LONG: 'authorization_prefix_length',
  RESOLUTION_PREFIX_NOT_ALPHANUMERIC: 'document_number_format',
  RESOLUTION_RANGE_TOO_MANY_DIGITS: 'authorization_range_digits',
  RESOLUTION_VALIDITY_WINDOW_INVALID: 'issue_date_within_authorization',
  RESOLUTION_NOT_VALID_AT_ISSUE_DATE: 'issue_date_within_authorization',
  RESOLUTION_RANGE_INVALID: 'authorization_range_bounds',
  RESOLUTION_RANGE_EXHAUSTED: 'document_number_within_range',
  DOCUMENT_NUMBER_PREFIX_MISMATCH: 'authorization_prefix',
  DOCUMENT_NUMBER_OUT_OF_RANGE: 'document_number_within_range',
  DOCUMENT_NUMBER_MISSING: 'document_number_length',
  DOCUMENT_NUMBER_NOT_ALPHANUMERIC: 'document_number_format',
  DOCUMENT_NUMBER_TOO_LONG: 'document_number_length',
  // Clave técnica — el rechazo NO se llama «clave mal copiada»: se llama «el
  // CUFE no está calculado correctamente», que es lo que la clave mala produce.
  TECHNICAL_KEY_REQUIRED: 'unique_code_calculation',
  TECHNICAL_KEY_MALFORMED: 'unique_code_calculation',
});

/**
 * Los importes que el documento REALMENTE va a emitir, recomputados con las
 * mismas funciones que los escriben en el XML.
 *
 * Se devuelven siempre (también con bloqueantes) porque son el diagnóstico: la
 * diferencia entre lo declarado y esto es literalmente el error.
 */
export interface FiscalDocumentComputedTotals {
  /** `cac:…MonetaryTotal/cbc:LineExtensionAmount` — suma de líneas truncadas. */
  line_extension_amount: string;
  /** Descuento de PIE, el único que da lugar a un `AllowanceCharge` de documento. */
  allowance_total_amount: string;
  /** Σ de los `tax_amount` de las filas de impuesto. */
  tax_total_amount: string;
  /** `cbc:TaxInclusiveAmount` = línea + impuestos. */
  tax_inclusive_amount: string;
  /** `cbc:PayableAmount` = inclusive − allowance. Sin retención ni anticipo. */
  payable_amount: string;
  /** Nombre UBL del grupo donde viajan, o `null` si el documento no lo lleva. */
  monetary_total_element:
    | 'LegalMonetaryTotal'
    | 'RequestedMonetaryTotal'
    | null;
}

/** Veredicto completo sobre un documento fiscal. */
export interface FiscalDocumentReport {
  /** `true` cuando no hay ningún hallazgo bloqueante. */
  emittable: boolean;
  document_type: FiscalDocumentType;
  findings: FiscalDocumentFinding[];
  blockers: FiscalDocumentFinding[];
  warnings: FiscalDocumentFinding[];
  computed: FiscalDocumentComputedTotals;
}

// -----------------------------------------------------------------------------
// RÓTULOS DE PANTALLA
//
// «TaxSubtotal no cuadra» obliga al comerciante a adivinar dónde se arregla.
// Estos rótulos existen para que cada `fix` termine nombrando el clic exacto.
// -----------------------------------------------------------------------------

const SCREEN_DOCUMENT_LINES =
  'Facturación → abre el documento → pestaña «Líneas»';
const SCREEN_DOCUMENT_HEADER =
  'Facturación → abre el documento → cabecera (moneda, tipo de operación, totales)';
const SCREEN_RESOLUTIONS =
  'Facturación → Resoluciones → abre la resolución del tipo de documento';
const SCREEN_PRODUCT_UOM =
  'Productos → abre el producto → pestaña «Unidades de medida»';

/**
 * Tipos que declaran `requires_authorized_range: true` pero cuyo bloque
 * `sts:InvoiceControl` el emisor NO transmite.
 *
 * La fuente de esta lista es `invoice-flow.service.ts` → `isSupportDocumentType`,
 * que es el sitio donde `send()` decide omitir el bloque. Si esa condición
 * cambia, ESTA constante tiene que cambiar con ella — están acopladas por el
 * comportamiento real de la transmisión, no por la tabla de requisitos.
 *
 * `support_adjustment_note` y `purchase_invoice` no aparecen aquí porque ya
 * declaran `requires_authorized_range: false`: nunca llegan a estas reglas.
 *
 * Ver `softenWhenControlBlockIsNotTransmitted` para la contradicción de fondo.
 */
const DOCUMENTS_WITHOUT_TRANSMITTED_CONTROL: ReadonlySet<FiscalDocumentType> =
  new Set<FiscalDocumentType>(['support_document']);

// -----------------------------------------------------------------------------
// EL VALIDADOR
// -----------------------------------------------------------------------------

@Injectable()
export class FiscalDocumentValidator {
  /**
   * Juzga un documento y devuelve TODOS los hallazgos.
   *
   * No lanza y no devuelve un booleano: un booleano obliga a quien lo consume a
   * redactar el mensaje, y ahí es donde se pierde la instrucción de corrección.
   */
  validate(input: FiscalDocumentValidationInput): FiscalDocumentReport {
    const findings: FiscalDocumentFinding[] = [];
    const requirements = requirementsFor(input.document_type);
    const items = input.items ?? [];
    const taxes = input.taxes ?? [];

    // Los importes EMITIDOS, no los declarados. Se calculan una sola vez y con
    // las mismas funciones del builder UBL: si el prevalidador recomputara con
    // aritmética propia, aprobaría documentos que el emisor escribe distinto —
    // que es la clase de divergencia que este archivo existe para cerrar.
    const computed = this.computeTotals(input, items, taxes);

    findings.push(...this.checkContent(input, items, requirements.label));
    findings.push(...this.checkCurrency(input));
    findings.push(...this.checkOperationType(input, items));
    findings.push(...this.checkPositiveValues(input, items, taxes));
    findings.push(...this.checkSigningDate(input, requirements.label));
    findings.push(...this.checkTaxSubtotals(taxes));
    findings.push(...this.checkArithmetic(input, computed));
    findings.push(...this.checkResolution(input));
    findings.push(...this.checkDocumentNumberShape(input));
    findings.push(...this.checkTechnicalKey(input));

    return this.buildReport(
      input.document_type,
      findings.map((finding) => this.annotate(finding, input.document_type)),
      computed,
    );
  }

  /**
   * Cuelga del hallazgo la regla oficial que anticipa, resolviéndola por el
   * elemento raíz del documento.
   *
   * Se hace en UNA pasada al final y no dentro de cada comprobación a propósito:
   * las comprobaciones no tienen por qué conocer el tipo de documento —varias
   * reciben sólo las líneas o sólo los impuestos—, y una anotación esparcida por
   * 40 literales es exactamente la clase de correlación que se degrada en cuanto
   * alguien añade una regla y olvida la cita.
   */
  private annotate(
    finding: FiscalDocumentFinding,
    document_type: FiscalDocumentType,
  ): FiscalDocumentFinding {
    const key = FINDING_RULE_KEYS[finding.code];
    return { ...finding, dian_rule: key ? dianRuleFor(key, document_type) : null };
  }

  // ---------------------------------------------------------------------------
  // IMPORTES EMITIDOS
  // ---------------------------------------------------------------------------

  /**
   * Recomputa lo que el XML va a declarar, con las MISMAS funciones que lo
   * escriben (`dianLineExtensionTotal`, `dianSum`, `dianArithmetic`).
   *
   * El descuento de documento se deriva igual que `UblCommonBuilder`: es el
   * remanente del descuento de cabecera que las líneas no representan, y nunca
   * es negativo (la verdad de línea gana, y la DIAN rechaza un allowance
   * negativo).
   */
  private computeTotals(
    input: FiscalDocumentValidationInput,
    items: FiscalDocumentLineInput[],
    taxes: FiscalDocumentTaxInput[],
  ): FiscalDocumentComputedTotals {
    const line_extension_amount = dianLineExtensionTotal(
      items.map((item) => ({
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount,
        price_unit_quantity: item.price_unit_quantity,
      })),
    );

    const line_discounts = dianSum(items.map((item) => item.discount_amount));
    const remainder = toDecimal(input.discount_amount).minus(
      toDecimal(line_discounts),
    );
    const allowance_total_amount = remainder.isNegative()
      ? dianAmount(0)
      : dianAmount(remainder);

    // `cac:TaxTotal/cbc:TaxAmount` sale de las FILAS de impuesto, no de
    // `invoices.tax_amount`. Que los dos puedan diferir es justamente lo que
    // `HEADER_TAX_TOTAL_MISMATCH` denuncia.
    //
    // Se suman las filas que el emisor EMITE, no todas las persistidas: las
    // retenciones que el camino legacy de `dto.taxes[]` pudo dejar en
    // `invoice_taxes` se descartan ANTES de llegar al constructor XML, en
    // `invoice-flow.service.ts:2217`
    // (`.filter((tax) => !UblCommonBuilder.isWithholdingTax(tax))`).
    //
    // OJO CON DÓNDE OCURRE: NO lo hace `buildTaxTotals` —así lo afirmaba este
    // comentario, citando una línea que ya no existe—. Ese método suma TODAS las
    // filas que recibe (`ubl-common.builder.ts:1307`), así que quien filtra es
    // el flujo y sólo el flujo. Si alguien pasara `invoice_taxes` directo al
    // constructor sin ese filtro, la retención entraría a `cac:TaxTotal` y ESTE
    // cálculo dejaría de reflejar el XML.
    //
    // Sumarlas acá haría que este total nunca coincidiera con el del XML, y el
    // desajuste se leería en las dos direcciones: bloquearía documentos sanos
    // cuya cabecera —con razón— no cuenta la retención, y aprobaría el caso
    // contrario, que sí lo rechaza la DIAN. El validador tiene que sumar lo
    // mismo que suma el XML.
    const tax_total_amount = dianSum(
      taxes
        .filter((tax) => !this.isWithholdingRow(tax))
        .map((tax) => tax.tax_amount),
    );

    // `TaxInclusiveAmount` usa el impuesto DECLARADO en la cabecera, porque es lo
    // que `buildMonetaryTotal` recibe. Reproducirlo con la suma de las filas
    // ocultaría el descuadre en vez de reportarlo.
    const tax_inclusive_amount = dianArithmetic([
      { value: line_extension_amount, sign: 1 },
      { value: input.tax_amount, sign: 1 },
    ]);

    const payable_amount = dianArithmetic([
      { value: tax_inclusive_amount, sign: 1 },
      { value: allowance_total_amount, sign: -1 },
    ]);

    return {
      line_extension_amount,
      allowance_total_amount,
      tax_total_amount,
      tax_inclusive_amount,
      payable_amount,
      monetary_total_element: monetaryTotalElementFor(input.document_type),
    };
  }

  // ---------------------------------------------------------------------------
  // 1. CONTENIDO: LÍNEAS, CANTIDADES, DESCRIPCIONES, UNIDADES
  // ---------------------------------------------------------------------------

  private checkContent(
    input: FiscalDocumentValidationInput,
    items: FiscalDocumentLineInput[],
    label: string,
  ): FiscalDocumentFinding[] {
    const findings: FiscalDocumentFinding[] = [];

    if (!requiresLines(input.document_type)) return findings;

    if (items.length === 0) {
      findings.push({
        code: 'NO_LINES',
        severity: 'blocker',
        category: 'content',
        field: 'items',
        problem: `${label} no tiene ninguna línea. Un documento sin líneas declara una operación de cero pesos, y la DIAN exige al menos un grupo de línea con su importe y su unidad.`,
        fix: `Agrega al menos un producto o servicio en ${SCREEN_DOCUMENT_LINES}.`,
      });
      // Sin líneas no hay nada más que juzgar de las líneas: seguir emitiría
      // «falta la unidad», «falta la descripción» y «la cantidad no es positiva»
      // sobre un vacío, enterrando el único mensaje que explica lo que pasa.
      return findings;
    }

    items.forEach((item, index) => {
      const line = this.lineLabel(item, index);
      const quantity = toDecimal(item.quantity);

      if (!quantity.greaterThan(ZERO)) {
        findings.push({
          code: 'LINE_QUANTITY_NOT_POSITIVE',
          severity: 'blocker',
          category: 'content',
          field: `items[${index}].quantity`,
          problem: `${line} declara una cantidad de ${dianAmount(item.quantity)}. La DIAN valida la coherencia entre cantidad, unidad e importe: una cantidad cero o negativa produce un importe de línea que no se corresponde con la operación.`,
          fix: `Corrige la cantidad de la línea en ${SCREEN_DOCUMENT_LINES}. Para devolver o anular lo facturado se emite una nota crédito, no una línea negativa.`,
          details: { line_number: index + 1 },
        });
      }

      if (!(item.description ?? '').trim()) {
        findings.push({
          code: 'LINE_DESCRIPTION_REQUIRED',
          severity: 'blocker',
          category: 'content',
          field: `items[${index}].description`,
          problem: `${line} no tiene descripción. Es el \`cbc:Description\` del ítem, obligatorio en toda línea, y es lo único que le dice al adquiriente qué compró.`,
          fix: `Escribe la descripción de la línea en ${SCREEN_DOCUMENT_LINES}.`,
          details: { line_number: index + 1 },
        });
      }

      const line_amount = toDecimal(
        dianLineExtension({
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_amount: item.discount_amount,
          price_unit_quantity: item.price_unit_quantity,
        }),
      );
      if (line_amount.isNegative()) {
        findings.push({
          code: 'LINE_AMOUNT_NEGATIVE',
          severity: 'blocker',
          category: 'content',
          field: `items[${index}].discount_amount`,
          problem: `${line} tiene un importe neto de ${dianAmount(line_amount)}: el descuento supera al precio por la cantidad. La DIAN rechaza un \`cbc:LineExtensionAmount\` negativo, y ese importe además entra a la suma de la cabecera y al ValFac del CUFE.`,
          fix: `Baja el descuento de la línea o sube su precio en ${SCREEN_DOCUMENT_LINES}.`,
          details: {
            line_number: index + 1,
            line_extension_amount: dianAmount(line_amount),
          },
        });
      }

      findings.push(...this.checkUnitCode(item, index, line));
    });

    return findings;
  }

  /**
   * Unidad de medida de la línea.
   *
   * DOS SEVERIDADES DISTINTAS, y la diferencia es la regla de siempre: una
   * unidad AUSENTE hace que el emisor declare `EA` («cada»), que en una línea
   * libre sin producto es la unidad correcta — el documento no afirma nada
   * falso. Una unidad DECLARADA fuera del catálogo la sustituye `toDianUnitCode`
   * por `EA` en silencio, y ahí sí: 3 metros salen declarados como «3 unidades».
   */
  private checkUnitCode(
    item: FiscalDocumentLineInput,
    index: number,
    line: string,
  ): FiscalDocumentFinding[] {
    const declared = (item.unit_code ?? '').trim();

    if (!declared) {
      return [
        {
          code: 'LINE_UNIT_CODE_MISSING',
          severity: 'warning',
          category: 'content',
          field: `items[${index}].unit_code`,
          problem: `${line} no declara unidad de medida, así que se emitirá como «${DIAN_DEFAULT_UNIT_CODE}» (cada). Si lo que se vendió se mide en metros, kilos o litros, el documento estará declarando unidades sueltas.`,
          fix: `Si la línea corresponde a un producto medible, asígnale su unidad de stock en ${SCREEN_PRODUCT_UOM}. Si es una línea libre por pieza, «cada» es correcto y no hay nada que corregir.`,
          details: { line_number: index + 1 },
        },
      ];
    }

    if (isDianUnitCode(declared)) return [];

    // La lista ejecutable de la DIAN está corrompida por traducción automática:
    // acepta `LUN`, `ANA`, `SÍ`, `ÉL`, `G K`, `KTM` y RECHAZA los correctos de
    // UN/ECE. Si el operador escribió el código correcto, el mensaje tiene que
    // decirle cuál es el corrompido — «unidad desconocida» a secas lo mandaría a
    // buscar en la rec. 20, donde su código sí existe.
    const hint = CORRUPTED_UNIT_CODE_HINTS[declared.toUpperCase()];

    return [
      {
        code: 'LINE_UNIT_CODE_UNKNOWN',
        severity: 'blocker',
        category: 'content',
        field: `items[${index}].unit_code`,
        problem: hint
          ? `${line} declara la unidad «${declared}», que es el código correcto de UN/ECE pero NO el que la DIAN acepta: su lista de valores se publicó traducida automáticamente y el traductor cambió también los códigos. Emitido así, se sustituye por «${DIAN_DEFAULT_UNIT_CODE}» y el documento declara unidades sueltas.`
          : `${line} declara la unidad «${declared}», que no pertenece a la lista de unidades de medida de la DIAN. Al emitir se sustituye por «${DIAN_DEFAULT_UNIT_CODE}» en silencio, así que el documento diría «${dianAmount(item.quantity)} unidades» en vez de la magnitud real.`,
        fix: hint
          ? `Usa «${hint}» en lugar de «${declared}»: es el mismo concepto, con el código que la lista de la DIAN sí contiene. Se configura en ${SCREEN_PRODUCT_UOM}.`
          : `Corrige la unidad del producto en ${SCREEN_PRODUCT_UOM} eligiendo una del catálogo (por ejemplo MTR metro, KGM kilogramo, LTR litro, EA cada).`,
        details: {
          line_number: index + 1,
          unit_code: declared,
          ...(hint ? { suggested_unit_code: hint } : {}),
        },
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // 2. MONEDA
  // ---------------------------------------------------------------------------

  private checkCurrency(
    input: FiscalDocumentValidationInput,
  ): FiscalDocumentFinding[] {
    const declared = (input.currency ?? '').trim().toUpperCase();

    if (!declared) {
      return [
        {
          code: 'CURRENCY_MISSING',
          severity: 'warning',
          category: 'content',
          field: 'currency',
          problem: `El documento no declara moneda, así que se emitirá en ${DIAN_DOCUMENT_CURRENCY}. Es lo correcto para la facturación electrónica colombiana, pero conviene que esté declarado y no asumido.`,
          fix: `Declara la moneda ${DIAN_DOCUMENT_CURRENCY} en ${SCREEN_DOCUMENT_HEADER}.`,
        },
      ];
    }

    if (declared === DIAN_DOCUMENT_CURRENCY) return [];

    return [
      {
        code: 'CURRENCY_NOT_COP',
        severity: 'blocker',
        category: 'content',
        field: 'currency',
        problem: `El documento declara la moneda «${declared}». La factura electrónica colombiana se declara en ${DIAN_DOCUMENT_CURRENCY}: \`cbc:DocumentCurrencyCode\` gobierna el \`@currencyID\` de TODOS los importes, así que emitirlo en otra divisa afirma que cada valor del documento está en esa divisa cuando son pesos.`,
        fix: `Cambia la moneda del documento a ${DIAN_DOCUMENT_CURRENCY} en ${SCREEN_DOCUMENT_HEADER}. Si la operación es en divisa, se declara aparte (moneda alternativa y tasa de cambio); eso no cambia la moneda del documento.`,
        details: { currency: declared },
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // 3. `CustomizationID` COHERENTE CON EL CONTENIDO (AIU)
  // ---------------------------------------------------------------------------

  /**
   * El tipo de operación y las líneas tienen que decir lo mismo, en las DOS
   * direcciones.
   *
   * En el régimen AIU la base gravable del IVA no es el valor del contrato: es el
   * AIU (E.T. 462-1) o solo la utilidad (Dcto. 1372/1992). Declarar '09' sin
   * líneas AIU pide una base que no existe; marcar líneas AIU sin declarar '09'
   * hace que la DIAN calcule el IVA sobre el contrato completo. Ninguna de las
   * dos es un detalle de presentación: cambian el impuesto.
   */
  private checkOperationType(
    input: FiscalDocumentValidationInput,
    items: FiscalDocumentLineInput[],
  ): FiscalDocumentFinding[] {
    const findings: FiscalDocumentFinding[] = [];
    const declared = (input.operation_type ?? '').trim();
    const aiu_lines = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !!(item.aiu_component ?? '').trim());

    if (
      declared &&
      usesInvoiceOperationTypes(input.document_type) &&
      !(Object.values(DIAN_INVOICE_OPERATION_TYPES) as string[]).includes(
        declared,
      )
    ) {
      findings.push({
        code: 'OPERATION_TYPE_UNKNOWN',
        severity: 'blocker',
        category: 'content',
        field: 'operation_type',
        problem: `El tipo de operación «${declared}» no pertenece a la lista de tipos de operación de factura. Es una lista CERRADA: la regla FAD02 rechaza el documento «si contiene un valor distinto a los definidos en el grupo», y el consecutivo se pierde.`,
        fix: `Elige un tipo de operación válido en ${SCREEN_DOCUMENT_HEADER}: ${Object.entries(
          DIAN_INVOICE_OPERATION_TYPES,
        )
          .map(([name, code]) => `${code} (${name.toLowerCase()})`)
          .join(', ')}.`,
        details: { operation_type: declared },
      });
    }

    if (
      declared === DIAN_INVOICE_OPERATION_TYPES.AIU &&
      aiu_lines.length === 0
    ) {
      findings.push({
        code: 'OPERATION_TYPE_AIU_WITHOUT_LINES',
        severity: 'blocker',
        category: 'content',
        field: 'operation_type',
        problem: `El documento declara el tipo de operación ${DIAN_INVOICE_OPERATION_TYPES.AIU} (AIU) pero ninguna de sus líneas dice a qué componente pertenece (Administración, Imprevistos o Utilidad). En AIU la base gravable del IVA no es el valor del contrato, y sin ese marcado no hay de dónde derivarla.`,
        fix: `Marca el componente AIU de cada línea en ${SCREEN_DOCUMENT_LINES}, o cambia el tipo de operación a ${DIAN_INVOICE_OPERATION_TYPES.STANDARD} (estándar) en ${SCREEN_DOCUMENT_HEADER} si el contrato no es AIU.`,
      });
    }

    if (aiu_lines.length > 0 && declared !== DIAN_INVOICE_OPERATION_TYPES.AIU) {
      findings.push({
        code: 'AIU_WITHOUT_OPERATION_TYPE',
        severity: 'blocker',
        category: 'content',
        field: 'operation_type',
        problem: `${aiu_lines.length === 1 ? 'Una línea declara' : `${aiu_lines.length} líneas declaran`} componente AIU, pero el documento declara el tipo de operación «${declared || 'sin declarar'}». La DIAN solo aplica la base gravable especial del AIU cuando el documento se identifica como ${DIAN_INVOICE_OPERATION_TYPES.AIU}: tal como está, liquidaría el IVA sobre el valor completo del contrato.`,
        fix: `Declara el tipo de operación ${DIAN_INVOICE_OPERATION_TYPES.AIU} (AIU) en ${SCREEN_DOCUMENT_HEADER}, o quita el componente AIU de las líneas en ${SCREEN_DOCUMENT_LINES} si el contrato no está en ese régimen.`,
        details: {
          operation_type: declared || null,
          aiu_line_numbers: aiu_lines.map(({ index }) => index + 1),
        },
      });
    }

    return findings;
  }

  // ---------------------------------------------------------------------------
  // 3b. `VLR01` — NINGÚN IMPORTE NI PORCENTAJE PUEDE SER NEGATIVO
  // ---------------------------------------------------------------------------

  /**
   * Regla GENERAL del anexo (anexo19.txt:18915, §5.2.3): «Los valores
   * monetarios/porcentajes deben corresponder a valores Positivos».
   *
   * ## Por qué hace falta habiendo ya `LINE_AMOUNT_NEGATIVE`
   *
   * Aquella mira el NETO de la línea, que es una resta: precio × cantidad −
   * descuento. Un precio unitario negativo compensado por un descuento negativo
   * da un neto positivo y pasa. Y ninguna comprobación miraba los importes de
   * CABECERA ni las filas de impuesto, que viajan al XML tal cual.
   *
   * ## Por qué es seguro bloquear (y no un falso positivo esperando)
   *
   * Una devolución o un ajuste a la baja NO se expresa con importes negativos en
   * este esquema: se expresa con una NOTA CRÉDITO, que Vendix persiste con
   * importes POSITIVOS (`credit-notes.service.ts:136,157,160` acumulan
   * `quantity * unit_price`). Un negativo aquí no es un caso de negocio: es un
   * dato corrupto que la DIAN rechazaría.
   *
   * `withholding_amount` y `prepaid_amount` entran también: no van dentro del
   * grupo de totales, pero sí viajan al documento y VLR01 no distingue grupos.
   */
  private checkPositiveValues(
    input: FiscalDocumentValidationInput,
    items: FiscalDocumentLineInput[],
    taxes: FiscalDocumentTaxInput[],
  ): FiscalDocumentFinding[] {
    const findings: FiscalDocumentFinding[] = [];

    const flag = (
      field: string,
      what: string,
      value: DianNumericInput,
      where: string,
      details: Record<string, unknown> = {},
    ): void => {
      const amount = toDecimal(value);
      if (!amount.isNegative()) return;
      findings.push({
        code: 'NEGATIVE_MONETARY_VALUE',
        severity: 'blocker',
        category: 'content',
        field,
        problem: `${what} vale ${dianAmount(amount)}. El Anexo 1.9 exige que TODO valor monetario y TODO porcentaje del documento sea positivo (regla VLR01), y esta cifra viaja al XML tal cual.`,
        fix: `Corrige el valor en ${where}. Para devolver o ajustar a la baja algo ya facturado se emite una NOTA CRÉDITO con importes positivos, nunca una cifra negativa dentro del documento.`,
        details: { ...details, value: dianAmount(amount) },
      });
    };

    flag(
      'subtotal_amount',
      'La base gravable del documento',
      input.subtotal_amount,
      SCREEN_DOCUMENT_HEADER,
    );
    flag(
      'tax_amount',
      'El impuesto total del documento',
      input.tax_amount,
      SCREEN_DOCUMENT_HEADER,
    );
    flag(
      'total_amount',
      'El total del documento',
      input.total_amount,
      SCREEN_DOCUMENT_HEADER,
    );
    flag(
      'discount_amount',
      'El descuento del documento',
      input.discount_amount,
      SCREEN_DOCUMENT_HEADER,
    );
    flag(
      'withholding_amount',
      'La retención del documento',
      input.withholding_amount,
      SCREEN_DOCUMENT_HEADER,
    );
    flag(
      'prepaid_amount',
      'El anticipo del documento',
      input.prepaid_amount,
      SCREEN_DOCUMENT_HEADER,
    );

    items.forEach((item, index) => {
      const line = this.lineLabel(item, index);
      flag(
        `items[${index}].unit_price`,
        `El precio unitario de ${line.charAt(0).toLowerCase()}${line.slice(1)}`,
        item.unit_price,
        SCREEN_DOCUMENT_LINES,
        { line_number: index + 1 },
      );
      flag(
        `items[${index}].discount_amount`,
        `El descuento de ${line.charAt(0).toLowerCase()}${line.slice(1)}`,
        item.discount_amount,
        SCREEN_DOCUMENT_LINES,
        { line_number: index + 1 },
      );
    });

    taxes.forEach((tax, index) => {
      const name =
        (tax.tax_name ?? '').trim() || `impuesto ${index + 1}`;
      flag(
        `taxes[${index}].tax_rate`,
        `La tarifa del impuesto «${name}»`,
        tax.tax_rate,
        SCREEN_DOCUMENT_LINES,
        { tax_name: name },
      );
      flag(
        `taxes[${index}].taxable_amount`,
        `La base del impuesto «${name}»`,
        tax.taxable_amount,
        SCREEN_DOCUMENT_LINES,
        { tax_name: name },
      );
      flag(
        `taxes[${index}].tax_amount`,
        `El importe del impuesto «${name}»`,
        tax.tax_amount,
        SCREEN_DOCUMENT_LINES,
        { tax_name: name },
      );
    });

    return findings;
  }

  // ---------------------------------------------------------------------------
  // 3c. `FAD09e` — LA FECHA DE EMISIÓN ES LA FECHA DE FIRMA
  // ---------------------------------------------------------------------------

  /**
   * `FAD09e` / `CAD09e` / `DAD09e`: «La fecha de generación de la factura es
   * diferente a la fecha de firma de la factura».
   *
   * SÓLO SE JUZGA CUANDO QUIEN INVOCA APORTA `signing_date`. Ver el comentario
   * de ese campo en {@link FiscalDocumentValidationInput}: `validate()` no lo
   * aporta (todavía no hay momento de firma), y `send()` sí lo aporta —con
   * `new Date()`— al revalidar un reenvío `rejected`, que es el único punto de
   * la cadena donde «ahora» es literalmente el instante de la firma y no una
   * invención.
   *
   * Se compara por DÍA CIVIL en la zona del emisor, por el mismo motivo que la
   * vigencia del rango: `cbc:IssueDate` es una fecha-sólo y `ds:SigningTime` un
   * instante; compararlos crudos rechazaría toda emisión hecha después de las
   * 19:00 en Bogotá.
   */
  private checkSigningDate(
    input: FiscalDocumentValidationInput,
    label: string,
  ): FiscalDocumentFinding[] {
    const signing_date = this.toDate(input.signing_date);
    const issue_date = this.toDate(input.issue_date);
    if (!signing_date || !issue_date) return [];

    const timezone = input.timezone || DEFAULT_STORE_TIMEZONE;
    const issue_day = localDateString(issue_date, timezone);
    const signing_day = localDateString(signing_date, timezone);
    if (issue_day === signing_day) return [];

    return [
      {
        code: 'ISSUE_DATE_AFTER_SIGNING_DATE',
        severity: 'blocker',
        category: 'content',
        field: 'issue_date',
        problem: `${label} declara fecha de emisión ${issue_day} pero se va a firmar el ${signing_day}. La DIAN exige que las dos coincidan: recalcula el CUFE con la fecha declarada y confronta la firma, así que un borrador fechado un día y transmitido otro se rechaza.`,
        fix: `Actualiza la fecha de emisión del documento a ${signing_day} en ${SCREEN_DOCUMENT_HEADER} antes de transmitirlo. Si la fecha ${issue_day} es la correcta fiscalmente, el documento tenía que haberse transmitido ese mismo día.`,
        details: { issue_date: issue_day, signing_date: signing_day, timezone },
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // 4. `TaxAmount = TaxableAmount × Percent/100` POR `cac:TaxSubtotal`
  // ---------------------------------------------------------------------------

  /**
   * La regla se comprueba DOS veces y por buenas razones distintas.
   *
   * Fila por fila, porque es donde el operador puede corregirla. Y por GRUPO,
   * porque el emisor agrupa las filas por esquema DIAN (01 IVA, 04 INC, 03 ICA…)
   * y emite UN `cac:TaxSubtotal` por grupo, con `cbc:Percent` tomado de la
   * PRIMERA fila del grupo. Dos filas de IVA con tarifas distintas (19 % y 5 %)
   * producen un subtotal cuya tarifa declarada no explica su importe: cuadra fila
   * a fila y no cuadra en el documento, que es lo que la DIAN valida.
   */
  private checkTaxSubtotals(
    taxes: FiscalDocumentTaxInput[],
  ): FiscalDocumentFinding[] {
    const findings: FiscalDocumentFinding[] = [];
    if (taxes.length === 0) return findings;

    /** `código de esquema` → filas que el emisor va a fusionar en un subtotal. */
    const groups = new Map<string, FiscalDocumentTaxInput[]>();

    taxes.forEach((tax, index) => {
      const scheme = this.schemeCodeOf(tax);
      const name = (tax.tax_name ?? '').trim() || scheme;

      // RETENCIÓN infiltrada en `invoice_taxes` por el camino legacy de
      // `dto.taxes[]` (`CreateInvoiceTaxDto.tax_type` admite
      // `withholding|reteiva|reteica`). No entra ni al grupo ni a la aritmética,
      // por dos razones independientes:
      //
      // 1. El flujo la DESCARTA antes de armar el XML
      //    (`invoice-flow.service.ts:2217`). El importe que este bloque
      //    compararía no llega a la DIAN, así que no puede provocar un rechazo.
      //    Bloquear por él sería inventarse un requisito — el mismo criterio que
      //    rige para el bloque de control que no se transmite.
      // 2. La comparación ni siquiera es válida: un ReteICA guarda su tarifa
      //    POR MIL, igual que el ICA, así que `base × tarifa / 100` daría diez
      //    veces el importe real. El descuadre sería del validador.
      //
      // Se AVISA, eso sí, y ese es el punto: quien capturó la retención ahí cree
      // que el documento la declara, y el documento NO la declara. El sitio de
      // una retención es `withholdings[]` → `cac:WithholdingTaxTotal`.
      if (this.isWithholdingRow(tax)) {
        findings.push({
          code: 'TAX_ROW_IS_WITHHOLDING',
          severity: 'warning',
          category: 'arithmetic',
          field: `taxes[${index}]`,
          problem: `«${name}» está capturado como impuesto del documento, pero es una RETENCIÓN (esquema DIAN ${scheme}). El documento NO la va a declarar: las retenciones viajan en su propio grupo \`cac:WithholdingTaxTotal\`, y el emisor descarta las que aparecen entre los impuestos para no descuadrar \`TaxInclusiveAmount\`.`,
          fix: `Quita «${name}» de los impuestos del documento y captúrala como retención. Si la retención ya está bien resuelta por la configuración fiscal, esta fila es un duplicado del camino antiguo y sobra.`,
          details: { tax_name: name, dian_tax_code: scheme },
        });
        return;
      }

      const bucket = groups.get(scheme);
      if (bucket) bucket.push(tax);
      else groups.set(scheme, [tax]);

      const taxable = toDecimal(tax.taxable_amount);
      const declared = toDecimal(tax.tax_amount);
      const rate = toDecimal(tax.tax_rate);

      // Importe sin tarifa: no hay nada de qué derivarlo y la DIAN exige
      // `cbc:Percent` en todo `cac:TaxCategory`. Es el mismo caso que
      // `INVOICING_CALC_001` corta al crear; acá se vuelve a mirar porque un
      // documento legado pudo persistirse antes de esa puerta.
      if (rate.isZero() && !declared.isZero()) {
        findings.push({
          code: 'TAX_RATE_MISSING',
          severity: 'blocker',
          category: 'arithmetic',
          field: `taxes[${index}].tax_rate`,
          problem: `El impuesto «${name}» declara ${dianAmount(declared)} sin tarifa. La DIAN valida \`TaxAmount = TaxableAmount × Percent/100\`, y con tarifa cero esa igualdad exige un importe cero.`,
          fix: `Indica la tarifa del impuesto (por ejemplo IVA 19 %) o deja su importe en cero, en ${SCREEN_DOCUMENT_LINES}.`,
          details: { tax_name: name, tax_amount: dianAmount(declared) },
        });
        return;
      }

      const expected = this.expectedTaxAmount(taxable, rate, scheme);
      const difference = declared.minus(toDecimal(expected));
      if (!difference.abs().greaterThan(ONE_CENT)) return;

      findings.push({
        code: 'TAX_SUBTOTAL_MISMATCH',
        severity: 'blocker',
        category: 'arithmetic',
        field: `taxes[${index}].tax_amount`,
        problem: `El impuesto «${name}» declara ${dianAmount(declared)} sobre una base de ${dianAmount(taxable)} al ${this.describeRate(rate, scheme)}, pero esa base y esa tarifa dan ${expected}. La DIAN recomputa \`TaxAmount = TaxableAmount × Percent/100\` sobre el XML que recibe y rechaza la diferencia.`,
        fix: `Vuelve a guardar el documento para que el servidor recalcule sus impuestos, o corrige la base o la tarifa en ${SCREEN_DOCUMENT_LINES}. Si el importe es correcto y la base no, la base está mal capturada.`,
        details: {
          tax_name: name,
          taxable_amount: dianAmount(taxable),
          tax_rate: dianRate(rate),
          expected,
          declared: dianAmount(declared),
          difference: dianAmount(difference),
        },
      });
    });

    for (const [scheme, rows] of groups) {
      if (rows.length < 2) continue;
      const rates = new Set(rows.map((row) => dianRate(row.tax_rate)));
      if (rates.size < 2) continue;

      findings.push({
        code: 'TAX_SCHEME_RATE_COLLISION',
        severity: 'blocker',
        category: 'arithmetic',
        field: 'taxes',
        problem: `El documento lleva ${rates.size} tarifas distintas (${[
          ...rates,
        ].join(
          ', ',
        )}) para el mismo tributo ${scheme}. El emisor las fusiona en un solo \`cac:TaxSubtotal\` y declara la tarifa de la primera, así que el subtotal resultante declara un importe que su propia tarifa no explica y la DIAN lo rechaza por descuadre.`,
        fix: `Separa el documento por tarifa —un documento por tarifa de ${scheme}— o corrige las líneas para que todas usen la misma, en ${SCREEN_DOCUMENT_LINES}.`,
        details: { dian_tax_code: scheme, tax_rates: [...rates] },
      });
    }

    return findings;
  }

  // ---------------------------------------------------------------------------
  // 5. ARITMÉTICA DE CABECERA: FAU14 Y `PayableAmount`
  // ---------------------------------------------------------------------------

  private checkArithmetic(
    input: FiscalDocumentValidationInput,
    computed: FiscalDocumentComputedTotals,
  ): FiscalDocumentFinding[] {
    const findings: FiscalDocumentFinding[] = [];
    if (monetaryTotalElementFor(input.document_type) === null) return findings;

    const element = computed.monetary_total_element ?? 'LegalMonetaryTotal';

    // --- FAU02 / CAU02 / DAU02 -----------------------------------------------
    //
    // OJO CON EL IDENTIFICADOR: esto NO es FAU14 —así estaba citado hasta ahora—.
    // FAU14 gobierna `cbc:PayableAmount` y se comprueba más abajo, en
    // `checkPayableAmount`. La regla que compara el bruto de cabecera contra la
    // suma de las líneas es FAU02 (anexo19.txt:22411). Citar la equivocada es
    // peor que no citar ninguna: manda a leer la regla que no falló.
    //
    // La regla, literalmente, compara dos valores que AMBOS salen del XML, y el
    // emisor los deriva de la misma función (`dianLineExtensionTotal`), así que
    // dentro del documento no puede fallar. Lo que sí puede fallar —y es lo que
    // se comprueba acá— es que la base gravable PERSISTIDA, la que ve el
    // comerciante, la que alimenta la contabilidad y la base de retención, no sea
    // la que el documento va a declarar.
    //
    // TOLERANCIA DE UN CENTAVO, y es deliberada: el truncado hoja por hoja puede
    // separar en un centavo dos representaciones internas del mismo importe sin
    // que eso llegue al XML. Más de un centavo ya no es truncado — es un total
    // que no se deriva de sus líneas.
    const declared_subtotal = toDecimal(input.subtotal_amount);
    const subtotal_difference = declared_subtotal.minus(
      toDecimal(computed.line_extension_amount),
    );
    if (subtotal_difference.abs().greaterThan(ONE_CENT)) {
      findings.push({
        code: 'HEADER_LINE_EXTENSION_MISMATCH',
        severity: 'blocker',
        category: 'arithmetic',
        field: 'subtotal_amount',
        problem: `El documento declara una base de ${dianAmount(declared_subtotal)}, pero la suma de los importes de sus líneas —ya truncados, que es como viajan en el XML— da ${computed.line_extension_amount}. La regla FAU02 exige que \`${element}/cbc:LineExtensionAmount\` sea exactamente esa suma, y es la regla que más rechazos produce.`,
        fix: `Vuelve a guardar el documento para que el servidor recalcule sus totales desde las líneas, o corrige la línea que no cuadra en ${SCREEN_DOCUMENT_LINES}.`,
        details: {
          declared: dianAmount(declared_subtotal),
          expected: computed.line_extension_amount,
          difference: dianAmount(subtotal_difference),
        },
      });
    }

    // --- `cac:TaxTotal` vs el impuesto de cabecera ---------------------------
    //
    // El emisor escribe `TaxTotal/TaxAmount` sumando las FILAS de impuesto, pero
    // arma `TaxInclusiveAmount` con el impuesto de la CABECERA. Si los dos
    // difieren, el documento declara `base + impuestos` con un impuesto que su
    // propio `TaxTotal` no respalda.
    const declared_tax = toDecimal(input.tax_amount);
    const tax_difference = declared_tax.minus(
      toDecimal(computed.tax_total_amount),
    );
    if (tax_difference.abs().greaterThan(ONE_CENT)) {
      findings.push({
        code: 'HEADER_TAX_TOTAL_MISMATCH',
        severity: 'blocker',
        category: 'arithmetic',
        field: 'tax_amount',
        problem: `El documento declara ${dianAmount(declared_tax)} de impuestos en su cabecera, pero sus filas de impuesto suman ${computed.tax_total_amount}. El XML escribe \`cac:TaxTotal/cbc:TaxAmount\` con la suma de las filas y \`cbc:TaxInclusiveAmount\` con el valor de cabecera, así que el documento se contradiría a sí mismo.`,
        fix: `Vuelve a guardar el documento para que el servidor recalcule sus impuestos desde las líneas, en ${SCREEN_DOCUMENT_LINES}.`,
        details: {
          declared: dianAmount(declared_tax),
          expected: computed.tax_total_amount,
          difference: dianAmount(tax_difference),
        },
      });
    }

    // --- `AllowanceTotalAmount` sin respaldo ---------------------------------
    findings.push(...this.checkAllowanceBacking(input, computed, element));

    // --- `PayableAmount` -----------------------------------------------------
    findings.push(...this.checkPayableAmount(input, computed, element));

    return findings;
  }

  /**
   * `FAU08` / `CAU08` / `DAU08` — un descuento de documento que el XML declara
   * pero no respalda.
   *
   * ## El defecto real que ataja
   *
   * `UblCommonBuilder.buildMonetaryTotal` escribe SIEMPRE
   * `cbc:AllowanceTotalAmount` con el descuento de pie
   * (`ubl-common.builder.ts:1651`), pero el grupo `cac:AllowanceCharge` que lo
   * respalda sólo lo emiten dos constructores: el de la factura y el del
   * documento equivalente. La nota crédito, la nota débito, el documento soporte
   * y su nota de ajuste van directo al grupo de totales.
   *
   * Resultado: una nota crédito con descuento de pie declara
   * `AllowanceTotalAmount = 25.000` y CERO grupos `cac:AllowanceCharge`. La regla
   * compara ese total contra `sum(cac:AllowanceCharge[ChargeIndicator="false"]
   * /cbc:Amount)`, que sin grupos vale 0, y rechaza. El consecutivo se pierde.
   *
   * ## Por qué es un bloqueo y no un aviso
   *
   * Porque el dato SÍ viaja —a diferencia del bloque `sts:InvoiceControl` del
   * documento soporte, que se atenúa justamente por no viajar— y porque la
   * comparación que la DIAN hace es aritmética exacta, sin tolerancia: no hay
   * escenario en que un total positivo sin grupos que lo respalden se acepte.
   *
   * ## Por qué NO se dispara con descuento cero
   *
   * Con `AllowanceTotalAmount = 0.00` la suma vacía también vale 0 y la regla se
   * cumple. Que es el caso normal en Vendix: los descuentos se originan POR
   * LÍNEA (`order_items.discount_amount`) y el descuento de documento sólo
   * aparece cuando la cabecera descuenta más de lo que sus líneas explican.
   */
  private checkAllowanceBacking(
    input: FiscalDocumentValidationInput,
    computed: FiscalDocumentComputedTotals,
    element: string,
  ): FiscalDocumentFinding[] {
    const allowance = toDecimal(computed.allowance_total_amount);
    if (!allowance.greaterThan(ZERO)) return [];
    if (emitsDocumentAllowanceCharge(input.document_type)) return [];

    const label = requirementsFor(input.document_type).label;
    const line_discounts = dianSum(
      (input.items ?? []).map((item) => item.discount_amount),
    );

    return [
      {
        code: 'ALLOWANCE_TOTAL_UNBACKED',
        severity: 'blocker',
        category: 'arithmetic',
        field: 'discount_amount',
        problem: `${label} declara un descuento de pie de ${computed.allowance_total_amount} —la cabecera descuenta ${dianAmount(input.discount_amount)} y sus líneas sólo explican ${line_discounts}—, pero el XML de este tipo de documento publica \`${element}/cbc:AllowanceTotalAmount\` SIN el grupo \`cac:AllowanceCharge\` que lo respalda. La DIAN compara ese total contra la suma de los descuentos declarados, que sin grupos vale 0.00, y rechaza.`,
        fix: `Reparte el descuento entre las líneas en ${SCREEN_DOCUMENT_LINES} para que la cabecera no descuente nada que las líneas no expliquen. Un descuento de pie sólo lo puede emitir la factura de venta y el documento equivalente POS.`,
        details: {
          allowance_total_amount: computed.allowance_total_amount,
          header_discount_amount: dianAmount(input.discount_amount),
          line_discounts_total: line_discounts,
          emits_allowance_charge: false,
        },
      },
    ];
  }

  /**
   * `PayableAmount` = `LineExtension − Allowance + Impuestos`. Y sobre todo: lo
   * que NO entra.
   *
   * Anexo Técnico 1.9 §11.9.1: «los cálculos aplicados por la validación previa
   * de la DIAN no incluyen en el fragmento `<cac:LegalMonetaryTotal/>`
   * operaciones con el elemento `<cac:WithholdingTaxTotal/>`». §11.9.2 dice lo
   * mismo del anticipo `cbc:PrepaidAmount`.
   *
   * Es decir: la DIAN valida el total SIN mirar la retención. Restarla es el
   * error que cualquiera cometería —contablemente la retención sí reduce lo que
   * el cliente gira— y el documento se rechaza por descuadre aritmético. Por eso
   * la firma de ese error se detecta aparte y se nombra: «te falta exactamente la
   * retención» es accionable; «el total no cuadra» manda a revisar las líneas.
   */
  private checkPayableAmount(
    input: FiscalDocumentValidationInput,
    computed: FiscalDocumentComputedTotals,
    element: string,
  ): FiscalDocumentFinding[] {
    const declared_total = toDecimal(input.total_amount);
    const expected = toDecimal(computed.payable_amount);
    const difference = declared_total.minus(expected);
    if (!difference.abs().greaterThan(ONE_CENT)) return [];

    const withholding = toDecimal(input.withholding_amount);
    const prepaid = toDecimal(input.prepaid_amount);

    const nets_withholding =
      withholding.greaterThan(ZERO) &&
      declared_total
        .plus(withholding)
        .minus(expected)
        .abs()
        .lessThanOrEqualTo(ONE_CENT);
    if (nets_withholding) {
      return [
        {
          code: 'PAYABLE_NETS_WITHHOLDING',
          severity: 'blocker',
          category: 'arithmetic',
          field: 'total_amount',
          problem: `El total declarado (${dianAmount(declared_total)}) es exactamente el total del documento menos la retención (${dianAmount(withholding)}). El Anexo 1.9 §11.9.1 es explícito: la validación previa de la DIAN NO opera \`cac:WithholdingTaxTotal\` dentro de \`${element}\`. Restarla hace que \`cbc:PayableAmount\` deje de cuadrar con base + impuestos y el documento se rechaza.`,
          fix: `El total del documento debe ser ${computed.payable_amount}. La retención se declara aparte, en su propio bloque, y NO se resta del total: contablemente reduce lo que el cliente gira, pero fiscalmente el documento vale su total bruto.`,
          details: {
            declared: dianAmount(declared_total),
            expected: computed.payable_amount,
            withholding_amount: dianAmount(withholding),
          },
        },
      ];
    }

    const nets_prepaid =
      prepaid.greaterThan(ZERO) &&
      declared_total
        .plus(prepaid)
        .minus(expected)
        .abs()
        .lessThanOrEqualTo(ONE_CENT);
    if (nets_prepaid) {
      return [
        {
          code: 'PAYABLE_NETS_PREPAID',
          severity: 'blocker',
          category: 'arithmetic',
          field: 'total_amount',
          problem: `El total declarado (${dianAmount(declared_total)}) es exactamente el total del documento menos el anticipo (${dianAmount(prepaid)}). El Anexo 1.9 §11.9.2 mantiene \`cbc:PrepaidAmount\` como informativo: no se resta de \`cbc:PayableAmount\`.`,
          fix: `El total del documento debe ser ${computed.payable_amount}. El anticipo se informa en su propio campo y no netea el total.`,
          details: {
            declared: dianAmount(declared_total),
            expected: computed.payable_amount,
            prepaid_amount: dianAmount(prepaid),
          },
        },
      ];
    }

    return [
      {
        code: 'PAYABLE_AMOUNT_MISMATCH',
        severity: 'blocker',
        category: 'arithmetic',
        field: 'total_amount',
        problem: `El documento declara un total de ${dianAmount(declared_total)}, pero sus propias partes dan ${computed.payable_amount} (${computed.line_extension_amount} de base − ${computed.allowance_total_amount} de descuento de pie + ${dianAmount(input.tax_amount)} de impuestos). Ese total es a la vez \`${element}/cbc:PayableAmount\` y el campo ValTot del hash del documento, así que un descuadre acá rechaza por aritmética y por clave mal calculada.`,
        fix: `Vuelve a guardar el documento para que el servidor recalcule sus totales, o corrige el descuento y los impuestos en ${SCREEN_DOCUMENT_LINES}.`,
        details: {
          declared: dianAmount(declared_total),
          expected: computed.payable_amount,
          difference: dianAmount(difference),
          line_extension_amount: computed.line_extension_amount,
          allowance_total_amount: computed.allowance_total_amount,
          tax_amount: dianAmount(input.tax_amount),
        },
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // 6. RESOLUCIÓN DE NUMERACIÓN
  // ---------------------------------------------------------------------------

  /**
   * Vigencia, rango y prefijo — juzgados contra la FECHA DE EMISIÓN, no contra
   * «ahora».
   *
   * La distinción importa: `resolveInvoiceControl` valida la vigencia contra el
   * instante del envío porque es cuando se transmite, pero un documento fechado
   * ayer y transmitido hoy declara `cbc:IssueDate` de ayer, y la DIAN confronta
   * ESA fecha contra el período autorizado. Un documento emitido el último día de
   * vigencia y transmitido al siguiente pasa el control de envío y falla el de la
   * DIAN. Acá se mira la fecha que el documento va a declarar.
   *
   * Solo se aplica a los documentos que cuelgan de una Autorización de
   * Numeración; para las notas la fila `invoice_resolutions` es una fuente de
   * consecutivo interno y exigirle vigencia DIAN sería inventarse un requisito.
   */
  private checkResolution(
    input: FiscalDocumentValidationInput,
  ): FiscalDocumentFinding[] {
    if (!requiresAuthorizedRange(input.document_type)) return [];

    const findings: FiscalDocumentFinding[] = [];
    const label = requirementsFor(input.document_type).label;
    const resolution = input.resolution;

    if (!resolution) {
      // Pasa por el mismo atenuador que el resto: si el bloque de control no se
      // transmite para este tipo, su ausencia tampoco puede provocar un rechazo.
      return this.softenWhenControlBlockIsNotTransmitted(input.document_type, [
        {
          code: 'RESOLUTION_MISSING',
          severity: 'blocker',
          category: 'resolution',
          field: 'resolution',
          problem: `${label} numera contra una Autorización de Numeración de la DIAN y este documento no tiene ninguna asociada. Sin ella el bloque \`sts:InvoiceControl\` va vacío, la DIAN no resuelve el punto de facturación y rechaza en cascada.`,
          fix: `Carga la resolución de numeración vigente para este tipo de documento en ${SCREEN_RESOLUTIONS}.`,
        },
      ]);
    }

    const scope: Record<string, unknown> = {};
    if (resolution.id != null) scope.resolution_id = resolution.id;

    if (resolution.is_active === false) {
      findings.push({
        code: 'RESOLUTION_INACTIVE',
        severity: 'blocker',
        category: 'resolution',
        field: 'resolution.is_active',
        problem: `La resolución de numeración está desactivada. Emitir bajo ella sería declarar una autorización que no está en uso.`,
        fix: `Actívala o asigna otra resolución vigente en ${SCREEN_RESOLUTIONS}.`,
        details: scope,
      });
    }

    if (!(resolution.resolution_number ?? '').trim()) {
      findings.push({
        code: 'RESOLUTION_NUMBER_MISSING',
        severity: 'blocker',
        category: 'resolution',
        field: 'resolution.resolution_number',
        problem: `La resolución no tiene número de autorización. Es el valor de \`sts:InvoiceAuthorization\`, que la DIAN confronta contra la autorización del punto de facturación.`,
        fix: `Copia el número de autorización del PDF de la DIAN en ${SCREEN_RESOLUTIONS}.`,
        details: scope,
      });
    }

    const prefix = (resolution.prefix ?? '').trim();
    if (!prefix) {
      findings.push({
        code: 'RESOLUTION_PREFIX_MISSING',
        severity: 'blocker',
        category: 'resolution',
        field: 'resolution.prefix',
        problem: `La resolución no tiene prefijo. Sin él desaparecen \`sts:AuthorizedInvoices/sts:Prefix\` y \`cac:CorporateRegistrationScheme\`, y con ellos el lado derecho de la comparación FAB10a: la DIAN no resuelve el punto de facturación y rechaza además por FAD05e, FAB24a y FAB27b.`,
        fix: `Copia el prefijo autorizado en ${SCREEN_RESOLUTIONS}.`,
        details: scope,
      });
    }

    findings.push(...this.checkPrefixShape(prefix, scope));
    findings.push(...this.checkResolutionValidity(resolution, input, scope));
    findings.push(
      ...this.checkResolutionRange(resolution, input, prefix, scope),
    );

    return this.softenWhenControlBlockIsNotTransmitted(
      input.document_type,
      findings,
    );
  }

  /**
   * Baja de BLOQUEO a AVISO los hallazgos de resolución de los documentos cuyo
   * bloque `sts:InvoiceControl` el emisor NO transmite.
   *
   * ── LA CONTRADICCIÓN QUE ESTO NO RESUELVE (a propósito) ────────────────────
   *
   * Dos sitios del repo afirman cosas opuestas sobre el documento soporte:
   *
   *   · `fiscal-document-requirements.ts` lo declara con
   *     `requires_authorized_range: true` — «numeración consecutiva autorizada
   *     por la DIAN» (Res. 000167/2021, que efectivamente la exige).
   *   · `invoice-flow.service.ts` lo EXCLUYE de `resolveInvoiceControl` — «su
   *     consecutivo es interno del tenant, y el proveedor omite el bloque para
   *     él a propósito».
   *
   * Uno de los dos está mal, y decidir cuál es un cambio en lo que se TRANSMITE:
   * no es algo que un validador deba resolver por su cuenta ni de forma
   * silenciosa.
   *
   * ── POR QUÉ AVISO Y NO BLOQUEO, MIENTRAS TANTO ─────────────────────────────
   *
   * La severidad tiene que seguir a lo que el emisor realmente manda. Hoy la
   * DIAN NUNCA VE la resolución de un documento soporte: el bloque no viaja. Un
   * dato que no viaja no puede provocar un rechazo, así que bloquear por su
   * estado sería inventarse un requisito — exactamente lo que este validador
   * evita para las notas por la misma razón (ver `checkResolution`).
   *
   * Y bloquear tendría un costo real e inmediato: rompería la emisión de
   * documentos soporte que hoy funciona, a cambio de proteger de un rechazo que
   * hoy no puede ocurrir.
   *
   * El aviso deja el problema VISIBLE en `warnings[]` y en el log en vez de
   * enterrarlo. El día que `send()` empiece a transmitir el bloque para estos
   * documentos, se borra esta función y los hallazgos vuelven a ser bloqueantes
   * solos — que es el orden correcto: primero se emite el dato, después se exige.
   */
  private softenWhenControlBlockIsNotTransmitted(
    document_type: FiscalDocumentType,
    findings: FiscalDocumentFinding[],
  ): FiscalDocumentFinding[] {
    if (!DOCUMENTS_WITHOUT_TRANSMITTED_CONTROL.has(document_type)) {
      return findings;
    }

    return findings.map((finding) =>
      finding.severity === 'blocker'
        ? {
            ...finding,
            severity: 'warning' as const,
            problem: `${finding.problem} (No bloquea la emisión: para ${requirementsFor(document_type).label} el bloque \`sts:InvoiceControl\` no se transmite, así que la DIAN no ve esta resolución.)`,
          }
        : finding,
    );
  }

  /**
   * Forma del prefijo autorizado — `sts:AuthorizedInvoices/sts:Prefix`.
   *
   * ## El agujero que cierra
   *
   * `CreateResolutionDto.prefix` sólo declara `@IsString() @MaxLength(10)`: no
   * hay clase de caracteres. Un prefijo con espacio, guion o punto entra tal
   * cual, `generateNextNumber` lo concatena con el consecutivo
   * (`utils/invoice-number-generator.ts:195`) y el resultado sale a `cbc:ID`,
   * donde `FAD05a` lo rechaza. El prefijo es el ORIGEN del defecto: mientras no
   * se corrija, envenena todos los consecutivos futuros, no sólo este documento.
   *
   * ## Dos severidades y el motivo exacto de cada una
   *
   * · **Caracteres no alfanuméricos → BLOQUEO.** La consecuencia es demostrable:
   *   se concatena a `cbc:ID` y ese elemento tiene regla de rechazo literal en
   *   las tres tablas (`FAD05a` / `CAD05` / `DAD05`).
   *
   * · **Más de 4 caracteres → AVISO.** El anexo declara `sts:Prefix` como `EA`
   *   con `Tam 0-4` (anexo19.txt:1113), PERO el XSD versionado en el repo lo
   *   tipa `<element name="Prefix" type="string"/>` sin faceta de longitud
   *   (`schemas/maindoc/DIAN_UBL_Structures.xsd:81`), así que no hay evidencia de
   *   que un prefijo de 5 caracteres se rechace. Bloquear por una faceta que no
   *   se puede demostrar dejaría sin facturar a una tienda que hoy emite bien —
   *   y un falso positivo cuesta más que un falso negativo. El aviso deja el
   *   riesgo visible sin apostar la operación.
   */
  private checkPrefixShape(
    prefix: string,
    scope: Record<string, unknown>,
  ): FiscalDocumentFinding[] {
    if (!prefix) return [];
    const findings: FiscalDocumentFinding[] = [];

    if (!DOCUMENT_NUMBER_PATTERN.test(prefix)) {
      findings.push({
        code: 'RESOLUTION_PREFIX_NOT_ALPHANUMERIC',
        severity: 'blocker',
        category: 'resolution',
        field: 'resolution.prefix',
        problem: `El prefijo de la resolución es «${prefix}» y contiene caracteres que no son letras ni dígitos. El prefijo se concatena con el consecutivo para formar el número del documento, y la DIAN rechaza un \`cbc:ID\` con espacios, guiones o cualquier otro carácter. Mientras el prefijo siga así, TODOS los documentos que numere esta resolución nacerán rechazados.`,
        fix: `Deja el prefijo sólo con letras y dígitos (por ejemplo «FE» o «SETP») en ${SCREEN_RESOLUTIONS}, copiándolo exactamente del PDF de la autorización de numeración. Los documentos ya numerados con el prefijo viejo hay que volver a numerarlos.`,
        details: { ...scope, prefix },
      });
    }

    if (prefix.length > RESOLUTION_PREFIX_MAX_LENGTH) {
      findings.push({
        code: 'RESOLUTION_PREFIX_TOO_LONG',
        severity: 'warning',
        category: 'resolution',
        field: 'resolution.prefix',
        problem: `El prefijo «${prefix}» tiene ${prefix.length} caracteres y el Anexo 1.9 declara \`sts:Prefix\` con un máximo de ${RESOLUTION_PREFIX_MAX_LENGTH}. Un prefijo más largo no puede venir de una autorización de numeración de la DIAN, así que lo más probable es que esté mal capturado.`,
        fix: `Verifica el prefijo contra el PDF de la autorización de numeración en ${SCREEN_RESOLUTIONS}. No bloquea la emisión: el esquema XSD de la DIAN no impone la longitud, así que no se puede afirmar que vaya a rechazar.`,
        details: {
          ...scope,
          prefix,
          max_length: RESOLUTION_PREFIX_MAX_LENGTH,
        },
      });
    }

    return findings;
  }

  private checkResolutionValidity(
    resolution: FiscalDocumentResolutionInput,
    input: FiscalDocumentValidationInput,
    scope: Record<string, unknown>,
  ): FiscalDocumentFinding[] {
    const valid_from = this.toDate(resolution.valid_from);
    const valid_to = this.toDate(resolution.valid_to);
    if (!valid_from || !valid_to) return [];

    if (valid_from.getTime() >= valid_to.getTime()) {
      return [
        {
          code: 'RESOLUTION_VALIDITY_WINDOW_INVALID',
          severity: 'blocker',
          category: 'resolution',
          field: 'resolution.valid_to',
          problem: `La vigencia de la resolución va del ${this.dateOnly(valid_from)} al ${this.dateOnly(valid_to)}: no existe un solo día en el que se pueda emitir bajo ella.`,
          fix: `Corrige las fechas de vigencia copiándolas de la autorización de numeración en ${SCREEN_RESOLUTIONS}.`,
          details: {
            ...scope,
            valid_from: this.dateOnly(valid_from),
            valid_to: this.dateOnly(valid_to),
          },
        },
      ];
    }

    const issue_date = this.toDate(input.issue_date);
    if (!issue_date) return [];

    // COMPARACIÓN POR DÍA CIVIL, NO POR INSTANTE — y por eso cada lado usa su
    // propia zona.
    //
    // `valid_from`/`valid_to` son FECHA-SÓLO guardadas como medianoche UTC, y
    // `issue_date` es un INSTANTE. Compararlos crudos rechaza toda emisión hecha
    // después de medianoche UTC del último día de vigencia — es decir, cualquier
    // factura del último día autorizado hecha desde las 19:00 en Bogotá. La
    // regla del repo resuelve exactamente esto: instante → zona del emisor,
    // fecha-sólo → UTC tal como se guardó. Las cadenas `YYYY-MM-DD` se comparan
    // lexicográficamente, que para ISO 8601 es el mismo orden que cronológico.
    const issue_day = localDateString(
      issue_date,
      input.timezone || DEFAULT_STORE_TIMEZONE,
    );
    const from_day = this.dateOnly(valid_from);
    const to_day = this.dateOnly(valid_to);

    if (issue_day < from_day || issue_day > to_day) {
      return [
        {
          code: 'RESOLUTION_NOT_VALID_AT_ISSUE_DATE',
          severity: 'blocker',
          category: 'resolution',
          field: 'issue_date',
          problem: `El documento se emite con fecha ${issue_day} y la resolución solo autoriza del ${from_day} al ${to_day}. La DIAN confronta la \`cbc:IssueDate\` del documento contra el período autorizado, así que la fecha que importa es la del documento y no la del envío.`,
          fix: `Corrige la fecha de emisión del documento, o carga en ${SCREEN_RESOLUTIONS} la resolución que cubre esa fecha.`,
          details: {
            ...scope,
            issue_date: issue_day,
            valid_from: from_day,
            valid_to: to_day,
          },
        },
      ];
    }

    return [];
  }

  /**
   * Rango autorizado, consecutivo disponible y coherencia del prefijo con el
   * número que se va a emitir.
   *
   * `FE-1234` tiene que empezar por el prefijo de SU resolución y su parte
   * numérica caer dentro del rango: un documento numerado fuera del rango
   * autorizado es un documento sin autorización, y la DIAN lo rechaza aunque
   * todo lo demás esté impecable.
   */
  private checkResolutionRange(
    resolution: FiscalDocumentResolutionInput,
    input: FiscalDocumentValidationInput,
    prefix: string,
    scope: Record<string, unknown>,
  ): FiscalDocumentFinding[] {
    const findings: FiscalDocumentFinding[] = [];
    const from = resolution.range_from ?? null;
    const to = resolution.range_to ?? null;

    if (
      from === null ||
      to === null ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from <= 0 ||
      to < from
    ) {
      return [
        {
          code: 'RESOLUTION_RANGE_INVALID',
          severity: 'blocker',
          category: 'resolution',
          field: 'resolution.range_to',
          problem: `El rango autorizado de la resolución es ${from ?? 'sin definir'}..${to ?? 'sin definir'}: tienen que ser dos enteros positivos con el final mayor o igual que el inicial. \`sts:From\` y \`sts:To\` delimitan la numeración que la DIAN autorizó.`,
          fix: `Copia el rango de la autorización de numeración en ${SCREEN_RESOLUTIONS}.`,
          details: { ...scope, range_from: from, range_to: to },
        },
      ];
    }

    const range_from = from;
    const range_to = to;
    const current = resolution.current_number ?? 0;

    // `sts:From` y `sts:To` son `EN` con `Tam 1-9` (anexo19.txt:1127 y :1138):
    // como mucho 9 dígitos. AVISO y no bloqueo por el mismo motivo que la
    // longitud del prefijo: el XSD del repo los tipa `long`
    // (`schemas/maindoc/DIAN_UBL_Structures.xsd:88`), sin faceta de dígitos, así
    // que la faceta no es demostrable y bloquear por ella sería apostar la
    // operación de la tienda contra una lectura del PDF.
    const overlong = [
      { field: 'range_from' as const, value: range_from },
      { field: 'range_to' as const, value: range_to },
    ].filter(
      ({ value }) => String(value).length > RESOLUTION_RANGE_MAX_DIGITS,
    );
    if (overlong.length > 0) {
      findings.push({
        code: 'RESOLUTION_RANGE_TOO_MANY_DIGITS',
        severity: 'warning',
        category: 'resolution',
        field: `resolution.${overlong[0].field}`,
        problem: `El rango autorizado ${range_from}..${range_to} usa más de ${RESOLUTION_RANGE_MAX_DIGITS} dígitos, y el Anexo 1.9 declara \`sts:From\` y \`sts:To\` con ese máximo. Un rango así no puede venir de una autorización de numeración de la DIAN.`,
        fix: `Verifica el rango contra el PDF de la autorización de numeración en ${SCREEN_RESOLUTIONS}: lo más probable es que sobre un dígito al copiarlo.`,
        details: {
          ...scope,
          range_from,
          range_to,
          max_digits: RESOLUTION_RANGE_MAX_DIGITS,
        },
      });
    }

    if (current >= range_to) {
      findings.push({
        code: 'RESOLUTION_RANGE_EXHAUSTED',
        severity: 'blocker',
        category: 'resolution',
        field: 'resolution.current_number',
        problem: `La resolución agotó su rango: autoriza hasta el ${range_to} y ya consumió hasta el ${current}. No quedan consecutivos autorizados.`,
        fix: `Solicita a la DIAN un nuevo rango de numeración y cárgalo en ${SCREEN_RESOLUTIONS}.`,
        details: {
          ...scope,
          range_from,
          range_to,
          current_number: current,
        },
      });
    }

    const document_number = (input.invoice_number ?? '').trim();
    if (!document_number) {
      findings.push({
        code: 'DOCUMENT_NUMBER_MISSING',
        severity: 'blocker',
        category: 'resolution',
        field: 'invoice_number',
        problem: `El documento no tiene número asignado. La DIAN numera por (NIT emisor, resolución, consecutivo) y sin consecutivo no hay documento que autorizar.`,
        fix: `Vuelve a guardar el documento para que se le asigne el siguiente consecutivo de su resolución.`,
        details: scope,
      });
      return findings;
    }

    if (
      prefix &&
      !document_number.toUpperCase().startsWith(prefix.toUpperCase())
    ) {
      findings.push({
        code: 'DOCUMENT_NUMBER_PREFIX_MISMATCH',
        severity: 'blocker',
        category: 'resolution',
        field: 'invoice_number',
        problem: `El documento se numeró como «${document_number}» pero su resolución autoriza el prefijo «${prefix}». La regla FAB10a compara el prefijo declarado en \`sts:AuthorizedInvoices/sts:Prefix\` contra el del documento; si no coinciden, la DIAN no resuelve la autorización.`,
        fix: `Verifica que el documento esté colgando de la resolución correcta en ${SCREEN_RESOLUTIONS}. Si cambiaste de resolución, el consecutivo hay que regenerarlo con el prefijo nuevo.`,
        details: { ...scope, invoice_number: document_number, prefix },
      });
      return findings;
    }

    const sequence = this.sequenceOf(document_number, prefix);
    if (sequence === null) return findings;

    if (sequence < range_from || sequence > range_to) {
      findings.push({
        code: 'DOCUMENT_NUMBER_OUT_OF_RANGE',
        severity: 'blocker',
        category: 'resolution',
        field: 'invoice_number',
        problem: `El consecutivo ${sequence} del documento «${document_number}» cae fuera del rango autorizado ${range_from}..${range_to}. Un número fuera del rango es un documento sin autorización de numeración, y se rechaza aunque todo lo demás esté correcto.`,
        fix: `Carga en ${SCREEN_RESOLUTIONS} la resolución cuyo rango cubre ese consecutivo, o vuelve a numerar el documento con la resolución vigente.`,
        details: {
          ...scope,
          invoice_number: document_number,
          sequence,
          range_from,
          range_to,
        },
      });
    }

    return findings;
  }

  // ---------------------------------------------------------------------------
  // 6b. FORMA DEL NÚMERO DE DOCUMENTO — `cbc:ID`
  // ---------------------------------------------------------------------------

  /**
   * `FAD05a` / `CAD05` / `DAD05`: «No se permiten caracteres adicionales como
   * espacios o guiones».
   *
   * ## Por qué es probable, y no teórico
   *
   * El número sale de concatenar prefijo + consecutivo
   * (`utils/invoice-number-generator.ts:195`), y el prefijo entra al sistema sin
   * validar su clase de caracteres: `CreateResolutionDto` sólo declara
   * `@IsString() @MaxLength(10)`. Un prefijo «FE-» produce «FE-1234», que la
   * DIAN rechaza gastando el consecutivo.
   *
   * ## Por qué ninguna comprobación previa lo atrapaba
   *
   * `DOCUMENT_NUMBER_PREFIX_MISMATCH` compara con `startsWith`, y «FE-1234»
   * empieza por «FE-». `sequenceOf` extrae los dígitos con `replace(/\D/g,'')`
   * y obtiene 1234, que está en rango. Todas las comprobaciones de numeración
   * pasan sobre un número que la DIAN rechaza — el hueco exacto que esto cierra.
   *
   * ## Fuera del alcance de `checkResolution`, a propósito
   *
   * Vive aparte porque `cbc:ID` lo lleva TODO documento, tenga o no rango
   * autorizado, y porque no debe pasar por
   * {@link softenWhenControlBlockIsNotTransmitted}: aquel atenúa hallazgos sobre
   * un bloque que el emisor NO transmite, y `cbc:ID` sí se transmite siempre.
   */
  private checkDocumentNumberShape(
    input: FiscalDocumentValidationInput,
  ): FiscalDocumentFinding[] {
    // Sin elemento raíz UBL (nómina) ninguna de las tres tablas lo juzga.
    if (ublRootDocumentFor(input.document_type) === null) return [];

    const document_number = (input.invoice_number ?? '').trim();
    // Un número ausente ya lo denuncia `DOCUMENT_NUMBER_MISSING` donde
    // corresponde; repetirlo acá enterraría el mensaje que sí explica qué pasa.
    if (!document_number) return [];

    const findings: FiscalDocumentFinding[] = [];
    const prefix = (input.resolution?.prefix ?? '').trim();
    const prefix_is_source = !!prefix && !DOCUMENT_NUMBER_PATTERN.test(prefix);

    if (!DOCUMENT_NUMBER_PATTERN.test(document_number)) {
      const offenders = [
        ...new Set(document_number.replace(/[0-9A-Za-z]/g, '').split('')),
      ]
        .map((character) => (character === ' ' ? 'espacio' : `«${character}»`))
        .join(', ');

      findings.push({
        code: 'DOCUMENT_NUMBER_NOT_ALPHANUMERIC',
        severity: 'blocker',
        category: 'resolution',
        field: 'invoice_number',
        problem: `El documento se numeró como «${document_number}», que contiene ${offenders}. El número de documento sólo admite letras y dígitos: la DIAN rechaza el \`cbc:ID\` con el mensaje «No se permiten caracteres adicionales como espacios o guiones», y el consecutivo se pierde.`,
        fix: prefix_is_source
          ? `El carácter viene del prefijo «${prefix}» de la resolución. Corrígelo en ${SCREEN_RESOLUTIONS} dejándolo sólo con letras y dígitos, y vuelve a numerar el documento: mientras el prefijo no cambie, cada consecutivo nuevo nacerá con el mismo defecto.`
          : `Vuelve a numerar el documento para que su número quede sólo con letras y dígitos. Si el carácter viene de una captura manual del número, corrígelo en ${SCREEN_DOCUMENT_HEADER}.`,
        details: {
          invoice_number: document_number,
          ...(prefix ? { prefix } : {}),
          prefix_is_source,
        },
      });
    }

    if (document_number.length > DOCUMENT_NUMBER_MAX_LENGTH) {
      findings.push({
        code: 'DOCUMENT_NUMBER_TOO_LONG',
        severity: 'blocker',
        category: 'resolution',
        field: 'invoice_number',
        problem: `El número «${document_number}» tiene ${document_number.length} caracteres y el \`cbc:ID\` admite como máximo ${DOCUMENT_NUMBER_MAX_LENGTH}. El documento no pasa ni la validación de esquema de la DIAN.`,
        fix: `Acorta el prefijo de la resolución en ${SCREEN_RESOLUTIONS} —es lo único que se puede acortar sin romper el consecutivo— y vuelve a numerar el documento.`,
        details: {
          invoice_number: document_number,
          length: document_number.length,
          max_length: DOCUMENT_NUMBER_MAX_LENGTH,
        },
      });
    }

    return findings;
  }

  // ---------------------------------------------------------------------------
  // 7. CLAVE TÉCNICA (ClTec)
  // ---------------------------------------------------------------------------

  /**
   * EL VALOR NO SE IMPRIME NUNCA. Ni en el mensaje, ni en `details`, ni en un log.
   *
   * La ClTec es un secreto fiscal y es la única entrada del CUFE que el XML no
   * transporta: quien la tenga puede reproducir la huella de cualquier documento
   * del contribuyente. Del hallazgo sale su LONGITUD, que es exactamente el dato
   * que hace falta para corregirla —«tienes 38, faltan 2»— y nada más.
   *
   * Este es el defecto que cerró todo este trabajo: el 14/08/2026 una ClTec de 38
   * caracteres, todos hexadecimales y sin nada visible que la delatara, hizo que
   * la DIAN recomputara el CUFE con la clave verdadera y rechazara una factura
   * real. El consecutivo autorizado que gastó no se recupera.
   */
  private checkTechnicalKey(
    input: FiscalDocumentValidationInput,
  ): FiscalDocumentFinding[] {
    const requirements = requirementsFor(input.document_type);
    const raw = input.resolution?.technical_key;
    const normalized = normalizeTechnicalKey(raw);

    if (!acceptsTechnicalKey(input.document_type)) {
      if (!normalized) return [];
      return [
        {
          code: 'TECHNICAL_KEY_NOT_APPLICABLE',
          severity: 'warning',
          category: 'technical_key',
          field: 'resolution.technical_key',
          problem: `${requirements.label} no usa clave técnica: su ${requirements.key_algorithm} lleva el Software-PIN como 14º campo. Guardar una ClTec en esta resolución sugiere que se va a firmar con ella, y no es lo que ocurre.`,
          fix: `Borra la clave técnica de esta resolución en ${SCREEN_RESOLUTIONS}: no se usa y su presencia confunde a quien la revise.`,
        },
      ];
    }

    if (!normalized) {
      return [
        {
          code: 'TECHNICAL_KEY_REQUIRED',
          severity: 'blocker',
          category: 'technical_key',
          field: 'resolution.technical_key',
          problem: `${requirements.label} arma su ${requirements.key_algorithm} con la clave técnica (ClTec) del rango, y la resolución no la tiene. Firmar con el Software-PIN en su lugar produce una clave que la DIAN rechaza, gastando el consecutivo.`,
          fix: `Copia la clave técnica completa del PDF de la autorización de numeración de la DIAN en ${SCREEN_RESOLUTIONS}. Son ${TECHNICAL_KEY_LENGTHS_LABEL} caracteres hexadecimales.`,
        },
      ];
    }

    if (isWellFormedTechnicalKey(normalized)) return [];

    return [
      {
        code: 'TECHNICAL_KEY_MALFORMED',
        severity: 'blocker',
        category: 'technical_key',
        field: 'resolution.technical_key',
        problem: `La clave técnica (ClTec) de la resolución tiene ${normalized.length} caracteres y la DIAN la emite de ${TECHNICAL_KEY_LENGTHS_LABEL} hexadecimales. La ClTec es el único dato del ${requirements.key_algorithm} que NO viaja en el XML: la DIAN recomputa la huella con la clave verdadera, no coincide, y rechaza el documento con el consecutivo ya gastado.`,
        fix: `Vuelve a copiar la clave técnica COMPLETA del PDF de la autorización de numeración en ${SCREEN_RESOLUTIONS}. Verifica que sean ${TECHNICAL_KEY_LENGTHS_LABEL} caracteres y que no se haya perdido ninguno al copiar.`,
        // Solo la longitud. El valor es un secreto fiscal y no sale de acá.
        details: {
          technical_key_length: normalized.length,
          expected_lengths: [...TECHNICAL_KEY_LENGTHS],
        },
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // AUXILIARES
  // ---------------------------------------------------------------------------

  /**
   * Esquema DIAN del impuesto, delegado en `UblCommonBuilder.resolveTaxCodeFromTax`
   * — la ÚNICA clasificación del dominio, la misma que usa el emisor y el motor
   * aritmético. Una segunda tabla de nombres acá aprobaría documentos que el
   * emisor agrupa distinto.
   */
  private schemeCodeOf(tax: FiscalDocumentTaxInput): string {
    return UblCommonBuilder.resolveTaxCodeFromTax(this.emitterProbeOf(tax));
  }

  /**
   * `true` si la fila es una RETENCIÓN, según el MISMO predicado con el que el
   * emisor decide descartarla de `cac:TaxTotal`.
   *
   * Se pregunta a `UblCommonBuilder` en vez de mirar el código a mano por la
   * misma razón que `schemeCodeOf`: si el validador tuviera su propia lista de
   * esquemas de retención, bastaría con que el emisor añadiera uno para que el
   * validador aprobara filas que el XML luego descarta —o bloqueara filas que
   * el XML sí emite.
   */
  private isWithholdingRow(tax: FiscalDocumentTaxInput): boolean {
    return UblCommonBuilder.isWithholdingTax(this.emitterProbeOf(tax));
  }

  /**
   * La fila con la forma que esperan las funciones del emisor. Los importes van
   * en cero a propósito: sólo se usa para CLASIFICAR (nombre, tipo y tarifa), y
   * un importe real acá sólo invitaría a que alguien lo confundiera con el dato.
   */
  private emitterProbeOf(tax: FiscalDocumentTaxInput): ProviderInvoiceTax {
    return {
      tax_name: (tax.tax_name ?? '').trim(),
      tax_type: (tax.tax_type ?? '').trim() || undefined,
      tax_rate: dianRate(tax.tax_rate),
      taxable_amount: dianAmount(0),
      tax_amount: dianAmount(0),
    };
  }

  /**
   * `base × tarifa`, con la unidad de la tarifa que corresponda al esquema.
   *
   * El ICA se guarda POR MIL (7 significa 7 ‰ = 0,7 %) y el emisor lo divide por
   * 10 antes de escribir `cbc:Percent`. Aplicarle `/100` a una tarifa por mil
   * cobraría diez veces el ICA que corresponde.
   *
   * El ReteICA (`07`) también se guarda por mil, pero NO llega hasta acá:
   * `checkTaxSubtotals` aparta las retenciones antes, porque el emisor las
   * descarta del XML. Si algún día una retención sí viajara en `cac:TaxTotal`,
   * este divisor tendría que cubrir su esquema — y ese cambio empieza allá.
   */
  private expectedTaxAmount(
    taxable: Prisma.Decimal,
    rate: Prisma.Decimal,
    scheme: string,
  ): string {
    const divisor =
      scheme === DIAN_TAX_CODES.ICA
        ? new Prisma.Decimal(1000)
        : new Prisma.Decimal(100);
    return dianAmount(taxable.times(rate).dividedBy(divisor));
  }

  /** «19,00 %» o «7,00 ‰» — la unidad correcta según el esquema. */
  private describeRate(rate: Prisma.Decimal, scheme: string): string {
    return scheme === DIAN_TAX_CODES.ICA
      ? `${dianRate(rate)} ‰`
      : `${dianRate(rate)} %`;
  }

  /** «Línea 3 (Queso costeño)» — para que el mensaje diga cuál es. */
  private lineLabel(item: FiscalDocumentLineInput, index: number): string {
    const number = item.line_number ?? index + 1;
    const description = (item.description ?? '').trim();
    return description
      ? `La línea ${number} («${description}»)`
      : `La línea ${number}`;
  }

  /**
   * Parte numérica del consecutivo. `FE-1234` → `1234`.
   *
   * Devuelve `null` cuando no hay dígitos que leer: un número sin parte numérica
   * ya lo denuncia la comprobación de prefijo, y adivinar un consecutivo de la
   * nada produciría un «fuera de rango» falso.
   */
  private sequenceOf(document_number: string, prefix: string): number | null {
    const tail = prefix
      ? document_number.slice(prefix.length)
      : document_number;
    const digits = tail.replace(/\D/g, '');
    if (!digits) return null;
    const parsed = Number(digits);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  /** Acepta `Date` o cadena ISO. `null` ante cualquier valor no interpretable. */
  private toDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /**
   * `YYYY-MM-DD` en UTC.
   *
   * UTC y no la zona del emisor a propósito: `valid_from`/`valid_to` son
   * FECHA-SÓLO guardadas como medianoche UTC, y convertirlas a America/Bogota
   * (UTC-5) devuelve el día anterior — el mismo desplazamiento que hacía a la
   * DIAN rechazar por FAB07b/FAB08b. Regla: instante → zona del emisor;
   * fecha-sólo → UTC, tal como se guardó.
   */
  private dateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private buildReport(
    document_type: FiscalDocumentType,
    findings: FiscalDocumentFinding[],
    computed: FiscalDocumentComputedTotals,
  ): FiscalDocumentReport {
    const blockers = findings.filter((f) => f.severity === 'blocker');
    const warnings = findings.filter((f) => f.severity === 'warning');

    return {
      emittable: blockers.length === 0,
      document_type,
      findings,
      blockers,
      warnings,
      computed,
    };
  }
}
