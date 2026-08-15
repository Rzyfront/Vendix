/**
 * DIAN document type codes for electronic invoicing.
 * Used in the UBL InvoiceTypeCode element.
 */
export const DIAN_DOCUMENT_TYPES = {
  /** Factura de venta nacional */
  INVOICE: '01',
  /** Factura de exportación */
  EXPORT_INVOICE: '02',
  /**
   * Factura por contingencia DEL FACTURADOR (Anexo 1.9 §12.1): se facturó en
   * talonario o papel durante la falla y luego se transcribe cada documento con
   * este código, contra la numeración DE CONTINGENCIA, dentro de 48 h.
   */
  CONTINGENCY_INVOICE: '03',
  /**
   * Factura por contingencia DE LA DIAN (Anexo 1.9 §12.2): el servicio de
   * validación previa no está disponible. Se expide con el MISMO prefijo y número
   * de la numeración normal, re-firmada, y se entrega al adquiriente dentro de un
   * `AttachedDocument` SIN `ApplicationResponse`. Debe transmitirse en 48 h.
   */
  CONTINGENCY_DIAN_INVOICE: '04',
  /** Nota crédito */
  CREDIT_NOTE: '91',
  /** Nota débito */
  DEBIT_NOTE: '92',
  /** Documento soporte en adquisiciones a sujetos no obligados */
  SUPPORT_DOCUMENT: '05',
  /** Nota de ajuste al documento soporte */
  SUPPORT_ADJUSTMENT_NOTE: '95',
  /**
   * Documento equivalente electrónico del tiquete de máquina registradora con
   * sistema P.O.S.
   *
   * Res. 000165/2023, Anexo Técnico de documento equivalente electrónico v1.0,
   * numeral 16.3. Note the collision hazard: '20' is ALSO
   * `DIAN_OPERATION_TYPES.EXPORT_INVOICE`, a `CustomizationID` value. They live in
   * different elements and different tables — this one is the
   * `cbc:InvoiceTypeCode` of an equivalent document.
   */
  POS_EQUIVALENT_DOCUMENT: '20',
  /** Nota de ajuste de tipo débito al documento equivalente (numeral 16.3). */
  EQUIVALENT_DEBIT_ADJUSTMENT_NOTE: '93',
  /** Nota de ajuste de tipo crédito al documento equivalente (numeral 16.3). */
  EQUIVALENT_CREDIT_ADJUSTMENT_NOTE: '94',
} as const;

/**
 * DIAN operation types for the CustomizationID element.
 * Identifies the specific operation type within a document.
 */
export const DIAN_OPERATION_TYPES = {
  /** Factura estándar nacional */
  STANDARD_INVOICE: '10',
  /** Factura de exportación */
  EXPORT_INVOICE: '20',
  /** Factura de contingencia */
  CONTINGENCY_INVOICE: '30',
  /**
   * Nota crédito que referencia una factura electrónica (con referencia).
   * Valor por defecto DIAN para notas crédito.
   */
  CREDIT_NOTE_WITH_REF: '20',
  /** Nota crédito sin referencia a facturas */
  CREDIT_NOTE_NO_REF: '22',
  /** Nota débito que referencia una factura electrónica (con referencia) */
  DEBIT_NOTE_WITH_REF: '30',
  /** Nota débito sin referencia a facturas */
  DEBIT_NOTE_NO_REF: '32',
  /** Documento soporte: vendedor residente fiscal colombiano */
  SUPPORT_DOCUMENT_RESIDENT_SELLER: '10',
  /** Documento soporte: vendedor no residente fiscal colombiano */
  SUPPORT_DOCUMENT_NON_RESIDENT_SELLER: '11',
  /**
   * Documento equivalente electrónico con UN solo modo de operación — which is the
   * case for the POS ticket (numeral 16.4.1 lists code '10' as the shared value for
   * document types 20, 25, 35, 40, 45 and 50).
   */
  EQUIVALENT_DOCUMENT_SINGLE_MODE: '10',
} as const;

/**
 * Identification document types for parties (Anexo Técnico 19).
 *
 * Single source of truth for the document-type → DIAN schemeID mapping
 * used by `cbc:CompanyID@schemeID` and `cbc:ID@schemeID`. The issuer-side
 * `DIAN_DOCUMENT_TYPE_BY_NIT_TYPE` (organization-fiscal-columns.helper.ts)
 * MUST defer to this constant; if it diverges, that helper will need to
 * import from here.
 *
 * Anexo 19 official table:
 *   11 = Registro Civil (RC)
 *   12 = Tarjeta de Identidad (TI)
 *   13 = Cédula de Ciudadanía (CC)
 *   21 = Tarjeta de Extranjería
 *   22 = Cédula de Extranjería (CE)
 *   31 = NIT
 *   41 = Pasaporte
 *   42 = Documento de Identificación Extranjero (DIE)
 *   47 = PEP
 *   48 = PPT (Permiso por Protección Temporal)
 *   50 = NIT de persona natural extranjera (NIT_EXTRANJERIA)
 *   91 = NUIP
 */
export const DIAN_ID_TYPES: Record<string, string> = {
  RC: '11',              // Registro Civil
  TI: '12',              // Tarjeta de Identidad
  CC: '13',              // Cédula de ciudadanía
  PA: '21',              // Tarjeta de Extranjería
  CE: '22',              // Cédula de extranjería
  NIT: '31',             // NIT
  PASSPORT: '41',        // Pasaporte
  DIE: '42',             // Documento de Identificación Extranjero
  PEP: '47',             // PEP (Permiso Especial de Permanencia)
  PPT: '48',             // PPT (Permiso por Protección Temporal)
  NIT_EXTRANJERIA: '50', // NIT de persona natural extranjera
  NUIP: '91',            // NUIP
};

/**
 * Payment means codes (DIAN / UN/CEFACT).
 */
export const DIAN_PAYMENT_MEANS = {
  CASH: '10',
  CREDIT: '30', // Crédito (a plazo)
  DEBIT_TRANSFER: '42', // Transferencia débito bancaria
  CREDIT_CARD: '48', // Tarjeta crédito
  DEBIT_CARD: '49', // Tarjeta débito
  MUTUAL_AGREEMENT: '1', // Instrumento no definido
} as const;

/**
 * Payment method codes (DIAN).
 * 1 = Contado, 2 = Crédito
 */
export const DIAN_PAYMENT_METHODS = {
  CASH: '1',
  CREDIT: '2',
} as const;
