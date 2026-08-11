import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import { UblCommonBuilder } from './ubl-common.builder';
// `DIAN_DOCUMENT_TYPES` is deliberately NOT imported: the debit note's type is
// published through `cbc:CustomizationID` (operation type 30/32), never through
// a `DebitNoteTypeCode` element — see the note where that element used to be.
import { DIAN_OPERATION_TYPES } from '../constants/dian-document-types';
import {
  DianIssuerData,
  DianCustomerData,
  DianSoftwareSecurity,
  DianInvoiceControl,
} from '../interfaces/dian-config.interface';
import { ProviderInvoiceData } from '../../invoice-provider.interface';
import {
  DEFAULT_STORE_TIMEZONE,
  localTimeString,
} from '../../../../../../common/utils/store-timezone.util';

/**
 * Builds UBL 2.1 Debit Note XML documents compliant with DIAN Colombia.
 *
 * THE DEBIT NOTE IS NOT A MIRROR OF THE CREDIT NOTE. This file used to say it
 * was, and treating the two as the same shape with a renamed root cost the
 * habilitación set all 10 of its debit notes. UBL 2.1 gives the `DebitNote` its
 * own sequence, and it differs from `CreditNote` in two places that both matter:
 *
 *   - it defines NO `cbc:DebitNoteTypeCode`, while `CreditNote` does define
 *     `cbc:CreditNoteTypeCode` (rejection ZB01)
 *   - its totals group is `cac:RequestedMonetaryTotal`, while every other
 *     document uses `cac:LegalMonetaryTotal` (rejections DAD06, DAU02/04/06)
 *
 * What the two notes DO share is the parts this builder delegates to
 * `UblCommonBuilder`: extensions, parties, payment means, tax totals, the
 * monetary arithmetic and the line body. Share the bodies, never the sequence.
 */
