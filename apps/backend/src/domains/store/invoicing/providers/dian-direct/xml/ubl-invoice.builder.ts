import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import { UblCommonBuilder } from './ubl-common.builder';
import { DIAN_DOCUMENT_TYPES, DIAN_OPERATION_TYPES } from '../constants/dian-document-types';
import {
  DianIssuerData,
  DianCustomerData,
  DianSoftwareSecurity,
} from '../interfaces/dian-config.interface';
import { ProviderInvoiceData } from '../../invoice-provider.interface';

/**
 * Builds UBL 2.1 Invoice XML documents compliant with DIAN Colombia specifications.
 *
 * The generated XML follows the structure:
 * 1. UBLExtensions (DIAN software security + digital signature placeholder)
 * 2. Document metadata (UBLVersionID, CustomizationID, ProfileID, etc.)
 * 3. Supplier party (emisor)
 * 4. Customer party (adquirente)
 * 5. Payment means and terms
 * 6. Tax totals
 * 7. Legal monetary total
 * 8. Invoice lines
 */
export class UblInvoiceBuilder {
  /**
   * Builds the complete UBL 2.1 Invoice XML string.
   */
  static build(params: {
    invoice_data: ProviderInvoiceData;
    issuer: DianIssuerData;
    customer: DianCustomerData;
    software_security: DianSoftwareSecurity;
    cufe: string;
    environment: 'test' | 'production';
  }): string {
    const {
      invoice_data,
      issuer,
      customer,
      software_security,
      cufe,
      environment,
    } = params;

    const currency = invoice_data.currency || UBL_CONSTANTS.DEFAULT_CURRENCY;
    const profile_execution_id =
      environment === 'production'
        ? UBL_CONSTANTS.PROFILE_EXECUTION_ID_PROD
        : UBL_CONSTANTS.PROFILE_EXECUTION_ID_TEST;

    // Create root Invoice element with namespaces
    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele(UBL_NAMESPACES.INVOICE, 'Invoice')
      .att('xmlns:cac', UBL_NAMESPACES.CAC)
      .att('xmlns:cbc', UBL_NAMESPACES.CBC)
      .att('xmlns:ext', UBL_NAMESPACES.EXT)
      .att('xmlns:sts', UBL_NAMESPACES.STS)
      .att('xmlns:ds', UBL_NAMESPACES.DS)
      .att('xmlns:xades', UBL_NAMESPACES.XADES)
      .att('xmlns:xades141', UBL_NAMESPACES.XADES141);

    // 1. UBL Extensions
    UblCommonBuilder.buildExtensions(doc, software_security);

    // 2. Document metadata
    doc.ele(UBL_NAMESPACES.CBC, 'UBLVersionID').txt(UBL_CONSTANTS.UBL_VERSION);
    doc
      .ele(UBL_NAMESPACES.CBC, 'CustomizationID')
      .txt(UBL_CONSTANTS.CUSTOMIZATION_ID);
    doc
      .ele(UBL_NAMESPACES.CBC, 'ProfileID')
      .txt(UBL_CONSTANTS.PROFILE_ID);
    doc
      .ele(UBL_NAMESPACES.CBC, 'ProfileExecutionID')
      .txt(profile_execution_id);
    doc.ele(UBL_NAMESPACES.CBC, 'ID').txt(invoice_data.invoice_number);
    doc
      .ele(UBL_NAMESPACES.CBC, 'UUID')
      .att('schemeID', environment === 'production' ? '1' : '2')
      .att('schemeName', 'CUFE-SHA384')
      .txt(cufe);

    doc
      .ele(UBL_NAMESPACES.CBC, 'IssueDate')
      .txt(invoice_data.issue_date);

    const issue_time =
      new Date().toISOString().split('T')[1].split('.')[0] + '-05:00';
    doc.ele(UBL_NAMESPACES.CBC, 'IssueTime').txt(issue_time);

    doc
      .ele(UBL_NAMESPACES.CBC, 'InvoiceTypeCode')
      .txt(DIAN_DOCUMENT_TYPES.INVOICE);

    if (invoice_data.notes) {
      doc.ele(UBL_NAMESPACES.CBC, 'Note').txt(invoice_data.notes);
    }

    doc
      .ele(UBL_NAMESPACES.CBC, 'DocumentCurrencyCode')
      .txt(currency);

    doc
      .ele(UBL_NAMESPACES.CBC, 'LineCountNumeric')
      .txt(String(invoice_data.items.length));

    // 3. Invoice period (optional — for recurrent invoicing)
    if (invoice_data.due_date) {
      const period = doc.ele(UBL_NAMESPACES.CAC, 'InvoicePeriod');
      period
        .ele(UBL_NAMESPACES.CBC, 'StartDate')
        .txt(invoice_data.issue_date);
      period
        .ele(UBL_NAMESPACES.CBC, 'EndDate')
        .txt(invoice_data.due_date);
    }

    // 4. Supplier party
    UblCommonBuilder.buildSupplierParty(doc, issuer);

    // 5. Customer party
    UblCommonBuilder.buildCustomerParty(doc, customer);

    // 6. Payment means
    const payment_means = doc.ele(UBL_NAMESPACES.CAC, 'PaymentMeans');
    payment_means
      .ele(UBL_NAMESPACES.CBC, 'ID')
      .txt(invoice_data.payment_form || '1');
    payment_means
      .ele(UBL_NAMESPACES.CBC, 'PaymentMeansCode')
      .txt(invoice_data.payment_means || '10'); // Default: cash
    payment_means
      .ele(UBL_NAMESPACES.CBC, 'PaymentDueDate')
      .txt(invoice_data.due_date || invoice_data.issue_date);

    // 7. Tax totals
    UblCommonBuilder.buildTaxTotals(
      doc,
      invoice_data.taxes,
      currency,
    );

    // 8. Legal monetary total
    const monetary = doc.ele(
      UBL_NAMESPACES.CAC,
      'LegalMonetaryTotal',
    );
    monetary
      .ele(UBL_NAMESPACES.CBC, 'LineExtensionAmount')
      .att('currencyID', currency)
      .txt(parseFloat(invoice_data.subtotal_amount).toFixed(2));
    monetary
      .ele(UBL_NAMESPACES.CBC, 'TaxExclusiveAmount')
      .att('currencyID', currency)
      .txt(parseFloat(invoice_data.subtotal_amount).toFixed(2));
    monetary
      .ele(UBL_NAMESPACES.CBC, 'TaxInclusiveAmount')
      .att('currencyID', currency)
      .txt(
        (
          parseFloat(invoice_data.subtotal_amount) +
          parseFloat(invoice_data.tax_amount)
        ).toFixed(2),
      );
    monetary
      .ele(UBL_NAMESPACES.CBC, 'AllowanceTotalAmount')
      .att('currencyID', currency)
      .txt(parseFloat(invoice_data.discount_amount).toFixed(2));
    monetary
      .ele(UBL_NAMESPACES.CBC, 'PayableAmount')
      .att('currencyID', currency)
      .txt(parseFloat(invoice_data.total_amount).toFixed(2));

    // 9. Invoice lines
    UblCommonBuilder.buildInvoiceLines(
      doc,
      invoice_data.items,
      invoice_data.taxes,
      currency,
    );

    return doc.end({ prettyPrint: true });
  }
}
