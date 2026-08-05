import { createHash } from 'crypto';
import { dianAmount } from './dian-money.util';
import { onlyDigits } from '../../../../common/utils/nit.util';

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
 *
 * WHY THE NORMALIZATION BELOW IS NOT OPTIONAL: the DIAN recomputes this hash
 * from the XML it receives. Any difference in scale (`1000` vs `1000.00`) or in
 * NIT punctuation (`900.123.456-7` vs `900123456`) produces a different hash
 * and the document is rejected. Callers used to hand over `Decimal.toString()`
 * output, which strips trailing zeros, so normalizing HERE — at the single point
 * every provider funnels through — is what guarantees the two hashes agree.
 * See docs/facturacion-electronica-dian-software-propio.md §20.0-bis.
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
   *
   * Anexo Técnico 1.9 §11.2 (p.655-658): monetary fields carry exactly 2
   * truncated decimals; `NitOFE`/`NumAdq` carry no dots, no dashes and no
   * verification digit. Both rules are enforced here regardless of how the
   * caller formatted its input.
   */
  static generate(params: CufeParams): string {
    const raw_string = [
      params.invoice_number,
      params.issue_date,
      params.issue_time,
      dianAmount(params.total_before_tax),
      '01', // IVA code
      dianAmount(params.tax_iva),
      '04', // INC code
      dianAmount(params.tax_inc),
      '03', // ICA code
      dianAmount(params.tax_ica),
      dianAmount(params.total_amount),
      onlyDigits(params.issuer_nit),
      onlyDigits(params.customer_nit),
      params.technical_key,
      params.environment || '2', // 1=production, 2=test
    ].join('');

    return createHash('sha384').update(raw_string).digest('hex');
  }

  /**
   * CUDE of a RADIAN document event (`ApplicationResponse`).
   *
   * An event carries NO monetary totals, so it does NOT use the 15-field invoice
   * formula. Its key is:
   *
   *   CUDE = SHA-384(
   *     Num_DE + Fec_Emi + Hor_Emi + NitFE + DocAdq +
   *     ResponseCode + ID + DocumentTypeCode + Software-PIN
   *   )
   *
   * ✅ CONFIRMED against **Anexo Técnico de documento equivalente electrónico
   * v1.0 (Res. 000165/2023), numerales 14.1.7 y 14.1.8**, which publish both the
   * field list and a worked vector — see the spec, which asserts the annex's own
   * published hash. That vector is what makes this verifiable rather than
   * plausible.
   *
   * The previous implementation was wrong in three ways, and each alone produces a
   * key the DIAN cannot reproduce (so every event was rejected):
   *
   * 1. `ResponseCode` sat in position 4; it belongs AFTER both identifications.
   * 2. The referenced document's `ID` and `DocumentTypeCode` were missing
   *    entirely — an event's key binds the document it refers to.
   * 3. `TipoAmbiente` was appended at the end. The chain ENDS at the Software-PIN;
   *    the published vector has no environment digit.
   *
   * Reusing `generate()` here would hash eight `0.00` amount fields, which is why
   * this stays a separate method instead of a call with zeroed params.
   */
  static generateEventCude(params: EventCudeParams): string {
    const raw_string = [
      params.event_number,
      params.issue_date,
      params.issue_time,
      onlyDigits(params.issuer_nit),
      onlyDigits(params.customer_nit),
      params.event_code,
      params.referenced_document_number,
      params.referenced_document_type_code || '01',
      params.software_pin,
    ].join('');

    return createHash('sha384').update(raw_string).digest('hex');
  }

  /**
   * CUDE of an electronic equivalent document (e.g. the POS ticket) and of its
   * adjustment notes.
   *
   * Same 15-field shape as the invoice CUFE with ONE substitution: the
   * `ClTec` (technical key, which a numbering resolution grants) is replaced by
   * the **Software-PIN**. Res. 000165/2023 Anexo Técnico DE v1.0 §14.1.2–14.1.4:
   *
   *   CUDE = SHA-384(
   *     NumFac + FecFac + HorFac + ValFac + '01' + ValImp1 + '04' + ValImp2 +
   *     '03' + ValImp3 + ValTot + NitFE + NumAdq + Software-PIN + TipoAmbiente
   *   )
   *
   * Delegates the field assembly to {@link generate} so the money and NIT
   * normalization rules stay in ONE place: the reason §20.0-bis existed was two
   * code paths formatting the same amount differently.
   */
  static generateEquivalentDocumentCude(
    params: Omit<CufeParams, 'technical_key'> & { software_pin: string },
  ): string {
    return CufeCalculator.generate({
      ...params,
      technical_key: params.software_pin,
    });
  }

  /**
   * Generates a fake QR code URL for testing purposes.
   */
  static generateQrUrl(cufe: string): string {
    return `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufe}`;
  }
}

export interface EventCudeParams {
  /** `Num_DE`: event consecutive we assigned (`cbc:ID` of the ApplicationResponse). */
  event_number: string;
  /** `Fec_Emi`, YYYY-MM-DD */
  issue_date: string;
  /** `Hor_Emi`, HH:mm:ss-05:00 */
  issue_time: string;
  /** `ResponseCode`: RADIAN event code ('030' … '051'). */
  event_code: string;
  /** `NitFE`: identification of the party that GENERATES the event. */
  issuer_nit: string;
  /** `DocAdq`: identification of the party that RECEIVES the event. */
  customer_nit: string;
  /** `ID`: prefix + number of the referenced document, e.g. `FE123`. */
  referenced_document_number: string;
  /** `DocumentTypeCode` of the referenced document. Defaults to '01' (FEV). */
  referenced_document_type_code?: string;
  /** Software PIN — an event has no ClTec (Anexo §11.4 rationale). */
  software_pin: string;
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
