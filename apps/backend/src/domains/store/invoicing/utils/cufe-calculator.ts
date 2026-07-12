import { createHash } from 'crypto';

/**
 * CUFE / CUDE / CUDS calculator (Codigo Unico de Facturacion / Documento
 * Electronico). Computes the SHA-384 document key defined by the Colombian
 * DIAN specification — the mandated fields concatenated in order and hashed.
 * This is the REAL production CUFE/CUDE/CUDS: it is consumed both by the mock
 * provider and by the live DIAN provider (dian-direct.provider.ts).
 *
 * NOTE: The CUFE is a document HASH, not a digital signature. The XAdES
 * digital signature of the UBL XML (PKI, .p12 certificate) is a separate step
 * handled by dian-direct/dian-xml-signer.service.ts. This util only derives
 * the document key; it does not sign anything.
 */
export class CufeCalculator {
  /**
   * Generates a CUFE hash based on invoice data.
   *
   * CUFE = SHA-384(
   *   NumFac + FecFac + HorFac + ValFac + CodImp1 + ValImp1 +
   *   CodImp2 + ValImp2 + CodImp3 + ValImp3 + ValTot +
   *   NitOFE + NumAdq + ClTec + TipoAmbiente
   * )
   */
  static generate(params: CufeParams): string {
    const raw_string = [
      params.invoice_number,
      params.issue_date,
      params.issue_time,
      params.total_before_tax,
      '01', // IVA code
      params.tax_iva,
      '04', // INC code
      params.tax_inc || '0.00',
      '03', // ICA code
      params.tax_ica || '0.00',
      params.total_amount,
      params.issuer_nit,
      params.customer_nit,
      params.technical_key,
      params.environment || '2', // 1=production, 2=test
    ].join('');

    return createHash('sha384').update(raw_string).digest('hex');
  }

  /**
   * Generates a fake QR code URL for testing purposes.
   */
  static generateQrUrl(cufe: string): string {
    return `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufe}`;
  }
}

export interface CufeParams {
  invoice_number: string;
  issue_date: string; // YYYY-MM-DD
  issue_time: string; // HH:mm:ss-05:00
  total_before_tax: string;
  tax_iva: string;
  tax_inc?: string;
  tax_ica?: string;
  total_amount: string;
  issuer_nit: string;
  customer_nit: string;
  technical_key: string;
  environment?: string;
}
