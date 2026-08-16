import { createHash } from 'crypto';
import { dianAmount, dianSum } from './dian-money.util';
import { dianPartyId, onlyDigits } from '../../../../common/utils/nit.util';

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
      // El OFE es siempre NIT: su DV se recorta aunque el llamador no declare tipo.
      dianPartyId(params.issuer_nit, params.issuer_document_type ?? '31'),
      dianPartyId(params.customer_nit, params.customer_document_type),
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
   * URL del catálogo de la DIAN donde se consulta el documento, POR AMBIENTE
   * (Anexo Técnico 1.9 §11.7.1).
   *
   * Los dos catálogos son bases distintas. Un documento emitido en habilitación
   * NO existe en el de producción, así que apuntar siempre a producción —como se
   * hacía— produce un QR que no resuelve nada: el adquiriente lo escanea y la
   * DIAN le responde que el documento no existe.
   *
   * @param environment `'1'` = producción, `'2'` = habilitación. Cualquier otro
   *   valor se trata como habilitación, que es el lado seguro: enviar a alguien
   *   al catálogo de pruebas es un error visible; publicar como productivo un
   *   documento de pruebas, no.
   */
  static resolveQrUrl(cufe: string, environment: string | undefined): string {
    const host =
      environment === '1'
        ? 'catalogo-vpfe.dian.gov.co'
        : 'catalogo-vpfe-hab.dian.gov.co';
    return `https://${host}/document/searchqr?documentkey=${cufe}`;
  }

  /**
   * Contenido completo del código QR (Anexo Técnico 1.9 §11.7).
   *
   * El QR **no es la URL**. El anexo fija once líneas —diez campos etiquetados
   * más la URL del catálogo— para que el adquiriente pueda verificar el documento
   * leyendo el propio código, sin conexión, y contrastarlo con la representación
   * gráfica que tiene en la mano. Guardar solo la URL, como se hacía, elimina esa
   * verificación: el QR pasa a ser un enlace y nada más.
   *
   * Los importes reutilizan {@link dianAmount} y las identificaciones
   * {@link dianPartyId} a propósito. Son los MISMOS valores que entran al hash;
   * si el QR los formateara por su cuenta, un documento podría mostrar en su cara
   * visible cifras que no son las que la DIAN validó — que es exactamente la
   * clase de divergencia que este módulo existe para hacer imposible.
   *
   * `ValOtroIm` es la suma de los impuestos que NO son IVA (esquemas ≠ `01`), no
   * un cuarto campo de impuesto: el anexo lo define agregado.
   */
  static buildQrContent(params: QrContentParams): string {
    return [
      `NumFac: ${params.invoice_number}`,
      `FecFac: ${params.issue_date}`,
      `HorFac: ${params.issue_time}`,
      `NitFac: ${dianPartyId(params.issuer_nit, params.issuer_document_type ?? '31')}`,
      `DocAdq: ${dianPartyId(params.customer_nit, params.customer_document_type)}`,
      `ValFac: ${dianAmount(params.total_before_tax)}`,
      `ValIva: ${dianAmount(params.tax_iva)}`,
      `ValOtroIm: ${dianSum([params.tax_inc, params.tax_ica, params.tax_other])}`,
      `ValTolFac: ${dianAmount(params.total_amount)}`,
      `CUFE: ${params.document_key}`,
      CufeCalculator.resolveQrUrl(params.document_key, params.environment),
    ].join('\n');
  }
}

export interface QrContentParams {
  invoice_number: string;
  /** `AAAA-MM-DD` */
  issue_date: string;
  /** `HH:mm:ss-05:00` */
  issue_time: string;
  issuer_nit: string;
  /** Código DIAN del tipo de identificación del emisor. Un OFE siempre es NIT. */
  issuer_document_type?: string | null;
  customer_nit: string;
  /** Código DIAN del tipo de identificación del adquiriente (`'13'` CC, `'31'` NIT…). */
  customer_document_type?: string | null;
  total_before_tax: string;
  tax_iva: string;
  tax_inc?: string;
  tax_ica?: string;
  /** Otros impuestos distintos de IVA/INC/ICA, ya agregados. */
  tax_other?: string;
  total_amount: string;
  /** CUFE, CUDE o CUDS según el tipo de documento. */
  document_key: string;
  /** `'1'` producción, `'2'` habilitación. */
  environment?: string;
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
  /**
   * Código DIAN del tipo de identificación del emisor. Un OFE siempre es NIT
   * (`'31'`), así que omitirlo se interpreta como tal.
   */
  issuer_document_type?: string | null;
  customer_nit: string;
  /**
   * Código DIAN del tipo de identificación del adquiriente (`'13'` CC, `'31'`
   * NIT, `'22'` CE…).
   *
   * Determina si se recorta el dígito de verificación (§11.2 lo exige para el
   * NIT) o si el número pasa íntegro. Omitirlo trata la identificación como
   * NO-NIT y la preserva completa: recortar un dígito a una cédula produce la
   * cédula de otra persona, que es un daño peor que dejar un DV de más.
   */
  customer_document_type?: string | null;
  technical_key: string;
  environment?: string;
}
