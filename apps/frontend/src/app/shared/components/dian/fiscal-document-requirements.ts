/**
 * ESPEJO FRONTEND del contrato único de requisitos DIAN por tipo de documento.
 *
 * Archivo espejado:
 * `apps/backend/src/domains/store/invoicing/fiscal-document-requirements.ts`
 *
 * ## Por qué es un espejo y no un import
 *
 * El original tipa sus uniones contra `@prisma/client`, que no existe en el
 * bundle del navegador. Copiarlo es la única forma de que el panel del
 * comerciante y la consola de superadmin lean LA MISMA tabla sin arrastrar
 * Prisma al frontend.
 *
 * ## Qué obliga a mantenerlo sincronizado
 *
 * Los valores son idénticos a propósito, campo por campo. Si el backend añade
 * un `fiscal_document_type_enum`, su `Record<FiscalDocumentType, …>` rompe la
 * compilación allá; aquí rompe la de `FISCAL_DOCUMENT_REQUIREMENTS` por la
 * misma razón. El día que los dos dejen de coincidir, la UI ofrecerá un campo
 * que el backend rechaza —o, peor, ocultará uno que el backend exige— y el
 * usuario descubrirá la divergencia gastando un consecutivo autorizado que no
 * se recupera.
 *
 * ## Las dos preguntas que la tabla separa (y que se confundían)
 *
 * 1. `requires_authorized_range` — ¿la DIAN emite **Autorización de
 *    Numeración** para este documento?
 * 2. `accepts_technical_key` — ¿la clave del documento se alimenta de la
 *    **ClTec** del rango, o de otro secreto?
 *
 * No son la misma pregunta y la segunda no se deduce de la primera: el
 * documento equivalente POS SÍ cuelga de un rango autorizado propio y aun así
 * su clave se arma con el Software-PIN, no con la ClTec.
 */

/** Tipo de documento fiscal. Espejo del enum persistido `fiscal_document_type_enum`. */
export type FiscalDocumentType =
  | 'sales_invoice'
  | 'credit_note'
  | 'debit_note'
  | 'support_document'
  | 'support_adjustment_note'
  | 'payroll'
  | 'payroll_adjustment'
  | 'pos_equivalent_document'
  | 'equivalent_adjustment_note';

/** Habilitación DIAN. Espejo del enum persistido `dian_configuration_type_enum`. */
export type DianConfigurationType =
  | 'invoicing'
  | 'support_document'
  | 'payroll'
  | 'equivalent_document';

/**
 * Algoritmo del código único del documento. Cada uno cambia el 14º campo del
 * hash SHA-384, y equivocarlo produce una clave que la DIAN rechaza gastando un
 * consecutivo autorizado que no se recupera.
 *
 * - `CUFE` — 14º campo = **ClTec** de la resolución. Solo factura de venta.
 * - `CUDE` — 14º campo = **Software-PIN**. Notas crédito/débito y documento
 *   equivalente.
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
   * `false` NO significa «no necesita fila `invoice_resolutions`»: el generador
   * de consecutivos la exige igual. Significa que esa fila es una **fuente de
   * consecutivo interno**, y que su `resolution_number` es un rótulo del
   * comerciante, no una autorización DIAN que se pueda exigir ni confrontar.
   */
  requires_authorized_range: boolean;
  /**
   * ¿La clave de este documento se alimenta de la ClTec del rango?
   *
   * Solo la factura electrónica de venta. Todo lo demás usa el Software-PIN
   * como 14º campo por diseño del esquema DIAN. **La UI no debe limitarse a
   * deshabilitar el campo cuando esto es `false`: debe no renderizarlo.** Un
   * campo deshabilitado sigue diciendo «esto aplica y hoy no puedes tocarlo»,
   * que es exactamente la creencia equivocada.
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
 * LA TABLA. `Record<FiscalDocumentType, …>` es deliberado: añadir un valor a la
 * unión sin añadirlo aquí rompe la compilación, que es exactamente el momento
 * en que hay que decidir sus requisitos y no seis pantallas después.
 */
export const FISCAL_DOCUMENT_REQUIREMENTS: Readonly<
  Record<FiscalDocumentType, FiscalDocumentRequirements>
