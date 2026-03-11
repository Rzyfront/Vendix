/**
 * Decrypted DIAN configuration for a store.
 * Used internally after decrypting sensitive fields from the database.
 */
export interface DianConfigDecrypted {
  id: number;
  organization_id: number;
  store_id: number;
  nit: string;
  nit_dv: string | null;
  software_id: string;
  software_pin: string; // Decrypted
  certificate_s3_key: string | null;
  certificate_password: string | null; // Decrypted
  certificate_expiry: Date | null;
  environment: 'test' | 'production';
  enablement_status: 'not_started' | 'testing' | 'enabled' | 'suspended';
  test_set_id: string | null;
}

/**
 * Issuer (emisor) data for building UBL XML.
 */
export interface DianIssuerData {
  nit: string;
  nit_dv: string;
  legal_name: string;
  trade_name?: string;
  address_line: string;
  city_code: string;
  city_name: string;
  department_code: string;
  department_name: string;
  country_code: string;
  postal_code?: string;
  phone?: string;
  email: string;
  tax_regime: string; // '48' = Responsable IVA, '49' = No responsable
  tax_scheme: string; // 'O-13' = Gran contribuyente, 'O-15' = Autorretenedor, etc.
}

/**
 * Customer (adquirente) data for building UBL XML.
 */
export interface DianCustomerData {
  document_type: string; // DIAN code: '13'=CC, '31'=NIT, etc.
  document_number: string;
  document_dv?: string;
  legal_name: string;
  trade_name?: string;
  address_line?: string;
  city_code?: string;
  city_name?: string;
  department_code?: string;
  department_name?: string;
  country_code?: string;
  postal_code?: string;
  phone?: string;
  email?: string;
  tax_regime?: string;
  tax_responsibilities?: string[];
}

/**
 * Software security data required by DIAN for document signing.
 */
export interface DianSoftwareSecurity {
  software_id: string;
  software_pin: string;
  /** SHA-384 hash of (software_id + software_pin + invoice_number) */
  software_security_code: string;
}
