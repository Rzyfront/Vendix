/**
 * DIAN DSPNE (Documento Soporte de Pago de Nomina Electronica) constants.
 *
 * These codes are defined by DIAN resolution and map internal Vendix
 * domain values to the codes expected in the NominaIndividual XML.
 */

/** Maps internal contract type to DIAN TipoContrato code */
export const CONTRACT_TYPE_MAP: Record<string, string> = {
  indefinite: '2',
  fixed_term: '1',
  service: '3',
  apprentice: '4',
};

/** Maps internal document type to DIAN TipoDocumento code */
export const DOCUMENT_TYPE_MAP: Record<string, string> = {
  CC: '13',
  CE: '22',
  NIT: '31',
  TI: '12',
  PP: '41',
  NIT_EXTRANJERIA: '22',
};

/** Maps internal worker type to DIAN TipoTrabajador code */
export const WORKER_TYPE_MAP: Record<string, string> = {
  employee: '01',
  domestic: '02',
  apprentice: '12',
};

/** Maps internal payment method to DIAN Metodo code */
export const PAYMENT_METHOD_MAP: Record<string, string> = {
  cash: '10',
  bank_transfer: '47',
  check: '20',
};

/** DSPNE XML version string required in InformacionGeneral */
export const DSPNE_VERSION =
  'V1.0: Documento Soporte de Pago de Nomina Electronica';

/** XML namespace for NominaIndividual documents */
export const NOMINA_NAMESPACE =
  'dian:gov:co:facturaelectronica:NominaIndividual';

/** TipoXML values */
export const TIPO_XML = {
  NOMINA_INDIVIDUAL: 102,
  NOMINA_INDIVIDUAL_AJUSTE: 103,
} as const;

/** Default country code for Colombia */
export const DEFAULT_COUNTRY_CODE = 'CO';

/** Default language code */
export const DEFAULT_LANGUAGE = 'es';

/** Default currency */
export const DEFAULT_CURRENCY = 'COP';

/** SOAP action for sending payroll documents */
export const DIAN_NOMINA_SOAP_ACTION =
  'http://wcf.dian.colombia/IWcfDianCustomerServices/SendNominaSync';
