import type {
  dian_configuration_type_enum,
  fiscal_document_type_enum,
} from '@prisma/client';

/**
 * CONTRATO ÚNICO DE REQUISITOS POR TIPO DE DOCUMENTO FISCAL DIAN.
 *
 * ## Por qué existe
 *
 * La respuesta a «¿qué necesita este documento para poder emitirse?» vivía
 * repartida en tres funciones privadas que nadie podía importar:
 *
 *   - `InvoicingService.toFiscalDocumentType` / `.isSupportDocumentType`
 *     (`invoicing.service.ts`) — traduce `invoice_type_enum` a
 *     `fiscal_document_type_enum`.
 *   - `InvoiceFlowService.configurationType` / `.isEquivalentDocumentType`
 *     (`invoice-flow/invoice-flow.service.ts`) — decide qué habilitación DIAN
 *     cubre el documento.
 *   - `FiscalProductionReadinessService.defaultDocumentType`
 *     (`providers/fiscal-production-readiness.service.ts`) — el inverso.
 *
 * Al ser privadas, cada validación nueva se reescribía desde cero y podía
 * contradecir a las otras: la UI del comerciante y la consola de superadmin no
 * tenían de dónde leer la regla, así que la deducían. Este módulo es esa fuente
 * única — PURO a propósito (sin Nest, sin Prisma en runtime, sin HTTP) para que
 * el panel, la consola, los guards de emisión y los tests lean exactamente la
 * misma tabla y no puedan divergir.
 *
 * ## Qué NO hace
 *
 * No emite ni numera. Declara el requisito; quien lo aplica (guards, DTOs,
 * servicios) lo consume.
 *
 * La excepción, y es deliberada: `internal_series_prefix` es lo que
 * `generateNextNumber` (`utils/invoice-number-generator.ts`) consulta para
 * decidir si puede dar de alta y ampliar una serie él solo. Antes esa tabla no
 * gobernaba nada del generador y las notas se bloqueaban por falta de una fila
 * que nadie creaba nunca; la regla vive aquí porque el que añade un tipo al enum
 * es quien tiene que decidir si su numeración es nuestra o de la DIAN.
 *
 * ## Las dos preguntas que la tabla separa (y que se confundían)
 *
 * 1. `requires_authorized_range` — ¿la DIAN emite **Autorización de Numeración**
 *    para este documento? Es decir: ¿el consecutivo sale de un rango que la DIAN
 *    autorizó en MUISCA, y por tanto la fila `invoice_resolutions` respalda un
 *    acto administrativo real?
 * 2. `accepts_technical_key` — ¿la clave del documento se alimenta de la **ClTec**
 *    del rango, o de otro secreto?
 *
 * No son la misma pregunta y la segunda no se deduce de la primera: el documento
 * equivalente POS SÍ cuelga de un rango autorizado propio y aun así su clave se
 * arma con el Software-PIN, no con la ClTec (ver tabla en
 * `providers/dian-direct/xml/ubl-equivalent-document.builder.ts`).
 */

/** Tipo de documento fiscal. Espejo del enum persistido `fiscal_document_type_enum`. */
export type FiscalDocumentType = fiscal_document_type_enum;

/** Habilitación DIAN. Espejo del enum persistido `dian_configuration_type_enum`. */
export type DianConfigurationType = dian_configuration_type_enum;

/**
 * Algoritmo del código único del documento. Cada uno cambia el 14º campo del
 * hash SHA-384, y equivocarlo produce una clave que la DIAN rechaza gastando un
 * consecutivo autorizado que no se recupera.
 *
 * - `CUFE` — 14º campo = **ClTec** de la resolución. Solo factura de venta.
 * - `CUDE` — 14º campo = **Software-PIN**. Notas crédito/débito y documento
 *   equivalente (`CufeCalculator.generateEquivalentDocumentCude`).
 * - `CUDS` — documento soporte y su nota de ajuste. También Software-PIN.
 * - `CUNE` — nómina electrónica (DSPNE) y su nota de ajuste.
 */
export type FiscalKeyAlgorithm = 'CUFE' | 'CUDE' | 'CUDS' | 'CUNE';

/** Requisitos DIAN de UN tipo de documento fiscal. */
export interface FiscalDocumentRequirements {
  /** El propio tipo, para que una entrada suelta siga sabiendo quién es. */
  document_type: FiscalDocumentType;
  /** Habilitación del software que cubre este documento. */
  configuration_type: DianConfigurationType;
  /**
   * ¿La DIAN emite Autorización de Numeración para este documento?
   *
   * `false` NO significa «no necesita fila en `invoice_resolutions`»: el
   * generador de consecutivos la sigue usando como cursor. Significa que esa
   * fila es una **fuente de consecutivo interno**, y que su `resolution_number`
   * es un rótulo del comerciante, no una autorización DIAN que la validación
   * pueda exigir ni confrontar. De ahí {@link internal_series_prefix}: lo que no
   * respalda un acto administrativo tampoco tiene por qué esperar a que alguien
   * lo dé de alta a mano.
   */
  requires_authorized_range: boolean;
  /**
   * Prefijo de la serie interna que el generador da de alta y amplía SOLO, o
   * `null` cuando el consecutivo de este documento no es nuestro.
   *
   * Es la llave de las dos automatismos de `invoice-number-generator.ts`
   * —auto-alta cuando no hay fila, auto-extensión cuando el rango se acaba— y
   * por eso se declara aquí y no como una lista suelta en el generador: fabricar
   * o ampliar numeración de un documento que la DIAN SÍ autoriza por rango es
   * emitir fuera de la Autorización de Numeración, con rechazo garantizado y
   * consecutivo quemado. Con el prefijo en la tabla, quien añada un tipo al enum
   * tiene que decidir explícitamente de qué lado cae.
   *
   * `null` cubre dos casos distintos que aquí se comportan igual:
   * - rango autorizado por la DIAN (`sales_invoice`, `support_document`,
   *   `pos_equivalent_document`) — el alta es un acto del comerciante en MUISCA;
   * - numeración que no cuelga de `invoice_resolutions` en absoluto (`payroll`,
   *   `payroll_adjustment`, que llevan su propio `NumNE`).
   */
  internal_series_prefix: string | null;
  /**
   * ¿La clave de este documento se alimenta de la ClTec del rango?
   *
   * Solo la factura electrónica de venta. Todo lo demás usa el Software-PIN como
   * 14º campo por diseño del esquema DIAN.
   */
  accepts_technical_key: boolean;
  /** Algoritmo del código único. */
  key_algorithm: FiscalKeyAlgorithm;
  /** Rótulo en español para la UI del panel y de la consola. */
  label: string;
  /**
   * ¿El documento se compone de LÍNEAS de venta (`cac:InvoiceLine`,
   * `cac:CreditNoteLine`, `cac:DebitNoteLine`)?
   *
   * La nómina electrónica no: el DSPNE declara devengados y deducciones, no
   * líneas de un catálogo. Exigirle «al menos una línea» la bloquearía siempre.
   */
  requires_lines: boolean;
  /**
   * Nombre UBL del grupo de totales, o `null` cuando el documento no lo lleva.
   *
   * NO ES COSMÉTICO Y NO ES UN SINÓNIMO. La nota débito lo nombra
   * `cac:RequestedMonetaryTotal` y todo lo demás `cac:LegalMonetaryTotal`; la
   * DIAN publica un XPath distinto por tipo (Anexo 1.9 §11.4.6), así que emitir
   * el nombre equivocado publica los importes donde nadie los lee y rechaza por
   * DAU01/DAU02/DAU04/DAU06 a la vez. Se declara aquí para que la prevalidación
   * pueda NOMBRAR el elemento correcto en su mensaje en vez de decir «los
   * totales» y dejar al operador buscando cuál.
   */
  monetary_total_element: 'LegalMonetaryTotal' | 'RequestedMonetaryTotal' | null;
  /**
   * ¿`operation_type` (el `cbc:CustomizationID`) de este documento se lee de la
   * tabla `TipoOperacionF-2.1.gc` — la de FACTURA?
   *
   * Las notas tienen tablas propias (`TipoOperacionNC` / `TipoOperacionND`) cuyos
   * valores NO se solapan con los de factura: '20' es una nota crédito con
   * referencia, no una factura de exportación. Juzgar el `operation_type` de una
   * nota contra la tabla de factura la rechazaría por FAD02 estando bien.
   */
  uses_invoice_operation_types: boolean;
  /**
   * Elemento raíz del XML UBL que Vendix emite para este documento.
   *
   * ES LO QUE DECIDE QUÉ TABLA DE REGLAS DE LA DIAN LO JUZGA. El Anexo Técnico
   * 1.9 no publica tablas por «tipo de documento de negocio» sino por elemento
   * raíz: §8.2 `Invoice` (ids `FA*`), §8.3 `CreditNote` (ids `CA*`), §8.4
   * `DebitNote` (ids `DA*`). Un documento equivalente POS no tiene familia de
   * reglas propia: sale como `<Invoice>` con `InvoiceTypeCode` '20'
   * (`ubl-equivalent-document.builder.ts:89`) y por tanto lo rechaza `FAD05a`,
   * no un identificador inventado para el DE. Lo mismo el documento soporte
   * (`ubl-support-document.builder.ts:45`) y, del otro lado, la nota de ajuste
   * al documento soporte, que sale como `<CreditNote>`
   * (`ubl-support-document.builder.ts:108`) y cae bajo `CA*`.
   *
   * `null` para nómina: el DSPNE no es UBL de facturación y ninguna de esas tres
   * tablas lo juzga.
   */
  ubl_root_document: 'Invoice' | 'CreditNote' | 'DebitNote' | null;
  /**
   * ¿El constructor XML de este documento emite `cac:AllowanceCharge` a nivel de
   * documento cuando hay descuento global?
   *
   * NO ES UN DETALLE DE IMPLEMENTACIÓN: `FAU08`/`CAU08`/`DAU08` exigen que
   * `cbc:AllowanceTotalAmount` sea igual a la suma de los `cac:AllowanceCharge`
   * con `ChargeIndicator = false`. Si el documento publica el total de descuento
   * pero NO publica el grupo que lo respalda, esa suma es 0 y la DIAN rechaza —
   * gastando el consecutivo. Sólo `ubl-invoice.builder.ts` y
   * `ubl-equivalent-document.builder.ts:162` llaman a
   * `UblCommonBuilder.buildDocumentAllowanceCharge`; la nota crédito
   * (`ubl-credit-note.builder.ts:172`), la nota débito
   * (`ubl-debit-note.builder.ts:194`) y el documento soporte
   * (`ubl-support-document.builder.ts:318`) van directo al grupo de totales.
   */
  emits_document_allowance_charge: boolean;
}

