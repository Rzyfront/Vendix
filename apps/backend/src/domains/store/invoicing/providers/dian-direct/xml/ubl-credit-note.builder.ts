import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import { UblCommonBuilder } from './ubl-common.builder';
import {
  dianAmount,
  dianLineExtension,
} from '../../../utils/dian-money.util';
import {
  DIAN_DOCUMENT_TYPES,
  DIAN_OPERATION_TYPES,
} from '../constants/dian-document-types';
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
 * Builds UBL 2.1 Credit Note XML documents compliant with DIAN Colombia.
 * Structure mirrors the invoice builder but uses CreditNote root element
 * and includes BillingReference to the original invoice.
 */
export class UblCreditNoteBuilder {
  static build(params: {
    credit_note_data: ProviderInvoiceData;
    issuer: DianIssuerData;
    customer: DianCustomerData;
    software_security: DianSoftwareSecurity;
    cude: string;
    environment: 'test' | 'production';
    /** The original invoice number being credited */
    original_invoice_number?: string;
    /** The original invoice CUFE */
    original_invoice_cufe?: string;
    /** The original invoice issue date */
    original_invoice_date?: string;
    /** Numbering-resolution control for sts:DianExtensions/InvoiceControl. */
    control?: DianInvoiceControl;
  }): string {
    const {
      credit_note_data,
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

    const currency =
      credit_note_data.currency || UBL_CONSTANTS.DEFAULT_CURRENCY;
    const profile_execution_id =
      environment === 'production'
        ? UBL_CONSTANTS.PROFILE_EXECUTION_ID_PROD
        : UBL_CONSTANTS.PROFILE_EXECUTION_ID_TEST;

    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele(UBL_NAMESPACES.CREDIT_NOTE, 'CreditNote')
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

    // Document metadata. CustomizationID = tipo de operación de la nota crédito:
    // '20' cuando referencia una factura electrónica, '22' sin referencia.
    doc.ele(UBL_NAMESPACES.CBC, 'UBLVersionID').txt(UBL_CONSTANTS.UBL_VERSION);
    doc
      .ele(UBL_NAMESPACES.CBC, 'CustomizationID')
      .txt(
        original_invoice_number
          ? DIAN_OPERATION_TYPES.CREDIT_NOTE_WITH_REF
          : DIAN_OPERATION_TYPES.CREDIT_NOTE_NO_REF,
      );
    doc.ele(UBL_NAMESPACES.CBC, 'ProfileID').txt(UBL_CONSTANTS.PROFILE_ID);
    doc.ele(UBL_NAMESPACES.CBC, 'ProfileExecutionID').txt(profile_execution_id);
    doc.ele(UBL_NAMESPACES.CBC, 'ID').txt(credit_note_data.invoice_number);
    doc
      .ele(UBL_NAMESPACES.CBC, 'UUID')
      .att('schemeID', environment === 'production' ? '1' : '2')
      .att('schemeName', 'CUDE-SHA384')
      .txt(cude);

    doc.ele(UBL_NAMESPACES.CBC, 'IssueDate').txt(credit_note_data.issue_date);

    // Fallback only — see UblInvoiceBuilder: the offset must be derived, never
    // concatenated to a UTC clock.
    const issue_time =
      credit_note_data.issue_time ||
      localTimeString(new Date(), DEFAULT_STORE_TIMEZONE);
    doc.ele(UBL_NAMESPACES.CBC, 'IssueTime').txt(issue_time);

    doc
      .ele(UBL_NAMESPACES.CBC, 'CreditNoteTypeCode')
      .txt(DIAN_DOCUMENT_TYPES.CREDIT_NOTE);

    if (credit_note_data.notes) {
      doc.ele(UBL_NAMESPACES.CBC, 'Note').txt(credit_note_data.notes);
    }

    doc.ele(UBL_NAMESPACES.CBC, 'DocumentCurrencyCode').txt(currency);

    doc
      .ele(UBL_NAMESPACES.CBC, 'LineCountNumeric')
      .txt(String(credit_note_data.items.length));

    // Discrepancy response (reason for credit note)
    const discrepancy = doc.ele(UBL_NAMESPACES.CAC, 'DiscrepancyResponse');
    discrepancy
      .ele(UBL_NAMESPACES.CBC, 'ReferenceID')
      .txt(original_invoice_number || '');
    discrepancy.ele(UBL_NAMESPACES.CBC, 'ResponseCode').txt('2'); // 1=Devolución, 2=Anulación, 3=Rebaja, 4=Ajuste, 5=Otros
    discrepancy
      .ele(UBL_NAMESPACES.CBC, 'Description')
      .txt(credit_note_data.notes || 'Nota crédito');

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
    UblCommonBuilder.buildSupplierParty(doc, issuer);
    UblCommonBuilder.buildCustomerParty(doc, customer);

    // Tax totals
    UblCommonBuilder.buildTaxTotals(doc, credit_note_data.taxes, currency);

    // Legal monetary total
    UblCommonBuilder.buildLegalMonetaryTotal(doc, credit_note_data, currency);

    // Credit note lines (similar to invoice lines but with CreditNoteLine)
    credit_note_data.items.forEach((item, index) => {
      const line = doc.ele(UBL_NAMESPACES.CAC, 'CreditNoteLine');
      line.ele(UBL_NAMESPACES.CBC, 'ID').txt(String(index + 1));
      line
        .ele(UBL_NAMESPACES.CBC, 'CreditedQuantity')
        .att('unitCode', 'EA')
        .txt(item.quantity);
      line
        .ele(UBL_NAMESPACES.CBC, 'LineExtensionAmount')
        .att('currencyID', currency)
        .txt(dianLineExtension(item));

      const ubl_item = line.ele(UBL_NAMESPACES.CAC, 'Item');
      ubl_item.ele(UBL_NAMESPACES.CBC, 'Description').txt(item.description);

      const price = line.ele(UBL_NAMESPACES.CAC, 'Price');
      price
        .ele(UBL_NAMESPACES.CBC, 'PriceAmount')
        .att('currencyID', currency)
        .txt(dianAmount(item.unit_price));
      price
        .ele(UBL_NAMESPACES.CBC, 'BaseQuantity')
        .att('unitCode', 'EA')
        .txt('1.00');
    });

    return doc.end({ prettyPrint: true });
  }
}
