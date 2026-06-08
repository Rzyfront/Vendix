export interface CertificateValidationResult {
  valid: boolean;
  subject?: string;
  issuer?: string;
  expires?: Date;
  serial_number?: string;
  fingerprint?: string;
  tax_id?: string;
  error?: string;
}

export interface CertificateIssuerAdapter {
  readonly provider: 'manual_upload_validated' | 'issuer_adapter';

  validateCertificate(params: {
    p12_buffer: Buffer;
    password: string;
    expected_tax_id?: string | null;
    /** Verification digit (DV) of the expected NIT, for DV-tolerant matching. */
    expected_dv?: string | null;
  }): Promise<CertificateValidationResult>;
}