/**
 * Los 9 tipos, en el orden en que se declaran en `schema.prisma`. Sirve para
 * recorrer la tabla en una UI sin depender del orden de `Object.keys`.
 */
export const FISCAL_DOCUMENT_TYPES = [
  'sales_invoice',
  'credit_note',
  'debit_note',
  'support_document',
  'support_adjustment_note',
  'payroll',
  'payroll_adjustment',
  'pos_equivalent_document',
  'equivalent_adjustment_note',
] as const satisfies readonly FiscalDocumentType[];

/** Las 4 habilitaciones, en el orden de `dian_configuration_type_enum`. */
export const DIAN_CONFIGURATION_TYPES = [
  'invoicing',
  'support_document',
  'payroll',
  'equivalent_document',
] as const satisfies readonly DianConfigurationType[];

/**
 * LA TABLA. `Record<FiscalDocumentType, …>` es deliberado: añadir un valor al
 * enum de Prisma sin añadirlo aquí rompe la compilación, que es exactamente el
 * momento en que hay que decidir sus requisitos y no seis pantallas después.
 */
export const FISCAL_DOCUMENT_REQUIREMENTS: Readonly<
  Record<FiscalDocumentType, FiscalDocumentRequirements>
> = Object.freeze({
  /**
   * El ÚNICO que exige clave técnica. `DianDirectProvider.sendInvoice` falla duro
   * sin `technical_key` en lugar de caer al Software-PIN, porque firmar el CUFE
   * con el PIN produce una clave que la DIAN rechaza.
   */
  sales_invoice: {
    document_type: 'sales_invoice',
    configuration_type: 'invoicing',
    requires_authorized_range: true,
    internal_series_prefix: null,
    accepts_technical_key: true,
    key_algorithm: 'CUFE',
    label: 'Factura electrónica de venta',
    requires_lines: true,
    monetary_total_element: 'LegalMonetaryTotal',
    uses_invoice_operation_types: true,
    ubl_root_document: 'Invoice',
    emits_document_allowance_charge: true,
  },
  /**
   * La DIAN no emite Autorización de Numeración para las notas: la Res.
   * 000165/2023 las regula como mecanismo de anulación/ajuste de un documento ya
   * emitido, sin rango autorizado propio. La fila `invoice_resolutions` de notas
   * sigue existiendo como fuente de consecutivo interno — sin ella
   * `generateNextNumber` lanza `FISCAL_RESOLUTION_MISSING` —, pero no se le puede
   * exigir número de resolución DIAN ni clave técnica.
   *
   * Su CUDE se arma con `config.software_pin` como 14º campo
   * (`DianDirectProvider.sendCreditNote` / `.sendDebitNote`).
   */
  credit_note: {
    document_type: 'credit_note',
    configuration_type: 'invoicing',
    requires_authorized_range: false,
    internal_series_prefix: 'NC',
    accepts_technical_key: false,
    key_algorithm: 'CUDE',
    label: 'Nota crédito',
    requires_lines: true,
    monetary_total_element: 'LegalMonetaryTotal',
    uses_invoice_operation_types: false,
    ubl_root_document: 'CreditNote',
    emits_document_allowance_charge: false,
  },
  debit_note: {
    document_type: 'debit_note',
    configuration_type: 'invoicing',
    requires_authorized_range: false,
    internal_series_prefix: 'ND',
    accepts_technical_key: false,
    key_algorithm: 'CUDE',
    label: 'Nota débito',
    requires_lines: true,
    // El ÚNICO documento cuyo grupo de totales NO es `cac:LegalMonetaryTotal`.
    monetary_total_element: 'RequestedMonetaryTotal',
    uses_invoice_operation_types: false,
    ubl_root_document: 'DebitNote',
    emits_document_allowance_charge: false,
  },
  /**
   * Documento soporte en adquisiciones a no obligados a facturar (Res.
   * 000167/2021): numeración consecutiva autorizada por la DIAN, habilitación
   * propia. Su CUDS usa Software-PIN como 14º campo.
   */
  support_document: {
    document_type: 'support_document',
    configuration_type: 'support_document',
    requires_authorized_range: true,
    internal_series_prefix: null,
    accepts_technical_key: false,
    key_algorithm: 'CUDS',
    label: 'Documento soporte',
    requires_lines: true,
    monetary_total_element: 'LegalMonetaryTotal',
    uses_invoice_operation_types: false,
    ubl_root_document: 'Invoice',
    emits_document_allowance_charge: false,
  },
  /** Nota de ajuste al documento soporte: ajusta, no numera contra rango propio. */
  support_adjustment_note: {
    document_type: 'support_adjustment_note',
    configuration_type: 'support_document',
    requires_authorized_range: false,
    internal_series_prefix: 'NAS',
    accepts_technical_key: false,
    key_algorithm: 'CUDS',
    label: 'Nota de ajuste al documento soporte',
    requires_lines: true,
    monetary_total_element: 'LegalMonetaryTotal',
    uses_invoice_operation_types: false,
    ubl_root_document: 'CreditNote',
    emits_document_allowance_charge: false,
  },
  /**
   * Nómina electrónica. NO lleva resolución de numeración: el DSPNE numera con su
   * propio consecutivo `NumNE`, y por eso `FiscalProductionReadinessService`
   * excluye explícitamente `payroll` de `assertResolutionReady` — exigirle rango
   * bloquearía la habilitación de nómina de forma permanente.
   */
  payroll: {
    document_type: 'payroll',
    configuration_type: 'payroll',
    requires_authorized_range: false,
    // `null` por una razón DISTINTA a la de la factura: no es que su rango lo
    // autorice la DIAN, es que la nómina no numera contra `invoice_resolutions`
    // en absoluto — lleva su propio `NumNE`. Darle serie interna crearía un
    // cursor que nadie lee y que contradice al que sí manda.
    internal_series_prefix: null,
    accepts_technical_key: false,
    key_algorithm: 'CUNE',
    label: 'Nómina electrónica',
    // El DSPNE declara devengados y deducciones, no líneas de catálogo, y su
    // grupo de totales es `cac:...` propio del esquema de nómina. La aritmética
    // de factura no le aplica y prevalidarla contra ella la bloquearía siempre.
    requires_lines: false,
    monetary_total_element: null,
    uses_invoice_operation_types: false,
    ubl_root_document: null,
    emits_document_allowance_charge: false,
  },
  payroll_adjustment: {
    document_type: 'payroll_adjustment',
    configuration_type: 'payroll',
    requires_authorized_range: false,
    // Mismo motivo que `payroll`: `NumNE`, no `invoice_resolutions`.
    internal_series_prefix: null,
    accepts_technical_key: false,
    key_algorithm: 'CUNE',
    label: 'Nota de ajuste de nómina electrónica',
    requires_lines: false,
    monetary_total_element: null,
    uses_invoice_operation_types: false,
    ubl_root_document: null,
    emits_document_allowance_charge: false,
  },
  /**
   * Documento equivalente electrónico del tiquete POS (Res. 000165/2023,
   * `InvoiceTypeCode` '20'). Tiene rango autorizado PROPIO — compartir el de la
   * factura de venta quemaría consecutivos FEV en tiquetes POS — y aun así su
   * clave es un CUDE con Software-PIN, no un CUFE con ClTec. Es el caso que
   * demuestra que rango autorizado y clave técnica son dos preguntas distintas.
   */
  pos_equivalent_document: {
    document_type: 'pos_equivalent_document',
    configuration_type: 'equivalent_document',
    requires_authorized_range: true,
    internal_series_prefix: null,
    accepts_technical_key: false,
    key_algorithm: 'CUDE',
    label: 'Documento equivalente POS',
    requires_lines: true,
    monetary_total_element: 'LegalMonetaryTotal',
    uses_invoice_operation_types: false,
    ubl_root_document: 'Invoice',
    emits_document_allowance_charge: true,
  },
  /**
   * Nota de ajuste al documento equivalente ('93' débito / '94' crédito, numeral
   * 16.3). El DE no tiene nota crédito/débito propia — solo estas.
   */
  equivalent_adjustment_note: {
    document_type: 'equivalent_adjustment_note',
    configuration_type: 'equivalent_document',
    requires_authorized_range: false,
    internal_series_prefix: 'NAE',
    accepts_technical_key: false,
    key_algorithm: 'CUDE',
    label: 'Nota de ajuste al documento equivalente',
    requires_lines: true,
    monetary_total_element: 'LegalMonetaryTotal',
    uses_invoice_operation_types: false,
    ubl_root_document: 'Invoice',
    emits_document_allowance_charge: true,
  },
});

