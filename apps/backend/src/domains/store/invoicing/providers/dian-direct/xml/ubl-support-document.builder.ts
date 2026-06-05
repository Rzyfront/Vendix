import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import { UblCommonBuilder } from './ubl-common.builder';
import {
  DIAN_DOCUMENT_TYPES,
  DIAN_OPERATION_TYPES,
} from '../constants/dian-document-types';
import {
  DianCustomerData,
  DianIssuerData,
  DianSoftwareSecurity,
} from '../interfaces/dian-config.interface';
import { ProviderInvoiceData } from '../../invoice-provider.interface';

const SUPPORT_DOCUMENT_PROFILE_ID =
  'DIAN 2.1: Documento Soporte en adquisiciones efectuadas a sujetos no obligados a expedir factura de venta o documento equivalente';

export class UblSupportDocumentBuilder {
  static buildDocument(params: {
    support_document_data: ProviderInvoiceData;
    buyer: DianIssuerData;
    seller: DianCustomerData;
    software_security: DianSoftwareSecurity;
    cuds: string;
    environment: 'test' | 'production';
  }): string {
    const {
      support_document_data,
      buyer,
      seller,
      software_security,
      cuds,
      environment,
    } = params;
    const currency =
      support_document_data.currency || UBL_CONSTANTS.DEFAULT_CURRENCY;
    const doc = UblSupportDocumentBuilder.createRoot('Invoice');

    UblSupportDocumentBuilder.buildSharedMetadata(doc, {
      data: support_document_data,
      software_security,
      cuds,
      environment,
      document_type_code: DIAN_DOCUMENT_TYPES.SUPPORT_DOCUMENT,
      document_type_element: 'InvoiceTypeCode',
    });

    if (support_document_data.due_date) {
      doc
        .ele(UBL_NAMESPACES.CBC, 'DueDate')
        .txt(support_document_data.due_date);
    }

    UblCommonBuilder.buildSupplierParty(
      doc,
      UblSupportDocumentBuilder.sellerAsSupplier(seller, buyer),
    );
    UblCommonBuilder.buildCustomerParty(
      doc,
      UblSupportDocumentBuilder.buyerAsCustomer(buyer),
    );
    UblSupportDocumentBuilder.buildPaymentMeans(doc, support_document_data);
    UblCommonBuilder.buildTaxTotals(doc, support_document_data.taxes, currency);
    UblSupportDocumentBuilder.buildLegalMonetaryTotal(
      doc,
      support_document_data,
      currency,
    );
    UblCommonBuilder.buildInvoiceLines(
      doc,
      support_document_data.items,
      support_document_data.taxes,
      currency,
    );

    return doc.end({ prettyPrint: true });
  }

  static buildAdjustmentNote(params: {
    support_adjustment_data: ProviderInvoiceData;
    buyer: DianIssuerData;
    seller: DianCustomerData;
    software_security: DianSoftwareSecurity;
    cuds: string;
    environment: 'test' | 'production';
    original_support_document_number?: string;
    original_support_document_cuds?: string;
    original_support_document_date?: string;
  }): string {
    const {
      support_adjustment_data,
      buyer,
      seller,
      software_security,
      cuds,
      environment,
      original_support_document_number,
      original_support_document_cuds,
      original_support_document_date,
    } = params;
    const currency =
      support_adjustment_data.currency || UBL_CONSTANTS.DEFAULT_CURRENCY;
    const doc = UblSupportDocumentBuilder.createRoot('CreditNote');

    UblSupportDocumentBuilder.buildSharedMetadata(doc, {
      data: support_adjustment_data,
      software_security,
      cuds,
      environment,
      document_type_code: DIAN_DOCUMENT_TYPES.SUPPORT_ADJUSTMENT_NOTE,
      document_type_element: 'CreditNoteTypeCode',
    });

    const discrepancy = doc.ele(UBL_NAMESPACES.CAC, 'DiscrepancyResponse');
    discrepancy
      .ele(UBL_NAMESPACES.CBC, 'ReferenceID')
      .txt(original_support_document_number || '');
    discrepancy.ele(UBL_NAMESPACES.CBC, 'ResponseCode').txt('5');
    discrepancy
      .ele(UBL_NAMESPACES.CBC, 'Description')
      .txt(support_adjustment_data.notes || 'Nota de ajuste documento soporte');

    if (original_support_document_number) {
      const billing_ref = doc.ele(UBL_NAMESPACES.CAC, 'BillingReference');
      const invoice_ref = billing_ref.ele(
        UBL_NAMESPACES.CAC,
        'InvoiceDocumentReference',
      );
      invoice_ref
        .ele(UBL_NAMESPACES.CBC, 'ID')
        .txt(original_support_document_number);
      if (original_support_document_cuds) {
        invoice_ref
          .ele(UBL_NAMESPACES.CBC, 'UUID')
          .att('schemeName', 'CUDS-SHA384')
          .txt(original_support_document_cuds);
      }
      if (original_support_document_date) {
        invoice_ref
          .ele(UBL_NAMESPACES.CBC, 'IssueDate')
          .txt(original_support_document_date);
      }
    }

    UblCommonBuilder.buildSupplierParty(
      doc,
      UblSupportDocumentBuilder.sellerAsSupplier(seller, buyer),
    );
    UblCommonBuilder.buildCustomerParty(
      doc,
      UblSupportDocumentBuilder.buyerAsCustomer(buyer),
    );
    UblCommonBuilder.buildTaxTotals(
      doc,
      support_adjustment_data.taxes,
      currency,
    );
    UblSupportDocumentBuilder.buildLegalMonetaryTotal(
      doc,
      support_adjustment_data,
      currency,
    );
    UblSupportDocumentBuilder.buildCreditNoteLines(
      doc,
      support_adjustment_data,
      currency,
    );

    return doc.end({ prettyPrint: true });
  }

