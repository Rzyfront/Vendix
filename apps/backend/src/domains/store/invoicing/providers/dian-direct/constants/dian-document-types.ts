/**
 * DIAN document type codes for electronic invoicing.
 * Used in the UBL InvoiceTypeCode element.
 */
export const DIAN_DOCUMENT_TYPES = {
  /** Factura de venta nacional */
  INVOICE: '01',
  /** Factura de exportación */
  EXPORT_INVOICE: '02',
  /** Factura por contingencia facturador */
  CONTINGENCY_INVOICE: '03',
  /** Nota crédito */
  CREDIT_NOTE: '91',
  /** Nota débito */
  DEBIT_NOTE: '92',
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
  /** Nota crédito sin referencia a facturas */
  CREDIT_NOTE_NO_REF: '20',
  /** Nota crédito referenciando facturas */
  CREDIT_NOTE_WITH_REF: '22',
  /** Nota débito sin referencia a facturas */
  DEBIT_NOTE_NO_REF: '30',
  /** Nota débito referenciando facturas */
  DEBIT_NOTE_WITH_REF: '32',
} as const;

/**
 * Identification document types for parties.
 */
export const DIAN_ID_TYPES: Record<string, string> = {
  CC: '13', // Cédula de ciudadanía
  CE: '22', // Cédula de extranjería
  NIT: '31', // NIT
  PASSPORT: '41', // Pasaporte
  PEP: '47', // PEP
  PPT: '50', // PPT
  NUIP: '91', // NUIP
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