/** ¿Es `value` un `fiscal_document_type_enum` válido? Guard para entrada externa. */
export function isFiscalDocumentType(
  value: unknown,
): value is FiscalDocumentType {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(FISCAL_DOCUMENT_REQUIREMENTS, value)
  );
}

/** Los requisitos declarados para un tipo de documento. */
export function requirementsFor(
  document_type: FiscalDocumentType,
): FiscalDocumentRequirements {
  return FISCAL_DOCUMENT_REQUIREMENTS[document_type];
}

/**
 * Prefijo de la serie interna de este documento, o `null` si su numeración no
 * es nuestra.
 *
 * Es el único predicado que autoriza a `generateNextNumber` a crear una fila de
 * `invoice_resolutions` o a ampliarle el rango. Se lee como pregunta: «¿el
 * consecutivo de este documento lo pone el comerciante o lo autorizó la DIAN?».
 * Devolver un prefijo para un documento con Autorización de Numeración sería
 * numerar fuera de ella.
 */
export function internalSeriesPrefixFor(
  document_type: FiscalDocumentType,
): string | null {
  return FISCAL_DOCUMENT_REQUIREMENTS[document_type].internal_series_prefix;
}

/**
 * Qué habilitación DIAN cubre este documento.
 *
 * Sustituto de `InvoiceFlowService.configurationType`, pero indexado por
 * `fiscal_document_type_enum` en vez de por `invoice_type_enum`: para partir de
 * un `invoice_type` primero se pasa por {@link toFiscalDocumentType}.
 */
export function configurationTypeFor(
  document_type: FiscalDocumentType,
): DianConfigurationType {
  return FISCAL_DOCUMENT_REQUIREMENTS[document_type].configuration_type;
}

/**
 * Documento que representa a una habilitación cuando no se especifica otro.
 *
 * Réplica exacta de `FiscalProductionReadinessService.defaultDocumentType`,
 * incluida su parte no obvia: `equivalent_document` → `pos_equivalent_document`,
 * NUNCA `sales_invoice`. Comprobar el rango de la factura de venta aquí reportaría
 * una configuración de DE lista sobre la fuerza de un rango que jamás debe
 * consumir.
 */
export function defaultDocumentTypeFor(
  configuration_type: DianConfigurationType,
): FiscalDocumentType {
  if (configuration_type === 'support_document') return 'support_document';
  if (configuration_type === 'payroll') return 'payroll';
  if (configuration_type === 'equivalent_document') {
    return 'pos_equivalent_document';
  }
  return 'sales_invoice';
}

/** Todos los tipos de documento que cubre una habilitación, en orden de enum. */
export function documentTypesFor(
  configuration_type: DianConfigurationType,
): FiscalDocumentType[] {
  return FISCAL_DOCUMENT_TYPES.filter(
    (document_type) =>
      FISCAL_DOCUMENT_REQUIREMENTS[document_type].configuration_type ===
      configuration_type,
  );
}

/** ¿Este documento cuelga de una Autorización de Numeración de la DIAN? */
export function requiresAuthorizedRange(
  document_type: FiscalDocumentType,
): boolean {
  return FISCAL_DOCUMENT_REQUIREMENTS[document_type].requires_authorized_range;
}

/** ¿La clave de este documento se alimenta de la ClTec del rango? */
export function acceptsTechnicalKey(document_type: FiscalDocumentType): boolean {
  return FISCAL_DOCUMENT_REQUIREMENTS[document_type].accepts_technical_key;
}

/** ¿Este documento se compone de líneas de venta? */
export function requiresLines(document_type: FiscalDocumentType): boolean {
  return FISCAL_DOCUMENT_REQUIREMENTS[document_type].requires_lines;
}

/** Nombre UBL del grupo de totales, o `null` si el documento no lo lleva. */
export function monetaryTotalElementFor(
  document_type: FiscalDocumentType,
): 'LegalMonetaryTotal' | 'RequestedMonetaryTotal' | null {
  return FISCAL_DOCUMENT_REQUIREMENTS[document_type].monetary_total_element;
}

/** ¿Su `cbc:CustomizationID` se juzga contra la tabla de tipos de FACTURA? */
export function usesInvoiceOperationTypes(
  document_type: FiscalDocumentType,
): boolean {
  return FISCAL_DOCUMENT_REQUIREMENTS[document_type]
    .uses_invoice_operation_types;
}

/**
 * Moneda del documento — `cbc:DocumentCurrencyCode`.
 *
 * Es COP y no es negociable: la factura electrónica colombiana se DECLARA en
 * pesos. La operación en divisa se informa aparte (`cac:PaymentAlternativeCurrencyTotal`
 * y la tasa de cambio), y ese bloque NO cambia la moneda del documento. Poner
 * `USD` en `DocumentCurrencyCode` hace que todos los `@currencyID` del documento
 * declaren dólares sobre importes que son pesos.
 */
