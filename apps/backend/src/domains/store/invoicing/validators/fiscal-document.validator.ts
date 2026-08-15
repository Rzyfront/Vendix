import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DIAN_DOCUMENT_CURRENCY,
  FiscalDocumentType,
  TECHNICAL_KEY_LENGTH,
  acceptsTechnicalKey,
  isWellFormedTechnicalKey,
  monetaryTotalElementFor,
  normalizeTechnicalKey,
  requirementsFor,
  requiresAuthorizedRange,
  requiresLines,
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
 * Reglas cubiertas (Anexo Técnico 1.9, Res. DIAN 000165/2023):
 *
 *   1. `FAU14` — el `LineExtensionAmount` de cabecera contra la suma de los
 *      importes de línea **ya truncados**, que es lo que la DIAN recomputa.
 *   2. `TaxAmount = TaxableAmount × Percent/100` por cada `cac:TaxSubtotal`.
 *   3. `PayableAmount = LineExtension − Allowance + Impuestos`, y —lo crítico—
 *      SIN restar `cac:WithholdingTaxTotal` (§11.9.1) ni `cbc:PrepaidAmount`
 *      (§11.9.2).
 *   4. Resolución de numeración: vigente en la FECHA DE EMISIÓN, con consecutivo
 *      disponible y prefijo coherente con el número que se va a emitir.
 *   5. ClTec: presente y de 40 caracteres hexadecimales cuando el documento la
 *      exige.
 *   6. Moneda del documento = COP.
 *   7. Unidad de medida de cada línea dentro del catálogo que la DIAN acepta.
 *   8. `CustomizationID` coherente con el contenido (AIU '09').
 *   9. Al menos una línea, con cantidad positiva y descripción.
 *
 * ## PENDIENTE DECLARADO: validación XSD / Schematron
 *
 * La comprobación estructural contra los `.xsd` y el
 * `DIAN_UBL21-listacodigos_v1.6.sch` de la Caja de Herramientas NO se hace aquí:
 * esos esquemas no están en el repositorio. Cuando se incorporen, el sitio para
 * cablearlos es el mismo `validate()` que consume este validador, DESPUÉS de
 * estas reglas — porque un XSD dice «el elemento X falta» y estas reglas dicen
 * «el IVA no cuadra y se corrige en tal pantalla», que es lo que el comerciante
 * puede accionar. Las reglas de negocio son además las que producen la mayoría de
 * los rechazos reales; el XSD atrapa lo que un builder roto emitiría, no lo que
 * un dato mal capturado produce.
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
  // Aritmética
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
  | 'DOCUMENT_NUMBER_PREFIX_MISMATCH'
  | 'DOCUMENT_NUMBER_OUT_OF_RANGE'
  | 'DOCUMENT_NUMBER_MISSING'
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
  /** Datos seguros para el cliente. NUNCA un secreto fiscal. */
  details?: Record<string, unknown>;
}

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
    findings.push(...this.checkTaxSubtotals(taxes));
    findings.push(...this.checkArithmetic(input, computed));
    findings.push(...this.checkResolution(input));
    findings.push(...this.checkTechnicalKey(input));

    return this.buildReport(input.document_type, findings, computed);
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
    // Se suman las filas que el emisor EMITE, no todas las persistidas:
    // `buildTaxTotals` descarta las retenciones que el camino legacy de
    // `dto.taxes[]` pudo dejar en `invoice_taxes`. Sumarlas acá haría que este
    // total nunca coincidiera con el del XML, y el desajuste se leería en las
    // dos direcciones: bloquearía documentos sanos cuya cabecera —con razón— no
    // cuenta la retención, y aprobaría el caso contrario, que sí lo rechaza la
    // DIAN. El validador tiene que sumar lo mismo que suma el XML.
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
      // 1. `buildTaxTotals` la DESCARTA antes de escribir el XML
      //    (`ubl-common.builder.ts:968`). El importe que este bloque compararía
      //    no llega a la DIAN, así que no puede provocar un rechazo. Bloquear
      //    por él sería inventarse un requisito — el mismo criterio que rige
      //    para el bloque de control que no se transmite.
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

    // --- FAU14 ---------------------------------------------------------------
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
        problem: `El documento declara una base de ${dianAmount(declared_subtotal)}, pero la suma de los importes de sus líneas —ya truncados, que es como viajan en el XML— da ${computed.line_extension_amount}. La regla FAU14 exige que \`${element}/cbc:LineExtensionAmount\` sea exactamente esa suma, y es la regla que más rechazos produce.`,
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

    // --- `PayableAmount` -----------------------------------------------------
    findings.push(...this.checkPayableAmount(input, computed, element));

    return findings;
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
          fix: `Copia la clave técnica completa del PDF de la autorización de numeración de la DIAN en ${SCREEN_RESOLUTIONS}. Son ${TECHNICAL_KEY_LENGTH} caracteres hexadecimales.`,
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
        problem: `La clave técnica (ClTec) de la resolución tiene ${normalized.length} caracteres y la DIAN emite exactamente ${TECHNICAL_KEY_LENGTH} hexadecimales. La ClTec es el único dato del ${requirements.key_algorithm} que NO viaja en el XML: la DIAN recomputa la huella con la clave verdadera, no coincide, y rechaza el documento con el consecutivo ya gastado.`,
        fix: `Vuelve a copiar la clave técnica COMPLETA del PDF de la autorización de numeración en ${SCREEN_RESOLUTIONS}. Verifica que sean ${TECHNICAL_KEY_LENGTH} caracteres y que no se haya perdido ninguno al copiar.`,
        // Solo la longitud. El valor es un secreto fiscal y no sale de acá.
        details: {
          technical_key_length: normalized.length,
          expected_length: TECHNICAL_KEY_LENGTH,
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