> = Object.freeze({
  /**
   * El ÚNICO que exige clave técnica. Firmar su CUFE con el Software-PIN
   * produce una clave que la DIAN rechaza.
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
   * 000165/2023 las regula como mecanismo de anulación/ajuste de un documento
   * ya emitido, sin rango autorizado propio. Su fila sigue existiendo como
   * fuente de consecutivo interno, pero no se le puede exigir número de
   * resolución DIAN ni clave técnica.
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
   * Nómina electrónica. NO lleva resolución de numeración: el DSPNE numera con
   * su propio consecutivo `NumNE`. Exigirle rango bloquearía la habilitación de
   * nómina de forma permanente.
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
   * `InvoiceTypeCode` '20'). Tiene rango autorizado PROPIO —compartir el de la
   * factura de venta quemaría consecutivos FEV en tiquetes POS— y aun así su
   * clave es un CUDE con Software-PIN, no un CUFE con ClTec.
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
   * Nota de ajuste al documento equivalente ('93' débito / '94' crédito,
   * numeral 16.3). El DE no tiene nota crédito/débito propia — solo estas.
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

/** Rótulo de cada habilitación, derivado de su documento representativo. */
export const DIAN_CONFIGURATION_TYPE_LABELS: Readonly<
  Record<DianConfigurationType, string>
> = Object.freeze({
  invoicing: 'Facturación electrónica',
  support_document: 'Documento soporte',
  payroll: 'Nómina electrónica',
  equivalent_document: 'Documento equivalente POS',
});

/** ¿Es `value` un tipo de documento fiscal válido? Guard para entrada externa. */
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

/** Qué habilitación DIAN cubre este documento. */
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
 * NUNCA `sales_invoice`.
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
 * Los tipos de documento para los que SE REGISTRA una resolución.
 *
 * Espejo del `@IsEnum` de `CreateResolutionDto`
 * (`resolutions/dto/create-resolution.dto.ts`), que excluye a propósito
 * `payroll` y `payroll_adjustment`: la nómina electrónica numera con su propio
 * consecutivo `NumNE` del DSPNE y no tiene fila de resolución. Ofrecerlos en el
 * formulario produciría un 400 que el usuario no puede interpretar.
 */
export const RESOLUTION_DOCUMENT_TYPES = FISCAL_DOCUMENT_TYPES.filter(
  (document_type) =>
    FISCAL_DOCUMENT_REQUIREMENTS[document_type].configuration_type !== 'payroll',
);

/** Tipos de documento con resolución registrable dentro de una habilitación. */
export function resolutionDocumentTypesFor(
  configuration_type: DianConfigurationType,
): FiscalDocumentType[] {
  return RESOLUTION_DOCUMENT_TYPES.filter(
    (document_type) =>
      FISCAL_DOCUMENT_REQUIREMENTS[document_type].configuration_type ===
      configuration_type,
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
  /**
   * SOLO frontend. `true` cuando se edita una resolución que YA tiene ClTec
   * guardada y el campo se dejó vacío para no cambiarla.
   *
   * Sin esta señal, editar una factura de venta sin retocar su clave técnica
   * dispararía `TECHNICAL_KEY_REQUIRED` y obligaría a reescribir a mano un
   * secreto que el agregado —correctamente— nunca devuelve: sólo informa
   * `technical_key_set`. El comerciante acabaría tecleándolo mal y firmando
   * CUFE inválidos.
   */
  technical_key_already_stored?: boolean;
}

/**
 * Valida un borrador de resolución contra el contrato. PURA: devuelve las
 * violaciones, no lanza ni conoce HTTP.
 *
 * Espejo de `validateResolutionDraft` del backend, más la regla de edición que
 * sólo el frontend puede conocer (`technical_key_already_stored`). Solo juzga
 * lo que el contrato declara: vigencias, rango, unicidad de ClTec por
 * (NIT, rango) y estado de habilitación viven en sus dueños del backend y no se
 * duplican aquí — reimplementarlas produciría dos veredictos distintos para el
 * mismo formulario.
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

  if (
    requirements.accepts_technical_key &&
    !technical_key &&
    !draft.technical_key_already_stored
  ) {
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