export class UblDebitNoteBuilder {
  static build(params: {
    debit_note_data: ProviderInvoiceData;
    issuer: DianIssuerData;
    customer: DianCustomerData;
    software_security: DianSoftwareSecurity;
    cude: string;
    environment: 'test' | 'production';
    /** The original invoice number being debited */
    original_invoice_number?: string;
    /** The original invoice CUFE */
    original_invoice_cufe?: string;
    /** The original invoice issue date */
    original_invoice_date?: string;
    /** Numbering-resolution control for sts:DianExtensions/InvoiceControl. */
    control?: DianInvoiceControl;
  }): string {
    const {
      debit_note_data,
      issuer,
      customer,
      software_security,
      cude,
      environment,
      original_invoice_number,
      original_invoice_cufe,
      original_invoice_date,
      control,
    } = params;

    const currency = debit_note_data.currency || UBL_CONSTANTS.DEFAULT_CURRENCY;
    const profile_execution_id =
      environment === 'production'
        ? UBL_CONSTANTS.PROFILE_EXECUTION_ID_PROD
        : UBL_CONSTANTS.PROFILE_EXECUTION_ID_TEST;

    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele(UBL_NAMESPACES.DEBIT_NOTE, 'DebitNote')
      .att('xmlns:cac', UBL_NAMESPACES.CAC)
      .att('xmlns:cbc', UBL_NAMESPACES.CBC)
      .att('xmlns:ext', UBL_NAMESPACES.EXT)
      .att('xmlns:sts', UBL_NAMESPACES.STS)
      .att('xmlns:ds', UBL_NAMESPACES.DS)
      .att('xmlns:xades', UBL_NAMESPACES.XADES)
      .att('xmlns:xades141', UBL_NAMESPACES.XADES141);

    // UBL Extensions (DIAN software security + invoice control + QR)
    UblCommonBuilder.buildExtensions(doc, software_security, {
      control,
      issuer_nit: issuer.nit,
      issuer_nit_dv: issuer.nit_dv,
      qr_code: UblCommonBuilder.buildQrUrl(environment, cude),
    });

    // Document metadata. CustomizationID = tipo de operación de la nota débito:
    // '30' cuando referencia una factura electrónica, '32' sin referencia.
    doc.ele(UBL_NAMESPACES.CBC, 'UBLVersionID').txt(UBL_CONSTANTS.UBL_VERSION);
    doc
      .ele(UBL_NAMESPACES.CBC, 'CustomizationID')
      .txt(
        original_invoice_number
          ? DIAN_OPERATION_TYPES.DEBIT_NOTE_WITH_REF
          : DIAN_OPERATION_TYPES.DEBIT_NOTE_NO_REF,
      );
    // DEUDA CONOCIDA: la DIAN observa esto con DAD03 y espera
    // `UBL_CONSTANTS.PROFILE_ID_DEBIT_NOTE`. Es NOTIFICACIÓN, no rechazo — ver la
    // misma nota en la nota crédito y el literal en `xml-namespaces.ts`.
    doc.ele(UBL_NAMESPACES.CBC, 'ProfileID').txt(UBL_CONSTANTS.PROFILE_ID);
    doc.ele(UBL_NAMESPACES.CBC, 'ProfileExecutionID').txt(profile_execution_id);
    doc.ele(UBL_NAMESPACES.CBC, 'ID').txt(debit_note_data.invoice_number);
    doc
      .ele(UBL_NAMESPACES.CBC, 'UUID')
      .att('schemeID', environment === 'production' ? '1' : '2')
      .att('schemeName', 'CUDE-SHA384')
      .txt(cude);

    doc.ele(UBL_NAMESPACES.CBC, 'IssueDate').txt(debit_note_data.issue_date);

    // Fallback only — see UblInvoiceBuilder: the offset must be derived, never
    // concatenated to a UTC clock.
    const issue_time =
      debit_note_data.issue_time ||
      localTimeString(new Date(), DEFAULT_STORE_TIMEZONE);
    doc.ele(UBL_NAMESPACES.CBC, 'IssueTime').txt(issue_time);

    // NO `cbc:DebitNoteTypeCode` HERE — AND NOWHERE ELSE.
    //
    // UBL 2.1 does not define that element in the `DebitNote` sequence. The
    // `CreditNote` DOES define `cbc:CreditNoteTypeCode`, so the two notes are
    // NOT mirror images; assuming they were is what put it here. Emitting it
    // failed schema validation before the DIAN read anything else:
    //
    //   ZB01  «Fallo en el esquema XML del archivo» — reported on all 10 debit
    //         notes of the habilitación set, naming this element and listing
    //         what the sequence does accept in this position (`Note`,
    //         `TaxPointDate`, `DocumentCurrencyCode`, …).
    //
    // The document type '92' it used to publish is already carried by
    // `cbc:CustomizationID` above (operation type 30/32), which is where the
    // DIAN reads it for a note. Nothing is lost by its absence.
    if (debit_note_data.notes) {
      doc.ele(UBL_NAMESPACES.CBC, 'Note').txt(debit_note_data.notes);
    }

    doc.ele(UBL_NAMESPACES.CBC, 'DocumentCurrencyCode').txt(currency);

    doc
      .ele(UBL_NAMESPACES.CBC, 'LineCountNumeric')
      .txt(String(debit_note_data.items.length));

    // Discrepancy response (reason for debit note)
    const discrepancy = doc.ele(UBL_NAMESPACES.CAC, 'DiscrepancyResponse');
    discrepancy
      .ele(UBL_NAMESPACES.CBC, 'ReferenceID')
      .txt(original_invoice_number || '');
    discrepancy.ele(UBL_NAMESPACES.CBC, 'ResponseCode').txt('2'); // 1=Intereses, 2=Gastos por cobrar, 3=Cambio del valor, 4=Otros
    discrepancy
      .ele(UBL_NAMESPACES.CBC, 'Description')
      .txt(debit_note_data.notes || 'Nota débito');

    // Billing reference (to the original invoice)
    if (original_invoice_number) {
      const billing_ref = doc.ele(UBL_NAMESPACES.CAC, 'BillingReference');
      const invoice_ref = billing_ref.ele(
        UBL_NAMESPACES.CAC,
        'InvoiceDocumentReference',
      );
      invoice_ref.ele(UBL_NAMESPACES.CBC, 'ID').txt(original_invoice_number);
      if (original_invoice_cufe) {
        invoice_ref
          .ele(UBL_NAMESPACES.CBC, 'UUID')
          .att('schemeName', 'CUFE-SHA384')
          .txt(original_invoice_cufe);
      }
      if (original_invoice_date) {
        invoice_ref
          .ele(UBL_NAMESPACES.CBC, 'IssueDate')
          .txt(original_invoice_date);
      }
    }

    // Parties
    UblCommonBuilder.buildSupplierParty(doc, issuer, control?.prefix);
    UblCommonBuilder.buildCustomerParty(doc, customer);

    // Payment means — mandatory group `1..N` (rule DAN01, «Rechazo si grupo no
    // informado»). Goes here because UBL fixes the order
    // `DeliveryTerms → PaymentMeans → PaymentTerms → TaxTotal → monetary total`.
    UblCommonBuilder.buildPaymentMeans(doc, debit_note_data);

    // Tax totals
    UblCommonBuilder.buildTaxTotals(doc, debit_note_data.taxes, currency);

    // `cac:RequestedMonetaryTotal`, NOT `cac:LegalMonetaryTotal`: UBL names the
    // debit note's total group differently from every other document, and the
    // DIAN reads the CUDE's ValFac/ValTot plus its three arithmetic rules
    // through that exact path (DAU01, 1..1). See `buildMonetaryTotal`.
    UblCommonBuilder.buildRequestedMonetaryTotal(
      doc,
      debit_note_data,
      currency,
    );

    // `cac:DebitNoteLine` comparte cuerpo con `cac:InvoiceLine` — ver el mismo
    // comentario en la nota crédito. Sin delegar, la línea salía sin
    // `cac:TaxTotal` propio (regla DAS01b).
    UblCommonBuilder.buildDocumentLines(
      doc,
      debit_note_data.items,
      debit_note_data.taxes,
      currency,
      { line_element: 'DebitNoteLine', quantity_element: 'DebitedQuantity' },
    );

    return doc.end({ prettyPrint: true });
  }
}
