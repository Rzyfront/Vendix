/**
 * Decrypted DIAN configuration for a store.
 * Used internally after decrypting sensitive fields from the database.
 */
export interface DianConfigDecrypted {
  id: number;
  organization_id: number;
  store_id: number | null;
  accounting_entity_id: number;
  nit: string;
  nit_dv: string | null;
  software_id: string;
  software_pin: string; // Decrypted
  certificate_s3_key: string | null;
  certificate_password: string | null; // Decrypted
  certificate_expiry: Date | null;
  environment: 'test' | 'production';
  enablement_status:
    | 'not_started'
    | 'testing'
    | 'test_set_passed'
    | 'enabled'
    | 'suspended'
    | 'expired';
  test_set_id: string | null;
}

/**
 * Issuer (emisor) data for building UBL XML.
 */
export interface DianIssuerData {
  document_type?: string;
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
  /**
   * DIAN organization/person type for `cbc:AdditionalAccountID`:
   * '1' = Persona Jurídica (default), '2' = Persona Natural.
   * NOTE: this is NOT the tax regime. The regime ('48' Responsable de IVA /
   * '49' No responsable) is carried by `cac:PartyTaxScheme/cbc:TaxLevelCode`
   * (its `listName` attribute), never by AdditionalAccountID.
   */
  person_type?: string;
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
  /**
   * DIAN organization/person type for `cbc:AdditionalAccountID` ('1' Persona
   * Jurídica / '2' Persona Natural). When absent it is derived from
   * `document_type` (NIT '31' → '1', otherwise '2').
   */
  person_type?: string;
}

/**
 * Software security data required by DIAN for document signing.
 */
export interface DianSoftwareSecurity {
  software_id: string;
  software_pin: string;
  /** SHA-384 hash of (software_id + software_pin + invoice_number) */
  software_security_code: string;
  /**
   * NIT of the software provider (proveedor de software) for
   * `sts:SoftwareProvider/sts:ProviderID`. When absent, the issuer NIT is used
   * as fallback (self-developed billing software).
   */
  provider_nit?: string;
  /** Verification digit (DV) of `provider_nit`, for the ProviderID `schemeID`. */
  provider_nit_dv?: string;
}

/**
 * DIAN numbering-resolution control data for the
 * `sts:DianExtensions/sts:InvoiceControl` block. Sourced from
 * `invoice_resolutions` (resolution_number, valid_from/valid_to, prefix,
 * range_from/range_to).
 */
export interface DianInvoiceControl {
  /** Resolution number → `sts:InvoiceAuthorization`. */
  invoice_authorization: string;
  /** Authorization period start (YYYY-MM-DD) → `sts:AuthorizationPeriod/cbc:StartDate`. */
  authorization_start_date: string;
  /** Authorization period end (YYYY-MM-DD) → `sts:AuthorizationPeriod/cbc:EndDate`. */
  authorization_end_date: string;
  /** Authorized numbering prefix, e.g. 'SETP' → `sts:AuthorizedInvoices/sts:Prefix`. */
  prefix: string;
  /** First authorized number → `sts:AuthorizedInvoices/sts:From`. */
  range_from: string;
  /** Last authorized number → `sts:AuthorizedInvoices/sts:To`. */
  range_to: string;
}