  private static createRoot(root: 'Invoice' | 'CreditNote') {
    const namespace =
      root === 'Invoice' ? UBL_NAMESPACES.INVOICE : UBL_NAMESPACES.CREDIT_NOTE;

    return create({ version: '1.0', encoding: 'UTF-8' })
      .ele(namespace, root)
      .att('xmlns:cac', UBL_NAMESPACES.CAC)
      .att('xmlns:cbc', UBL_NAMESPACES.CBC)
      .att('xmlns:ext', UBL_NAMESPACES.EXT)
      .att('xmlns:sts', UBL_NAMESPACES.STS)
      .att('xmlns:ds', UBL_NAMESPACES.DS)
      .att('xmlns:xades', UBL_NAMESPACES.XADES)
      .att('xmlns:xades141', UBL_NAMESPACES.XADES141);
  }

  private static buildSharedMetadata(
    doc: any,
    params: {
      data: ProviderInvoiceData;
      software_security: DianSoftwareSecurity;
      cuds: string;
      environment: 'test' | 'production';
      document_type_code: string;
      document_type_element: 'InvoiceTypeCode' | 'CreditNoteTypeCode';
    },
  ): void {
    const {
      data,
      software_security,
      cuds,
      environment,
      document_type_code,
      document_type_element,
    } = params;
    const profile_execution_id =
      environment === 'production'
        ? UBL_CONSTANTS.PROFILE_EXECUTION_ID_PROD
        : UBL_CONSTANTS.PROFILE_EXECUTION_ID_TEST;

    UblCommonBuilder.buildExtensions(doc, software_security);
    doc.ele(UBL_NAMESPACES.CBC, 'UBLVersionID').txt(UBL_CONSTANTS.UBL_VERSION);
    doc
      .ele(UBL_NAMESPACES.CBC, 'CustomizationID')
      .txt(DIAN_OPERATION_TYPES.SUPPORT_DOCUMENT_RESIDENT_SELLER);
    doc.ele(UBL_NAMESPACES.CBC, 'ProfileID').txt(SUPPORT_DOCUMENT_PROFILE_ID);
    doc.ele(UBL_NAMESPACES.CBC, 'ProfileExecutionID').txt(profile_execution_id);
    doc.ele(UBL_NAMESPACES.CBC, 'ID').txt(data.invoice_number);
    doc
      .ele(UBL_NAMESPACES.CBC, 'UUID')
      .att('schemeID', environment === 'production' ? '1' : '2')
      .att('schemeName', 'CUDS-SHA384')
      .txt(cuds);
    doc.ele(UBL_NAMESPACES.CBC, 'IssueDate').txt(data.issue_date);
    doc
      .ele(UBL_NAMESPACES.CBC, 'IssueTime')
      .txt(data.issue_time || UblSupportDocumentBuilder.defaultIssueTime());
    doc.ele(UBL_NAMESPACES.CBC, document_type_element).txt(document_type_code);
    if (data.notes) {
      doc.ele(UBL_NAMESPACES.CBC, 'Note').txt(data.notes);
    }
    doc
      .ele(UBL_NAMESPACES.CBC, 'DocumentCurrencyCode')
      .txt(data.currency || UBL_CONSTANTS.DEFAULT_CURRENCY);
    doc
      .ele(UBL_NAMESPACES.CBC, 'LineCountNumeric')
      .txt(String(data.items.length));
  }

