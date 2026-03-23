import { createHash } from 'crypto';

/**
 * CUNE (Codigo Unico de Nomina Electronica) calculator for DSPNE.
 *
 * The CUNE is a SHA-384 hash of a concatenation of document fields,
 * serving as a unique identifier for each payroll document sent to DIAN.
 *
 * Formula: SHA-384(NumNE + FecNE + HorNE + ValDev + ValDed + ValTolNE
 *                  + NitNE + DocEmp + TipoXML + SoftwarePIN + TipAmb)
 */
export class CuneCalculator {
  /**
   * Generates the CUNE hash for a DSPNE document.
   */
  static generate(params: {
    /** Payroll document number (NumNE) */
    document_number: string;
    /** Issue date in YYYY-MM-DD format (FecNE) */
    issue_date: string;
    /** Issue time in HH:mm:ss-05:00 format (HorNE) */
    issue_time: string;
    /** Total earnings (ValDev) */
    total_earnings: number;
    /** Total deductions (ValDed) */
    total_deductions: number;
    /** Net amount: earnings - deductions (ValTolNE) */
    total_amount: number;
    /** Employer NIT (NitNE) */
    issuer_nit: string;
    /** Employee document number (DocEmp) */
    employee_document: string;
    /** Document type: 102 (individual) or 103 (adjustment) */
    document_type: number;
    /** Software PIN from DIAN configuration */
    software_pin: string;
    /** Environment: '1' = production, '2' = test */
    environment: '1' | '2';
  }): string {
    const format_amount = (n: number) => n.toFixed(2);

    const raw =
      params.document_number +
      params.issue_date +
      params.issue_time +
      format_amount(params.total_earnings) +
      format_amount(params.total_deductions) +
      format_amount(params.total_amount) +
      params.issuer_nit +
      params.employee_document +
      String(params.document_type) +
      params.software_pin +
      params.environment;

    return createHash('sha384').update(raw).digest('hex');
  }

  /**
   * Generates the SoftwareSC (Software Security Code) for DSPNE.
   * SHA-384(SoftwareID + PIN + NumNE)
   */
  static generateSoftwareSecurityCode(
    software_id: string,
    pin: string,
    document_number: string,
  ): string {
    return createHash('sha384')
      .update(software_id + pin + document_number)
      .digest('hex');
  }
}