export const DIAN_DOCUMENT_CURRENCY = 'COP';

// -----------------------------------------------------------------------------
// FORMA DE LA CLAVE TÉCNICA (ClTec)
//
// Vive aquí, junto a `accepts_technical_key`, porque es la otra mitad de la
// misma pregunta: la tabla dice QUIÉN lleva ClTec y esto dice QUÉ ES una ClTec.
// Siendo este módulo puro, las cuatro puertas por las que la clave entra o se
// usa —DTO de alta, servicio de resoluciones, escáner por IA y generador de
// consecutivos— pueden juzgarla con la MISMA regla en vez de reescribir cada una
// su expresión regular.
//
// EL INCIDENTE QUE LO MOTIVA: en producción se guardó una ClTec de 38
// caracteres (todos hexadecimales, sin espacios — dos perdidos al copiarla). El
// CUFE se calculó con ella, la DIAN lo recomputó con la verdadera, los hashes
// difirieron y respondió «Valor del CUFE no está calculado correctamente». Para
// entonces el consecutivo autorizado ya estaba gastado, y eso no se recupera.
//
// La ClTec es la ÚNICA entrada del hash que el XML NO transporta, así que la
// DIAN es el primer sistema capaz de notar que está mal. Validar su FORMA al
// escribirla es la última oportunidad barata de detectarlo.
// -----------------------------------------------------------------------------

/**
 * Las DOS anchuras que emite la DIAN, ambas hexadecimal de un hash:
 *
 *   · 40 — hex de un SHA-1. Es la del vector oficial del Anexo Técnico 1.9
 *     §11.2 (`693ff6f2a553c3646a063436fd4dd9ded0311471`) y la de la clave de
 *     habilitación que la DIAN reparte idéntica a todo contribuyente.
 *   · 64 — hex de un SHA-256. Observada el 16/08/2026 en la respuesta de
 *     `GetNumberingRange` para la resolución de producción 18764113258848 del
 *     NIT 902075738, ligada al prefijo FVJL.
 *
 * ── POR QUÉ DOS Y NO «LA QUE DIGA LA DIAN» ─────────────────────────────────
 *
 * Porque una lista de dos anchuras exactas sigue atrapando lo que este
 * invariante existe para atrapar. El mismo contribuyente reportó haber tecleado
 * claves de 36, 38, 39 y 40 caracteres: un hash NO tiene longitud variable, así
 * que tres de esas cuatro eran la MISMA clave con caracteres perdidos al
 * copiarla de un PDF. Aceptar «cualquier longitud» las readmitiría todas y
 * reabriría el incidente del 14/08. Con 40 ó 64, un 39 y un 63 siguen siendo
 * errores, que es justo lo que hace falta.
 *
 * La de 64 NO entró por transcripción: llegó por `GetNumberingRange`, máquina a
 * máquina, atada a su resolución. Ésa es la diferencia que la hace creíble.
 */
export const TECHNICAL_KEY_LENGTHS = [40, 64] as const;

/**
 * Etiqueta para los mensajes de error («40 o 64»). Se declara junto a las
 * anchuras para que no queden textos citando un «exactamente 40» que ya no es
 * cierto.
 *
 * Sustituye a la antigua constante `TECHNICAL_KEY_LENGTH = 40`, que se eliminó a
 * propósito en vez de marcarse `@deprecated`: mientras siguiera existiendo, el
 * siguiente sitio que la comparara volvería a rechazar las claves de 64 que la
 * DIAN sí emite.
 */
export const TECHNICAL_KEY_LENGTHS_LABEL = TECHNICAL_KEY_LENGTHS.join(' o ');

/** `true` si la longitud es una de las que emite la DIAN, sea cual sea el resto. */
export function isValidTechnicalKeyLength(length: number): boolean {
  return (TECHNICAL_KEY_LENGTHS as readonly number[]).includes(length);
}

/**
 * Forma exacta que emite la DIAN. Se aceptan mayúsculas porque el valor viaja
 * copiado a mano desde un PDF; el vector oficial del Anexo Técnico 1.9 §11.2
 * (`693ff6f2a553c3646a063436fd4dd9ded0311471`) es minúscula.
 */
export const TECHNICAL_KEY_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

/**
 * Quita el ruido de transporte de un valor pegado: espacios, tabuladores y
 * saltos de línea que un PDF inserta al copiar y que jamás forman parte de un
 * hexadecimal. Y pasa a minúscula.
 *
 * LO SEGUNDO NO ES COSMÉTICO. El hexadecimal es insensible a mayúsculas como
 * valor, pero el CUFE hashea el LITERAL: `693FF6F2…` y `693ff6f2…` son la misma
 * clave y producen huellas distintas. La DIAN emite la ClTec en minúscula —así
 * la imprime el vector oficial del Anexo 1.9 §11.2 y así la da por sentado el
 * escáner de habilitación—, de modo que una mayúscula sólo puede venir de cómo
 * el PDF la renderiza, nunca de una clave distinta. Sin esta línea, pegarla en
 * mayúscula pasaría la validación de forma y reproduciría el fallo de los 38
 * caracteres por otra vía: hash correcto en apariencia, rechazo de la DIAN,
 * consecutivo gastado.
 *
 * No repara nada más. Un guion, una «o» por un cero o un carácter perdido se
 * conservan tal cual para que {@link isWellFormedTechnicalKey} los denuncie: una
 * clave arreglada en silencio es exactamente cómo entró la de 38 caracteres.
 */
export function normalizeTechnicalKey(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, '').toLowerCase();
}

/**
 * ¿El valor tiene la forma que emite la DIAN? Normaliza antes de juzgar, así que
 * acepta indistintamente el valor crudo del usuario o uno ya normalizado.
 *
 * Deliberadamente FUERA de {@link validateResolutionDraft}: aquella responde
 * «¿este tipo de documento debe llevar ClTec?» y se traduce a
 * `INVOICING_RESOLUTION_008`; esta responde «¿esto es una ClTec?» y se traduce a
 * `INVOICING_RESOLUTION_011`. Mezclarlas devolvería el mismo código para dos
 * correcciones distintas: borrar el campo o volver a copiarlo completo.
 */
export function isWellFormedTechnicalKey(
  value: string | null | undefined,
): boolean {
  return TECHNICAL_KEY_PATTERN.test(normalizeTechnicalKey(value));
}

/**
 * Traduce un `invoice_type_enum` al `fiscal_document_type_enum` con el que se
 * numera y se declara.
 *
 * Réplica de `InvoicingService.toFiscalDocumentType`. Las dos traducciones que no
 * son identidad:
 *   - `purchase_invoice` → `support_document` (la compra a un no obligado a
 *     facturar la respalda el documento soporte, no una factura).
 *   - `export_invoice`   → `sales_invoice`   (la factura de exportación numera
 *     contra el rango de la factura de venta).
 *
 * A diferencia del original —que hacía un cast a una unión de 5 tipos y por tanto
 * mentía sobre cualquier entrada desconocida—, aquí lo no reconocido se devuelve
 * como `sales_invoice` solo si figura en el contrato; si no, se lanza. Un tipo de
 * documento inventado que se cuele hasta la numeración gasta un consecutivo
 * autorizado irrecuperable.
 */
export function toFiscalDocumentType(invoice_type: string): FiscalDocumentType {
  if (invoice_type === 'purchase_invoice') return 'support_document';
  if (invoice_type === 'export_invoice') return 'sales_invoice';
  if (isFiscalDocumentType(invoice_type)) return invoice_type;
  throw new Error(
    `No hay tipo de documento fiscal para invoice_type '${invoice_type}'. ` +
      'Añádelo a FISCAL_DOCUMENT_REQUIREMENTS antes de emitirlo: numerar un ' +
      'documento sin requisitos declarados gasta un consecutivo autorizado.',
  );
}

