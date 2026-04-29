import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import { UblCommonBuilder } from './ubl-common.builder';
import {
  DIAN_DOCUMENT_TYPES,
  DIAN_OPERATION_TYPES,
} from '../constants/dian-document-types';
import {
  DianIssuerData,
  DianCustomerData,
  DianSoftwareSecurity,
} from '../interfaces/dian-config.interface';
import { ProviderInvoiceData } from '../../invoice-provider.interface';

/**
 * Builds UBL 2.1 Debit Note XML documents compliant with DIAN Colombia.
 * Structure mirrors the credit note builder but uses DebitNote root element
 * and includes BillingReference to the original invoice.
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

    // UBL Extensions
    UblCommonBuilder.buildExtensions(doc, software_security);

    // Document metadata
    doc.ele(UBL_NAMESPACES.CBC, 'UBLVersionID').txt(UBL_CONSTANTS.UBL_VERSION);
    doc
      .ele(UBL_NAMESPACES.CBC, 'CustomizationID')
      .txt(UBL_CONSTANTS.CUSTOMIZATION_ID);
    doc.ele(UBL_NAMESPACES.CBC, 'ProfileID').txt(UBL_CONSTANTS.PROFILE_ID);
    doc.ele(UBL_NAMESPACES.CBC, 'ProfileExecutionID').txt(profile_execution_id);
    doc.ele(UBL_NAMESPACES.CBC, 'ID').txt(debit_note_data.invoice_number);
    doc
      .ele(UBL_NAMESPACES.CBC, 'UUID')
      .att('schemeID', environment === 'production' ? '1' : '2')
      .att('schemeName', 'CUDE-SHA384')
      .txt(cude);

    doc.ele(UBL_NAMESPACES.CBC, 'IssueDate').txt(debit_note_data.issue_date);

    const issue_time =
      new Date().toISOString().split('T')[1].split('.')[0] + '-05:00';
    doc.ele(UBL_NAMESPACES.CBC, 'IssueTime').txt(issue_time);

    doc
      .ele(UBL_NAMESPACES.CBC, 'DebitNoteTypeCode')
      .txt(DIAN_DOCUMENT_TYPES.DEBIT_NOTE);

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
    UblCommonBuilder.buildSupplierParty(doc, issuer);
    UblCommonBuilder.buildCustomerParty(doc, customer);

    // Tax totals
    UblCommonBuilder.buildTaxTotals(doc, debit_note_data.taxes, currency);

    // Legal monetary total
    const monetary = doc.ele(UBL_NAMESPACES.CAC, 'LegalMonetaryTotal');
    monetary
      .ele(UBL_NAMESPACES.CBC, 'LineExtensionAmount')
      .att('currencyID', currency)
      .txt(parseFloat(debit_note_data.subtotal_amount).toFixed(2));
    monetary
      .ele(UBL_NAMESPACES.CBC, 'TaxExclusiveAmount')
      .att('currencyID', currency)
      .txt(parseFloat(debit_note_data.subtotal_amount).toFixed(2));
    monetary
      .ele(UBL_NAMESPACES.CBC, 'TaxInclusiveAmount')
      .att('currencyID', currency)
      .txt(
        (
          parseFloat(debit_note_data.subtotal_amount) +
          parseFloat(debit_note_data.tax_amount)
        ).toFixed(2),
      );
    monetary
      .ele(UBL_NAMESPACES.CBC, 'AllowanceTotalAmount')
      .att('currencyID', currency)
      .txt(parseFloat(debit_note_data.discount_amount).toFixed(2));
    monetary
      .ele(UBL_NAMESPACES.CBC, 'PayableAmount')
      .att('currencyID', currency)
      .txt(parseFloat(debit_note_data.total_amount).toFixed(2));

    // Debit note lines (similar to invoice lines but with DebitNoteLine)
    debit_note_data.items.forEach((item, index) => {
      const line = doc.ele(UBL_NAMESPACES.CAC, 'DebitNoteLine');
      line.ele(UBL_NAMESPACES.CBC, 'ID').txt(String(index + 1));
      line
        .ele(UBL_NAMESPACES.CBC, 'DebitedQuantity')
        .att('unitCode', 'EA')
        .txt(item.quantity);
      line
        .ele(UBL_NAMESPACES.CBC, 'LineExtensionAmount')
        .att('currencyID', currency)
        .txt(
          (
            parseFloat(item.quantity) * parseFloat(item.unit_price) -
            parseFloat(item.discount_amount)
          ).toFixed(2),
        );

      const ubl_item = line.ele(UBL_NAMESPACES.CAC, 'Item');
      ubl_item.ele(UBL_NAMESPACES.CBC, 'Description').txt(item.description);

      const price = line.ele(UBL_NAMESPACES.CAC, 'Price');
      price
        .ele(UBL_NAMESPACES.CBC, 'PriceAmount')
        .att('currencyID', currency)
        .txt(parseFloat(item.unit_price).toFixed(2));
      price
        .ele(UBL_NAMESPACES.CBC, 'BaseQuantity')
        .att('unitCode', 'EA')
        .txt('1.00');
    });

    return doc.end({ prettyPrint: true });
  }
}
