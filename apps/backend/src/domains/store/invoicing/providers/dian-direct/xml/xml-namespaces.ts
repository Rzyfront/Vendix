/**
 * XML namespaces used in Colombian UBL 2.1 electronic invoicing.
 * These are required by the DIAN for valid document generation.
 */
export const UBL_NAMESPACES = {
  /** Main invoice namespace */
  INVOICE: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  /** Credit note namespace */
  CREDIT_NOTE: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  /** Debit note namespace */
  DEBIT_NOTE: 'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2',
  /** Common Aggregate Components */
  CAC: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  /** Common Basic Components */
  CBC: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  /** Common Extension Components */
  EXT: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  /** DIAN extensions (Software Security) */
  STS: 'dian:gov:co:facturaelectronica:Structures-2-1',
  /** XML Digital Signature */
  DS: 'http://www.w3.org/2000/09/xmldsig#',
  /** XAdES */
  XADES: 'http://uri.etsi.org/01903/v1.3.2#',
  /** XAdES v1.4.1 */
  XADES141: 'http://uri.etsi.org/01903/v1.4.1#',
} as const;

/**
 * Colombia-specific constants for UBL documents.
 */
export const UBL_CONSTANTS = {
  /** UBL version for Colombia */
  UBL_VERSION: 'UBL 2.1',
  /** DIAN customization version */
  CUSTOMIZATION_ID: '2',
  /** Profile ID for standard invoicing */
  PROFILE_ID: 'DIAN 2.1: Factura Electrónica de Venta',
  /** Profile execution ID: 1=Production, 2=Test */
  PROFILE_EXECUTION_ID_TEST: '2',
  PROFILE_EXECUTION_ID_PROD: '1',
  /** Country code */
  COUNTRY_CODE: 'CO',
  /** Currency */
  DEFAULT_CURRENCY: 'COP',
  /** DIAN technical provider NIT */
  DIAN_NIT: '800197268',
} as const;