/**
 * ¿Este `invoice_type` se emite como documento soporte?
 *
 * Réplica de `InvoicingService.isSupportDocumentType`. Se mantiene indexado por
 * `invoice_type` (no por documento fiscal) porque sus call-sites deciden ANTES de
 * traducir: cargar el proveedor, exigir `supplier_id`, omitir el bloque
 * `sts:InvoiceControl`.
 */
export function isSupportDocumentType(invoice_type: string): boolean {
  return (
    invoice_type === 'purchase_invoice' ||
    invoice_type === 'support_document' ||
    invoice_type === 'support_adjustment_note'
  );
}

/** Una regla del contrato incumplida, redactada para quien configura. */
export interface FiscalRequirementViolation {
  /** Campo de la resolución que la incumple. */
  field: 'resolution_number' | 'technical_key';
  /** Código estable para que la UI mapee el mensaje sin parsear texto. */
  code:
    | 'RESOLUTION_NUMBER_REQUIRED'
    | 'TECHNICAL_KEY_REQUIRED'
    | 'TECHNICAL_KEY_NOT_APPLICABLE';
  message: string;
}

/** Lo mínimo de una resolución que el contrato sabe juzgar. */
export interface FiscalResolutionDraft {
  document_type: FiscalDocumentType;
  resolution_number?: string | null;
  technical_key?: string | null;
}

/**
 * Valida un borrador de resolución contra el contrato. PURA: devuelve las
 * violaciones, no lanza ni conoce HTTP, para que sirva igual al DTO del panel, al
 * de la consola de superadmin y a un test.
 *
 * Solo juzga lo que el contrato declara. Vigencias, rango, unicidad de ClTec por
 * (NIT, rango) y estado de habilitación viven en sus dueños y no se duplican aquí.
 */
export function validateResolutionDraft(
  draft: FiscalResolutionDraft,
): FiscalRequirementViolation[] {
  const requirements = FISCAL_DOCUMENT_REQUIREMENTS[draft.document_type];
  const violations: FiscalRequirementViolation[] = [];
  const resolution_number = draft.resolution_number?.trim() ?? '';
  const technical_key = draft.technical_key?.trim() ?? '';

  if (requirements.requires_authorized_range && !resolution_number) {
    violations.push({
      field: 'resolution_number',
      code: 'RESOLUTION_NUMBER_REQUIRED',
      message:
        `${requirements.label} numera contra una Autorización de Numeración de ` +
        'la DIAN: el número de resolución es el valor de sts:InvoiceAuthorization ' +
        'que la DIAN confronta contra la autorización del punto de facturación.',
    });
  }

  if (requirements.accepts_technical_key && !technical_key) {
    violations.push({
      field: 'technical_key',
      code: 'TECHNICAL_KEY_REQUIRED',
      message:
        `${requirements.label} arma su ${requirements.key_algorithm} con la clave ` +
        'técnica (ClTec) del rango. Sin ella no se puede firmar, y hacerlo con el ' +
        'Software-PIN produce una clave que la DIAN rechaza.',
    });
  }

  if (!requirements.accepts_technical_key && technical_key) {
    violations.push({
      field: 'technical_key',
      code: 'TECHNICAL_KEY_NOT_APPLICABLE',
      message:
        `${requirements.label} no usa clave técnica: su ${requirements.key_algorithm} ` +
        'lleva el Software-PIN como 14º campo. Guardar una ClTec aquí sugiere que ' +
        'se firmará con ella, y no es lo que ocurre.',
    });
  }

  return violations;
}

// -----------------------------------------------------------------------------
// CATÁLOGO DE REGLAS OFICIALES DEL ANEXO TÉCNICO 1.9 (Res. 000165 · 01/NOV/2023)
//
// ## Por qué existe
//
// Cuando la DIAN rechaza, devuelve un identificador (`FAJ29`, `FAU02`, `FAD05a`)
// y su propio mensaje. Hasta ahora NADA en el código permitía correlacionar ese
// rechazo con la regla local que debió atajarlo: el prevalidador hablaba en
// español de comerciante y la DIAN en español de anexo, y nadie tenía el
// diccionario. Este catálogo es ese diccionario, y va aquí —en el motor
// declarativo— y no dentro del validador porque la respuesta depende del TIPO DE
// DOCUMENTO, que es justo lo que esta tabla ya sabe resolver.
//
// ## Reglas de transcripción (no negociables)
//
//  1. `dian_message` es LITERAL de la columna «Mensaje» del anexo, con sus
//     erratas incluidas (el anexo escribe «validares positivos» en la columna
//     Regla de VLR01 y «CustomizationID debe sr igual» en CAD02a). No se corrige:
//     el valor de este campo es poder buscarlo tal cual en el PDF y en la
//     respuesta de la DIAN.
//  2. `annex_line` cita la línea de `anexo19.txt` —la extracción `pdftotext
//     -layout` del PDF oficial de 753 páginas— de donde se transcribió, para que
//     cualquiera pueda auditar la transcripción sin volver a leer el PDF entero.
//  3. `dian_message: null` significa que la fila del anexo es una DEFINICIÓN DE
//     CAMPO (columnas Tipo/Tam/Ocurrencia) y no una fila de regla con columna
//     «Mensaje». No se inventa un mensaje para rellenar el hueco.
//  4. Si un tipo de documento no aparece en `by_root`, es que ninguna de las tres
//     tablas del anexo lo juzga. `dianRuleFor` devuelve `null` y el hallazgo sale
//     sin cita, que es honesto; inventar un identificador sería peor que no
//     tenerlo.
//
// ## Efecto
//
// La columna `Y` del anexo: `R` = Rechazo (la DIAN NO acepta el documento y el
// consecutivo se pierde), `N` = Notificación (lo acepta y avisa). Sólo lo primero
// justifica bloquear una emisión.
// -----------------------------------------------------------------------------

/** Columna `Y` del anexo: `R` = Rechazo, `N` = Notificación. */
export type DianRuleEffect = 'rechazo' | 'notificacion';

/** Elemento raíz UBL bajo el que el anexo agrupa sus tablas de reglas. */
export type DianUblRootDocument = 'Invoice' | 'CreditNote' | 'DebitNote';

/** La regla tal como el anexo la publica para UN elemento raíz. */
export interface DianRuleVariant {
  /** Identificador oficial: el que la DIAN devuelve al rechazar. */
  id: string;
  /**
   * Mensaje LITERAL de la columna «Mensaje». `null` cuando la fila citada es una
   * definición de campo sin columna «Mensaje» (ver regla 3 de la cabecera).
   */
  dian_message: string | null;
  /** XPath de la columna «Xpath», normalizado a una sola línea. */
  xpath: string;
  /** Línea de `anexo19.txt` de la que se transcribió. */
  annex_line: number;
}

/** Una regla del anexo, con su variante por elemento raíz. */
export interface DianRuleDefinition {
  /** Qué exige, en español de ingeniería. NO es el mensaje de la DIAN. */
  requirement: string;
  effect: DianRuleEffect;
  by_root: Partial<Record<DianUblRootDocument, DianRuleVariant>>;
}

/** La regla resuelta para un tipo de documento concreto. */
export interface DianRuleCitation extends DianRuleVariant {
  key: DianRuleKey;
  effect: DianRuleEffect;
  /** Elemento raíz bajo el que se resolvió la cita. */
  root: DianUblRootDocument;
}

/**
 * EL CATÁLOGO. Cada clave nombra una regla en términos de negocio; cada variante
 * la traduce al identificador que la DIAN devolverá si el documento la incumple.
 */
