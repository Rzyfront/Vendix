/**
 * Contract for the AI-powered RUT (Registro Único Tributario) scanner.
 *
 * The backend endpoint `POST {store|organization}/settings/rut-scanner/scan`
 * accepts a single multipart field `file` (image/jpeg, image/png, image/webp
 * or application/pdf, ≤10MB) and returns `{ success, data: RutScanResult }`.
 *
 * Consumed by `RutScannerService` and `app-rut-scanner-modal`. The modal emits
 * a `RutScanResult` upward so the legal-data step can seed its form values.
 */

export type RutPersonType = 'NATURAL' | 'JURIDICA';

export type RutTaxRegime = 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE';

/**
 * Tenant scope used to resolve the scanner endpoint. ORG_ADMIN users post to
 * the `organization` namespace; everyone else posts to `store`. El scope
 * `platform` (super-admin fiscal) se acepta a nivel de tipos para que el
 * `FiscalIdentityPanelComponent` pueda reusar este modal en el tab
 * "Identidad" de la plataforma; el modal quedará deshabilitado a nivel
 * UI si el backend no expone un endpoint equivalente.
 */
export type RutScannerScope = 'store' | 'organization' | 'platform';

export interface RutScanResult {
  /** Tax identification number (NIT) without the verification digit. */
  nit: string;
  /** Verification digit ("dígito de verificación"). */
  nit_dv: string;
  /** Document type — always 'NIT' for a RUT. */
  nit_type: 'NIT';
  /** Legal/business name ("razón social"). */
  legal_name: string;
  /** Whether the taxpayer is a natural person or a legal entity. */
  person_type: RutPersonType;
  /** DIAN tax regime classification. */
  tax_regime: RutTaxRegime;
  /** Primary CIIU economic-activity code. */
  ciiu: string;
  /** Registered fiscal address. */
  fiscal_address: string;
  /** ISO/country name as extracted from the RUT. */
  country: string;
  /** Department ("departamento"). */
  department: string;
  /** City/municipality. */
  city: string;
  /** DIAN tax responsibilities (e.g. "O-13", "O-15"). */
  tax_responsibilities: string[];
  /** Tax scheme descriptor as printed on the RUT. */
  tax_scheme: string;
  /** Model confidence for the extraction, 0–1. */
  confidence: number;
  /** Optional free-form notes the model attached to the extraction. */
  extraction_notes?: string;
}

/** Generic envelope returned by the RUT scanner endpoint. */
export interface RutScanApiResponse {
  success: boolean;
  data: RutScanResult;
  message?: string;
}
