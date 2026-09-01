/**
 * De qué escalón de la cascada de respaldo salió la dirección que el documento
 * declara para el adquiriente (ver `acquirer-address.resolver.ts`, dueño de la
 * política).
 *
 * El TIPO vive acá y no junto a la cascada por una razón mecánica: la cascada
 * importa el builder UBL y el builder importa este archivo. Declararlo en la
 * cascada cerraría el ciclo interfaces → cascada → builder → interfaces. Este
 * archivo no importa nada, así que es el único sitio donde el tipo no crea uno.
 */
export type DianAcquirerAddressSource = 'fiscal' | 'shipping' | 'store';

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
  /**
   * KMS key holding the certificate's private half (non-exportable). When set the
   * signature is produced inside the HSM and no PEM private key ever exists in
   * this process. NOT a secret — it is an ARN, so it is carried in the clear
   * alongside the S3 key rather than through the encryption envelope.
   */
  certificate_kms_key_id: string | null;
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
  /**
   * Modo de operación declarado ante la DIAN. Se arrastra hasta aquí porque
   * define el código `ppp` del nombre de los archivos entregados a la DIAN
   * (Anexo Técnico 1.9, numeral 6.5.7) — ver `dian-file-naming.util.ts`.
   */
  operation_mode: string;
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
 *
 * `document_type` is the LITERAL stored in `users.document_type` ('CC', 'NIT',
 * 'CE', 'PPT', …) — NOT the DIAN scheme code. The UBL builder translates to the
 * DIAN code through `DIAN_ID_TYPES[document_type]`. The literal is the source
 * of truth for `@schemeName`; the code is the value for `@schemeID`.
 *
 * Anexo Técnico 19 needs every field here to emit a conformant
 * `cac:AccountingCustomerParty`: structural branch between `cac:Person` and
 * `cac:PartyLegalEntity`, the verification digit alongside the bare NIT,
 * every fiscal responsibility concatenated, the CIIU code, and the retenedor
 * markers as additional `cbc:AdditionalAccountID` siblings.
 */
export interface DianCustomerData {
  /** Literal from `users.document_type` (e.g., 'CC', 'NIT', 'PPT'). */
  document_type: string;
  document_number: string;
  /**
   * Verification digit (DV) of `document_number`. Only meaningful when the
   * document is NIT-like (NIT, NIT_EXTRANJERIA, DIE); the UBL builder emits it
   * alongside the bare NIT per Anexo 19 (canonical form: `NIT-DV`).
   */
  verification_digit: string | null;
  /**
   * Razón social when JURIDICA; first_name+last_name concatenated when
   * NATURAL. Kept as the registration/legal name in UBL.
   */
  legal_name: string | null;
  trade_name?: string;
  first_name?: string;
  last_name?: string;
  address_line?: string;
  city_code?: string;
  city_name?: string;
  department_code?: string;
  department_name?: string;
  country_code?: string;
  postal_code?: string;
  phone?: string;
  email?: string;
  /**
   * DIAN party account type ('1' Persona Jurídica / '2' Persona Natural). Se
   * deriva de `person_type` en el builder, y de nada más: los marcadores de
   * retenedor que antes se sumaban aquí producían un segundo
   * `cbc:AdditionalAccountID` y la DIAN rechazó por él (FVJL7/FVJL8). El
   * elemento es 1..1 con dominio `TipoOrganizacion-2.1.gc`. Se conserva en la
   * forma del dato por compatibilidad con el lado del emisor.
   */
  tax_regime?: string;
  /**
   * Full list of fiscal responsibilities (RUT codes) for `cac:TaxScheme/
   * cbc:TaxLevelCode`. Joined with `;` per Anexo 19. `R-99-PN` is the
   * "ninguna de las anteriores" fallback; absent/empty maps to it via
   * `toDianTaxLevelCode` (`constants/dian-tax-level-codes.ts`).
   */
  tax_responsibilities: string[];
  /**
   * `cac:Person` vs `cac:PartyLegalEntity` selector for the customer.
   *
   *   JURIDICA  → emit `cac:PartyLegalEntity` with `cbc:RegistrationName` +
   *               `cbc:CompanyID`.
   *   NATURAL   → emit `cac:Person` with `cbc:FirstName` + `cbc:FamilyName` +
   *               `cbc:ID`.
   *   null      → derive from `document_type`: NIT → JURIDICA, else NATURAL.
   *
   * The branch is STRUCTURAL (not just value): emitting `cac:PartyLegalEntity`
   * for a persona natural is the Anexo 19 defect that causes DIAN rejection.
   */
  person_type: 'NATURAL' | 'JURIDICA' | null;
  /**
   * CIIU code (4 digits, RUT casilla 46). When present, emitted as
   * `cbc:IndustryClassificationCode` under `cac:Party`. Optional per Anexo 19.
   */
  ciiu_code: string | null;
  /**
   * Marks the customer as agente de retención — adds `cbc:AdditionalAccountID
   * = "3"` alongside the person-type marker.
   */
  is_withholding_agent?: boolean;
  /**
   * ESCALÓN DE LA CASCADA DEL QUE SALIÓ LA DIRECCIÓN DE ARRIBA.
   *
   * `'fiscal'` la del cliente, `'shipping'` otra suya, `'store'` la del emisor
   * (ver `acquirer-address.resolver.ts`). `null`/ausente cuando el documento no
   * declara dirección — consumidor final, o adquiriente sin ninguna.
   *
   * NO viaja al XML: el documento declara la dirección, no su procedencia. Vive
   * acá para subir hasta `ProviderResponse.provider_data` y poder decirle al
   * usuario, en la confirmación, con qué domicilio se emitió. Un respaldo
   * silencioso es exactamente lo que produjo el defecto que esta cascada cierra.
   */
  address_source?: DianAcquirerAddressSource | null;
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