export const DIAN_RULES = {
  // --- Totales del documento (§8.1.5 / §8.3.5 / §8.4.5) ---------------------
  header_line_extension: {
    requirement:
      'El valor bruto antes de tributos del documento debe ser la suma de los ' +
      'valores brutos de sus líneas.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAU02',
        dian_message:
          'El Valor Bruto antes de tributos no es igual a la suma de los valores de las líneas de la factura que contienen el valor comercial',
        xpath: '…//cac:LegalMonetaryTotal/cbc:LineExtensionAmount',
        annex_line: 22411,
      },
      CreditNote: {
        id: 'CAU02',
        dian_message:
          'El Valor Bruto antes de tributos no es igual a la suma de los valores de las líneas de la factura que contienen el valor comercial.',
        xpath: '…//LegalMonetaryTotal/cbc:LineExtensionAmount',
        annex_line: 26136,
      },
      DebitNote: {
        id: 'DAU02',
        dian_message:
          'El Valor Bruto antes de tributos NO es igual a la suma de los valores de las líneas de la factura que contienen el valor comercial.',
        xpath: '…//cac:RequestedMonetaryTotal/cbc:LineExtensionAmount',
        annex_line: 29510,
      },
    },
  },
  header_tax_exclusive: {
    requirement:
      'La base imponible del documento debe ser la suma de las bases ' +
      'imponibles que declaran sus líneas de detalle. Una línea que omite su ' +
      'grupo de tributos no declara base, así que no puede sumar en la cabecera.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAU04',
        dian_message:
          'Base Imponible es distinto a la suma de los valores de las bases imponibles de todas líneas de detalle.',
        xpath: '…//cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount',
        annex_line: 22432,
      },
      CreditNote: {
        id: 'CAU04',
        dian_message:
          'Base Imponible, es distinto a la suma de los valores de las bases imponibles de todas líneas de detalle.',
        xpath: '…//LegalMonetaryTotal/cbc:TaxExclusiveAmount',
        annex_line: 26177,
      },
      DebitNote: {
        id: 'DAU04',
        dian_message:
          'Base Imponible, es distinto a la suma de los valores de las bases imponibles de todas líneas de detalle.',
        xpath: '…//cac:RequestedMonetaryTotal/cbc:TaxExclusiveAmount',
        annex_line: 29553,
      },
    },
  },
  header_tax_inclusive: {
    requirement:
      'El valor bruto más tributos debe ser el valor bruto más la suma de los ' +
      'tributos de todas las líneas de detalle.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAU06',
        dian_message:
          'Valor Bruto más tributos es diferente a Valor Bruto de la factura que contienen el valor comercial más la Suma de los Tributos de todas las líneas de detalle.',
        xpath: '…//cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount',
        annex_line: 22475,
      },
      CreditNote: {
        id: 'CAU06',
        dian_message:
          'Valor Bruto más tributos es diferente a Valor Bruto de la factura que contienen el valor comercial más la Suma de los Tributos de todas las líneas de detalle.',
        xpath: '…//LegalMonetaryTotal/cbc:TaxInclusiveAmount',
        annex_line: 26215,
      },
      DebitNote: {
        id: 'DAU06',
        dian_message:
          'Valor Bruto más tributos, es diferente a Valor Bruto de la factura que contienen el valor comercial más la suma de los tributos de todas las líneas de detalle.',
        xpath: '…//cac:RequestedMonetaryTotal/cbc:TaxInclusiveAmount',
        annex_line: 29589,
      },
    },
  },
  payable_amount: {
    requirement:
      'Valor a pagar = valor bruto más tributos − descuento total + cargo total.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAU14',
        dian_message:
          'Valor a Pagar de Factura es distinto de la Suma de Valor Bruto más tributos - Valor del Descuento Total + Valor del Cargo Total',
        xpath: '…//cac:LegalMonetaryTotal/cbc:PayableAmount',
        annex_line: 22621,
      },
      CreditNote: {
        id: 'CAU14',
        dian_message:
          'Valor a Pagar de Factura es distinto de la Suma de Valor Bruto más tributos - Valor del Descuento Total + Valor del Cargo Total',
        xpath: '…//LegalMonetaryTotal/cbc:PayableAmount',
        annex_line: 26327,
      },
      DebitNote: {
        id: 'DAU14',
        dian_message:
          'Valor a Pagar de Factura, es distinto de la Suma de Valor Bruto más tributos - Valor del Descuento Total + Valor del Cargo Total',
        xpath: '…//cac:RequestedMonetaryTotal/cbc:PayableAmount',
        annex_line: 29701,
      },
    },
  },
  allowance_total_backed: {
    requirement:
      'El descuento total del documento debe ser igual a la suma de los ' +
      'cac:AllowanceCharge con ChargeIndicator = "false". Si el documento ' +
      'publica el total pero no publica los grupos, esa suma vale 0.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAU08',
        dian_message:
          'Total descuentos es diferente de la suma de todos los descuentos aplicados al total de la factura',
        xpath: '…//cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount',
        annex_line: 22514,
      },
      CreditNote: {
        id: 'CAU08',
        dian_message:
          'Total descuentos, es diferente de la suma de todos los descuentos aplicados al total de la factura.',
        xpath: '…//LegalMonetaryTotal/cbc:AllowanceTotalAmount',
        annex_line: 26254,
      },
      DebitNote: {
        id: 'DAU08',
        dian_message:
          'Total descuentos, es diferente de la suma de todos los descuentos aplicados al total de la factura.',
        xpath: '…//cac:RequestedMonetaryTotal/cbc:AllowanceTotalAmount',
        annex_line: 29607,
      },
    },
  },

  // --- Tributos de cabecera (§8.1.4 / §8.3.4 / §8.4.4) ----------------------
  tax_subtotal_per_rate: {
    requirement: 'Debe existir un cac:TaxSubtotal por cada tarifa.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAS04',
        dian_message: 'Debe ser informado un grupo de estos para cada tarifa.',
        xpath: '../cac:TaxTotal/cac:TaxSubtotal',
        annex_line: 22011,
      },
      CreditNote: {
        id: 'CAS04',
        dian_message: 'Debe ser informado un grupo de estos para cada tarifa.',
        xpath: '../cac:TaxTotal/TaxSubtotal',
        annex_line: 25936,
      },
      DebitNote: {
        id: 'DAS04',
        dian_message: 'Debe ser informado un grupo de estos para cada tarifa.',
        xpath: '../cac:TaxTotal/TaxSubtotal',
        annex_line: 29337,
      },
    },
  },
  tax_subtotal_amount: {
    requirement:
      'El valor del tributo debe ser el producto del porcentaje aplicado sobre ' +
      'la base imponible.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAS07',
        dian_message:
          'El valor del tributo informado no corresponde al producto del porcentaje aplicado sobre la base imponible',
        xpath: '../cac:TaxTotal/cac:TaxSubtotal/cbc:TaxAmount',
        annex_line: 22060,
      },
      CreditNote: {
        id: 'CAS07',
        dian_message:
          'El valor del tributo informado no corresponde al producto del porcentaje aplicado sobre la base imponible',
        xpath: '../cac:TaxTotal/TaxSubtotal/cbc:TaxAmount',
        annex_line: 25978,
      },
      DebitNote: {
        id: 'DAS07',
        dian_message:
          'El valor del tributo informado no corresponde al producto del porcentaje aplicado sobre la base imponible',
        xpath: '../cac:TaxTotal/TaxSubtotal/cbc:TaxAmount',
        annex_line: 29359,
      },
    },
  },

  // --- Líneas (§8.2.1 / §8.3.1 / §8.4.1) ------------------------------------
  line_group_required: {
    requirement: 'Debe existir al menos un grupo de línea.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAV01',
        dian_message: 'No fue informado el grupo',
        xpath: '/Invoice/cac:InvoiceLine',
        annex_line: 22670,
      },
      CreditNote: {
        id: 'CAV01',
        dian_message: 'No fue informado el grupo',
        xpath: '/CreditNote/cac:CreditNoteLine',
        annex_line: 26375,
      },
      DebitNote: {
        id: 'DAV01',
        dian_message: 'No fue informado el grupo',
        xpath: '/DebitNote/cac:DebitNoteLine',
        annex_line: 29762,
      },
    },
  },
  line_quantity_positive: {
    requirement:
      'La cantidad de cada línea debe existir y no puede ser negativa.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAV04b',
        dian_message: 'No se puede expresar valores negativos',
        xpath: '/Invoice/cac:InvoiceLine/cbc:InvoicedQuantity',
        annex_line: 22731,
      },
      CreditNote: {
        id: 'CAV04b',
        dian_message: 'No se puede expresar valores negativos',
        xpath: '/CreditNote/cac:CreditNoteLine/cbc:CreditedQuantity',
        annex_line: 26423,
      },
      DebitNote: {
        id: 'DAV04b',
        dian_message: 'No se puede expresar valores negativos',
        xpath: '/DebitNote/cac:DebitNoteLine/cbc:DebitedQuantity',
        annex_line: 29810,
      },
    },
  },
  line_unit_code: {
    requirement:
      'La unidad de medida de la cantidad debe existir en la lista de unidades ' +
      'del anexo (UN/ECE Rec. 20).',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAV05',
        dian_message:
          'La unidad de la cantidad utilizada no existe en la lista de unidades',
        xpath: '/Invoice/cac:InvoiceLine/cbc:InvoicedQuantity /@unitCode',
        annex_line: 22735,
      },
      CreditNote: {
        id: 'CAV05',
        dian_message:
          'La unidad de la cantidad utilizada no existe en la lista de unidades.',
        xpath: '/CreditNote/cac:CreditNoteLine/cbc:CreditedQuantity /@unitCode',
        annex_line: 26429,
      },
      DebitNote: {
        id: 'DAV05',
        dian_message:
          'La unidad de la cantidad utilizada NO existe en la lista de unidades.',
        xpath: '/DebitNote/cac:DebitNoteLine/cbc:DebitedQuantity /@unitCode',
        annex_line: 29815,
      },
    },
  },
  line_description: {
    requirement: 'La descripción del artículo o servicio debe ser informada.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAZ02',
        dian_message: 'Descripción no informada',
        xpath: '../cac:Item/cbc:Description',
        annex_line: 23332,
      },
      CreditNote: {
        id: 'CAZ02',
        dian_message: 'Descripción no informada',
        xpath: '../cac:Item/cbc:Description',
        annex_line: 26965,
      },
      DebitNote: {
        id: 'DAZ02',
        dian_message: 'Descripción no informada.',
        xpath: '../cac:Item/cbc:Description',
        annex_line: 30337,
      },
    },
  },

  // --- Cabecera del documento (§8.1.2 / §8.3.2 / §8.4.2) ---------------------
  operation_type: {
    requirement:
      'cbc:CustomizationID debe ser un valor válido de la tabla de tipos de ' +
      'operación que corresponde a ESTE documento.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAD02',
        dian_message:
          'CustomizationID no indica un valor válido para el tipo de operación',
        xpath: '/Invoice/cbc:CustomizationID',
        annex_line: 19367,
      },
      CreditNote: {
        id: 'CAD02',
        dian_message:
          'CustomizationID no indica un valor válido para el tipo de operación',
        xpath: '/CreditNote/cbc:CustomizationID',
        annex_line: 23818,
      },
      DebitNote: {
        id: 'DAD02',
        dian_message:
          'CustomizationID no indica un valor válido para el tipo de operación.',
        xpath: '/DebitNote/cbc:CustomizationID',
        annex_line: 27437,
      },
    },
  },
  document_currency: {
    requirement:
      'La divisa del documento debe estar definida en el estándar ISO 4217.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAD15a',
        dian_message: 'Código de divisa inválido',
        xpath: '/Invoice/cbc:DocumentCurrencyCode',
        annex_line: 19520,
      },
      CreditNote: {
        id: 'CAD15a',
        dian_message: 'Código de divisa inválido',
        xpath: '/CreditNote/cbc:DocumentCurrencyCode',
        annex_line: 23916,
      },
      DebitNote: {
        id: 'DAD15a',
        dian_message: 'Código de divisa inválido.',
        xpath: '/DebitNote/cbc:DocumentCurrencyCode',
        annex_line: 27492,
      },
    },
  },
  /**
   * LA REGLA DEL INCIDENTE. La ClTec de 38 caracteres no disparó ninguna regla
   * de forma: disparó ESTA, porque la DIAN recalculó el CUFE con la clave
   * verdadera y los hashes no coincidieron. Es la única entrada del hash que el
   * XML no transporta, así que la DIAN es el primer sistema capaz de notarlo —
   * y para entonces el consecutivo ya está gastado.
   */
  unique_code_calculation: {
    requirement:
      'El CUFE/CUDE debe estar calculado según el algoritmo del anexo técnico.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAD06',
        dian_message: 'Valor del CUFE no está calculado correctamente',
        xpath: '/Invoice/cbc:UUID',
        annex_line: 19423,
      },
      CreditNote: {
        id: 'CAD06',
        dian_message: 'Valor del CUDE No está calculado correctamente',
        xpath: '/CreditNote/cbc:UUID',
        annex_line: 23858,
      },
      DebitNote: {
        id: 'DAD06',
        dian_message: 'Valor del CUDE no está calculado correctamente.',
        xpath: '/DebitNote/cbc:UUID',
        annex_line: 27451,
      },
    },
  },
  issue_date_equals_signing_date: {
    requirement:
      'La fecha de generación del documento debe ser igual a la fecha de firma.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAD09e',
        dian_message:
          'La fecha de generación de la factura es diferente a la fecha de firma de la factura',
        xpath: '/Invoice/cbc:IssueDate',
        annex_line: 19486,
      },
      CreditNote: {
        id: 'CAD09e',
        dian_message:
          'La fecha de generación de la NC es diferente a la fecha de firma de la NC',
        xpath: '/CreditNote/cbc:IssueDate',
        annex_line: 23895,
      },
      DebitNote: {
        id: 'DAD09e',
        dian_message:
          'La fecha de generación de la ND es diferente a la fecha de firma de la ND',
        xpath: '/DebitNote/cbc:IssueDate',
        annex_line: 27474,
      },
    },
  },

  // --- Numeración autorizada (§8.1.2 cbc:ID + §8.1.1 sts:InvoiceControl) -----
  //
  // Estas tablas SÓLO existen para `Invoice`: la autorización de numeración es
  // de la factura (y, por herencia del elemento raíz, del documento soporte y
  // del documento equivalente POS, que también salen como `<Invoice>`). Las
  // notas no cuelgan de un rango autorizado — ver `requires_authorized_range`.
  document_number_format: {
    requirement:
      'El número de documento sólo puede contener números y letras: ni espacios, ' +
      'ni guiones, ni ningún otro carácter.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAD05a',
        dian_message:
          'No se permiten caracteres adicionales como espacios o guiones',
        xpath: '/Invoice/cbc:ID',
        annex_line: 19384,
      },
      // Las notas no tienen fila de regla propia para el formato del `cbc:ID`:
      // el anexo la publica dentro de la DEFINICIÓN del campo, en la columna
      // «Reglas de validación» («Rechazo: No se permiten caracteres adicionales
      // como espacios o guiones»). Es la misma regla y el mismo mensaje.
      CreditNote: {
        id: 'CAD05',
        dian_message:
          'No se permiten caracteres adicionales como espacios o guiones',
        xpath: '/CreditNote/cbc:ID',
        annex_line: 6196,
      },
      DebitNote: {
        id: 'DAD05',
        dian_message:
          'No se permiten caracteres adicionales como espacios o guiones',
        xpath: '/DebitNote/cbc:ID',
        annex_line: 10021,
      },
    },
  },
  document_number_length: {
    requirement:
      'El número de documento (prefijo + consecutivo) es de tipo EA con Tam ' +
      '1..20 en la definición de campo del anexo.',
    effect: 'rechazo',
    by_root: {
      // Filas de DEFINICIÓN de campo (columnas Tipo/Tam/Ocurrencia). El anexo no
      // publica columna «Mensaje» para la faceta de longitud: la violación la
      // ataja el XSD, que es donde 21 caracteres dejan de caber en el tipo.
      Invoice: {
        id: 'FAD05',
        dian_message: null,
        xpath: '/Invoice/cbc:ID',
        annex_line: 1463,
      },
      CreditNote: {
        id: 'CAD05',
        dian_message: null,
        xpath: '/CreditNote/cbc:ID',
        annex_line: 6196,
      },
      DebitNote: {
        id: 'DAD05',
        dian_message: null,
        xpath: '/DebitNote/cbc:ID',
        annex_line: 10021,
      },
    },
  },
  document_number_within_range: {
    requirement:
      'El número de documento debe estar contenido en el rango de numeración ' +
      'autorizado.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAD05d',
        dian_message:
          'Número de factura no está contenido en el rango de numeración autorizado',
        xpath: '/Invoice/cbc:ID',
        annex_line: 19414,
      },
    },
  },
  issue_date_within_authorization: {
    requirement:
      'La fecha de emisión debe estar entre la fecha inicial y la fecha final de ' +
      'la autorización de numeración.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAD09a',
        dian_message:
          'Fecha de emisión anterior a la fecha de inicio de la autorización de la numeración',
        xpath: '/Invoice/cbc:IssueDate',
        annex_line: 19467,
      },
    },
  },
  authorization_number: {
    requirement:
      'El número de autorización del rango de numeración debe estar informado.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAB05a',
        dian_message:
          'No se encuentra el número de autorización del rango de numeración otorgado',
        xpath:
          '…//ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/sts:DianExtensions/sts:InvoiceControl/sts:InvoiceAuthorization',
        annex_line: 18971,
      },
    },
  },
  authorization_prefix: {
    requirement:
      'El prefijo informado debe corresponder al prefijo de la autorización de ' +
      'numeración y al código del punto de facturación.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAB10b',
        dian_message:
          'El prefijo no corresponde al prefijo de la autorización de numeración',
        xpath:
          '…//ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/sts:DianExtensions/sts:InvoiceControl/sts:AuthorizedInvoices/sts:Prefix',
        annex_line: 19049,
      },
    },
  },
  authorization_prefix_length: {
    requirement:
      'sts:Prefix es de tipo EA con Tam 0..4 en la definición de campo del anexo.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAB10',
        // Fila de DEFINICIÓN de campo. Sin columna «Mensaje» propia.
        dian_message: null,
        xpath:
          '../ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/sts:DianExtensions/sts:InvoiceControl/sts:AuthorizedInvoices/sts:Prefix',
        annex_line: 1113,
      },
    },
  },
  authorization_range_bounds: {
    requirement:
      'Los valores inicial y final del rango de numeración deben estar informados.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAB11a',
        dian_message: 'Valor inicial del rango de no está informado',
        xpath:
          '…//ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/sts:DianExtensions/sts:InvoiceControl/sts:AuthorizedInvoices/sts:From',
        annex_line: 19072,
      },
    },
  },
  authorization_range_digits: {
    requirement:
      'sts:From y sts:To son de tipo EN con Tam 1..9 en la definición de campo ' +
      'del anexo: un rango de 10 dígitos no cabe en el XML.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'FAB11',
        // Fila de DEFINICIÓN de campo. Sin columna «Mensaje» propia. FAB12 dice
        // lo mismo para sts:To (línea 1138).
        dian_message: null,
        xpath:
          '../ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/sts:DianExtensions/sts:InvoiceControl/sts:AuthorizedInvoices/sts:From',
        annex_line: 1127,
      },
    },
  },

  // --- Regla global (§5.2.3.1 / §5.2.3.2, tabla de reglas generales) ---------
  /**
   * VLR01 NO cuelga de un elemento raíz: es una regla GENERAL, aplicable a todo
   * documento electrónico. Por eso se declara en las tres variantes con el mismo
   * identificador — no es una traducción por tipo, es la misma regla.
   */
  positive_monetary_values: {
    requirement:
      'Todos los valores monetarios y porcentajes del documento deben ser ' +
      'positivos. Una devolución o un ajuste a la baja se expresa con una NOTA ' +
      'CRÉDITO, nunca con un importe negativo.',
    effect: 'rechazo',
    by_root: {
      Invoice: {
        id: 'VLR01',
        dian_message:
          'Los valores monetarios/porcentajes deben corresponder a valores Positivos',
        xpath: '(regla general, aplica a todo importe y porcentaje)',
        annex_line: 18915,
      },
      CreditNote: {
        id: 'VLR01',
        dian_message:
          'Los valores monetarios/porcentajes deben corresponder a valores Positivos',
        xpath: '(regla general, aplica a todo importe y porcentaje)',
        annex_line: 18915,
      },
      DebitNote: {
        id: 'VLR01',
        dian_message:
          'Los valores monetarios/porcentajes deben corresponder a valores Positivos',
        xpath: '(regla general, aplica a todo importe y porcentaje)',
        annex_line: 18915,
      },
    },
  },
} as const satisfies Record<string, DianRuleDefinition>;

