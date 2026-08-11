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
 * No cambia comportamiento de emisión ni de numeración. Declara el requisito;
 * quien lo aplica (guards, DTOs, servicios) lo consume. En particular NO altera
 * `generateNextNumber` (`utils/invoice-number-generator.ts`), que sigue exigiendo
 * una fila `invoice_resolutions` por `document_type` para TODO documento —
 * incluidas las notas, cuyo consecutivo es interno pero sigue saliendo de ahí.
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
   * generador de consecutivos la exige igual (ver `invoice-number-generator.ts`).
   * Significa que esa fila es una **fuente de consecutivo interno**, y que su
   * `resolution_number` es un rótulo del comerciante, no una autorización DIAN
   * que la validación pueda exigir ni confrontar.
   */
  requires_authorized_range: boolean;
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
    accepts_technical_key: true,
    key_algorithm: 'CUFE',
    label: 'Factura electrónica de venta',
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
    accepts_technical_key: false,
    key_algorithm: 'CUDE',
    label: 'Nota crédito',
  },
  debit_note: {
    document_type: 'debit_note',
    configuration_type: 'invoicing',
    requires_authorized_range: false,
    accepts_technical_key: false,
    key_algorithm: 'CUDE',
    label: 'Nota débito',
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
    accepts_technical_key: false,
    key_algorithm: 'CUDS',
    label: 'Documento soporte',
  },
  /** Nota de ajuste al documento soporte: ajusta, no numera contra rango propio. */
  support_adjustment_note: {
    document_type: 'support_adjustment_note',
    configuration_type: 'support_document',
    requires_authorized_range: false,
    accepts_technical_key: false,
    key_algorithm: 'CUDS',
    label: 'Nota de ajuste al documento soporte',
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
    accepts_technical_key: false,
    key_algorithm: 'CUNE',
    label: 'Nómina electrónica',
  },
  payroll_adjustment: {
    document_type: 'payroll_adjustment',
    configuration_type: 'payroll',
    requires_authorized_range: false,
    accepts_technical_key: false,
    key_algorithm: 'CUNE',
    label: 'Nota de ajuste de nómina electrónica',
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
    accepts_technical_key: false,
    key_algorithm: 'CUDE',
    label: 'Documento equivalente POS',
  },
  /**
   * Nota de ajuste al documento equivalente ('93' débito / '94' crédito, numeral
   * 16.3). El DE no tiene nota crédito/débito propia — solo estas.
   */
  equivalent_adjustment_note: {
    document_type: 'equivalent_adjustment_note',
    configuration_type: 'equivalent_document',
    requires_authorized_range: false,
    accepts_technical_key: false,
    key_algorithm: 'CUDE',
    label: 'Nota de ajuste al documento equivalente',
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