  private static sellerAsSupplier(
    seller: DianCustomerData,
    buyer: DianIssuerData,
  ): DianIssuerData {
    return {
      document_type: seller.document_type,
      nit: seller.document_number,
      nit_dv: seller.document_dv || '',
      legal_name: seller.legal_name,
      trade_name: seller.trade_name,
      address_line: seller.address_line || buyer.address_line,
      city_code: seller.city_code || buyer.city_code,
      city_name: seller.city_name || buyer.city_name,
      department_code: seller.department_code || buyer.department_code,
      department_name: seller.department_name || buyer.department_name,
      country_code: seller.country_code || buyer.country_code,
      postal_code: seller.postal_code || buyer.postal_code,
      phone: seller.phone,
      email: seller.email || buyer.email,
      tax_regime: seller.tax_regime || '2',
      tax_scheme: seller.tax_responsibilities?.[0] || 'R-99-PN',
    };
  }

  private static buyerAsCustomer(buyer: DianIssuerData): DianCustomerData {
    return {
      document_type: buyer.document_type || '31',
      document_number: buyer.nit,
      document_dv: buyer.nit_dv,
      legal_name: buyer.legal_name,
      trade_name: buyer.trade_name,
      address_line: buyer.address_line,
      city_code: buyer.city_code,
      city_name: buyer.city_name,
      department_code: buyer.department_code,
      department_name: buyer.department_name,
      country_code: buyer.country_code,
      postal_code: buyer.postal_code,
      phone: buyer.phone,
      email: buyer.email,
      tax_regime: buyer.tax_regime,
      tax_responsibilities: [buyer.tax_scheme],
    };
  }

  private static buildPaymentMeans(doc: any, data: ProviderInvoiceData): void {
    const payment_means = doc.ele(UBL_NAMESPACES.CAC, 'PaymentMeans');
    payment_means.ele(UBL_NAMESPACES.CBC, 'ID').txt(data.payment_form || '1');
    payment_means
      .ele(UBL_NAMESPACES.CBC, 'PaymentMeansCode')
      .txt(data.payment_means || '10');
    payment_means
      .ele(UBL_NAMESPACES.CBC, 'PaymentDueDate')
      .txt(data.due_date || data.issue_date);
  }

  private static buildLegalMonetaryTotal(
    doc: any,
    data: ProviderInvoiceData,
    currency: string,
  ): void {
    const monetary = doc.ele(UBL_NAMESPACES.CAC, 'LegalMonetaryTotal');
    monetary
      .ele(UBL_NAMESPACES.CBC, 'LineExtensionAmount')
      .att('currencyID', currency)
      .txt(parseFloat(data.subtotal_amount).toFixed(2));
    monetary
      .ele(UBL_NAMESPACES.CBC, 'TaxExclusiveAmount')
      .att('currencyID', currency)
      .txt(parseFloat(data.subtotal_amount).toFixed(2));
    monetary
      .ele(UBL_NAMESPACES.CBC, 'TaxInclusiveAmount')
      .att('currencyID', currency)
      .txt(
        (
          parseFloat(data.subtotal_amount) + parseFloat(data.tax_amount)
        ).toFixed(2),
      );
    monetary
      .ele(UBL_NAMESPACES.CBC, 'AllowanceTotalAmount')
      .att('currencyID', currency)
      .txt(parseFloat(data.discount_amount).toFixed(2));
    monetary
      .ele(UBL_NAMESPACES.CBC, 'PayableAmount')
      .att('currencyID', currency)
      .txt(parseFloat(data.total_amount).toFixed(2));
  }

  private static buildCreditNoteLines(
    doc: any,
    data: ProviderInvoiceData,
    currency: string,
  ): void {
    data.items.forEach((item, index) => {
      const line = doc.ele(UBL_NAMESPACES.CAC, 'CreditNoteLine');
      line.ele(UBL_NAMESPACES.CBC, 'ID').txt(String(index + 1));
      line
        .ele(UBL_NAMESPACES.CBC, 'CreditedQuantity')
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
  }

  private static defaultIssueTime(): string {
    return new Date().toISOString().split('T')[1].split('.')[0] + '-05:00';
  }
}