/** Nombre de negocio de una regla del anexo. */
export type DianRuleKey = keyof typeof DIAN_RULES;

/** Todas las claves, para recorrerlas en una UI o en un test de cobertura. */
export const DIAN_RULE_KEYS = Object.keys(DIAN_RULES) as DianRuleKey[];

/** Elemento raíz UBL bajo el que se emite este documento. */
export function ublRootDocumentFor(
  document_type: FiscalDocumentType,
): DianUblRootDocument | null {
  return FISCAL_DOCUMENT_REQUIREMENTS[document_type].ubl_root_document;
}

/** ¿Su constructor XML respalda el descuento global con `cac:AllowanceCharge`? */
export function emitsDocumentAllowanceCharge(
  document_type: FiscalDocumentType,
): boolean {
  return FISCAL_DOCUMENT_REQUIREMENTS[document_type]
    .emits_document_allowance_charge;
}

/**
 * La regla oficial que la DIAN aplicará a ESTE tipo de documento, o `null` si el
 * Anexo 1.9 no la publica para su elemento raíz.
 *
 * `null` es una respuesta legítima y frecuente: la nota crédito no tiene tabla
 * de numeración autorizada, y la nómina no tiene ninguna de las tres. Devolverlo
 * es preferible a citar un identificador que la DIAN nunca devolverá.
 */
export function dianRuleFor(
  key: DianRuleKey,
  document_type: FiscalDocumentType,
): DianRuleCitation | null {
  const root = ublRootDocumentFor(document_type);
  if (!root) return null;
  const definition: DianRuleDefinition = DIAN_RULES[key];
  const variant = definition.by_root[root];
  if (!variant) return null;
  return {
    key,
    effect: definition.effect,
    root,
    id: variant.id,
    dian_message: variant.dian_message,
    xpath: variant.xpath,
    annex_line: variant.annex_line,
  };
}

// -----------------------------------------------------------------------------
// FACETAS DE FORMA QUE EL ANEXO DECLARA COMO TIPO DE CAMPO
//
// Viven aquí, junto a TECHNICAL_KEY_PATTERN, por el mismo motivo: son la forma
// EXACTA que el XML admite, y tenerlas en un solo sitio evita que el DTO de
// alta, el generador de consecutivos y el prevalidador cada uno invente la suya.
// -----------------------------------------------------------------------------

/**
 * FAD05a: el número de documento sólo admite letras y dígitos.
 *
 * NO se relaja para admitir el guion. Es tentador —muchos comerciantes escriben
 * «FE-1234»— y es exactamente el rechazo que el anexo nombra por su nombre:
 * «No se permiten caracteres adicionales como espacios o guiones».
 */
export const DOCUMENT_NUMBER_PATTERN = /^[0-9A-Za-z]+$/;

/** FAD05: `cbc:ID` es de tipo EA, Tam 1..20 (anexo19.txt:1463). */
export const DOCUMENT_NUMBER_MAX_LENGTH = 20;

/** FAB10: `sts:Prefix` es de tipo EA, Tam 0..4 (anexo19.txt:1113). */
export const RESOLUTION_PREFIX_MAX_LENGTH = 4;

/** FAB11 / FAB12: `sts:From` y `sts:To` son de tipo EN, Tam 1..9. */
export const RESOLUTION_RANGE_MAX_DIGITS = 9;
