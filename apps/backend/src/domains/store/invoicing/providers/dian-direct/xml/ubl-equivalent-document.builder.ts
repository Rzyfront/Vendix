import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import { UblCommonBuilder } from './ubl-common.builder';
import {
  DIAN_DOCUMENT_TYPES,
  DIAN_OPERATION_TYPES,
} from '../constants/dian-document-types';
import {
  DianCustomerData,
  DianInvoiceControl,
  DianIssuerData,
  DianSoftwareSecurity,
} from '../interfaces/dian-config.interface';
import { ProviderInvoiceData } from '../../invoice-provider.interface';
import {
  DEFAULT_STORE_TIMEZONE,
  localTimeString,
} from '../../../../../../common/utils/store-timezone.util';

/**
 * Builds the UBL 2.1 document for the **documento equivalente electrónico del
 * tiquete de máquina registradora con sistema P.O.S.** (Res. 000165/2023, Anexo
 * Técnico de documento equivalente electrónico v1.0).
 *
 * ## Why this is a separate builder and not a flag on `UblInvoiceBuilder`
 *
 * The equivalent document shares UBL's `Invoice` root and every monetary block with
 * the sales invoice, but it is a DIFFERENT fiscal document with its own annex, its
 * own profile, its own type table and — crucially — its own unique code:
 *
 * | | Factura electrónica de venta | Documento equivalente POS |
 * |---|---|---|
 * | `cbc:ProfileID` | `DIAN 2.1: Factura Electrónica de Venta` | `DIAN 2.1: Documento Equivalente POS` |
 * | `cbc:CustomizationID` | `10` Estándar | `10` (único modo de operación, numeral 16.4.1) |
 * | `cbc:InvoiceTypeCode` | `01` | `20` |
 * | `cbc:UUID/@schemeName` | `CUFE-SHA384` | `CUDE-SHA384` |
 * | Key's 14th field | `ClTec` (clave técnica del rango) | **Software-PIN** |
 *
 * Threading those five differences through the invoice builder as flags would make
 * the fiscal document a runtime property of a boolean, and a mistaken flag emits a
 * POS ticket as an invoice (or the reverse) against a numbering range authorized
 * for the other document. The blocks that genuinely coincide come from
 * `UblCommonBuilder`, so nothing is duplicated except the header this table
 * describes.
 *
 * Element order follows UBL's sequence, which is XSD-validated:
 *   UBLExtensions → UBLVersionID → CustomizationID → ProfileID →
 *   ProfileExecutionID → ID → UUID → IssueDate → IssueTime → InvoiceTypeCode →
 *   Note → DocumentCurrencyCode → LineCountNumeric → AccountingSupplierParty →
 *   AccountingCustomerParty → PaymentMeans → AllowanceCharge → TaxTotal →
 *   LegalMonetaryTotal → InvoiceLine
 */
export class UblEquivalentDocumentBuilder {
  static build(params: {
    invoice_data: ProviderInvoiceData;
    issuer: DianIssuerData;
    customer: DianCustomerData;
    software_security: DianSoftwareSecurity;
    /** CUDE of this document — see `CufeCalculator.generateEquivalentDocumentCude`. */
    cude: string;
    environment: 'test' | 'production';
    /** Numbering-resolution control of the DE range (numeral 14.2). */
    control?: DianInvoiceControl;
    /**
     * `cbc:InvoiceTypeCode`. Defaults to '20' (tiquete POS). Present so the
     * adjustment notes ('93' débito, '94' crédito) reuse this builder instead of
     * copying it, which is how the two would drift apart.
     */
    document_type_code?: string;
  }): string {
    const {
      invoice_data,
      issuer,
      customer,
      software_security,
      cude,
      environment,
      control,
      document_type_code,
    } = params;

    const currency = invoice_data.currency || UBL_CONSTANTS.DEFAULT_CURRENCY;
    const profile_execution_id =
      environment === 'production'
        ? UBL_CONSTANTS.PROFILE_EXECUTION_ID_PROD
        : UBL_CONSTANTS.PROFILE_EXECUTION_ID_TEST;

    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele(UBL_NAMESPACES.INVOICE, 'Invoice')
      .att('xmlns:cac', UBL_NAMESPACES.CAC)
      .att('xmlns:cbc', UBL_NAMESPACES.CBC)
      .att('xmlns:ext', UBL_NAMESPACES.EXT)
      .att('xmlns:sts', UBL_NAMESPACES.STS)
      .att('xmlns:ds', UBL_NAMESPACES.DS)
      .att('xmlns:xades', UBL_NAMESPACES.XADES)
      .att('xmlns:xades141', UBL_NAMESPACES.XADES141);

    UblCommonBuilder.buildExtensions(doc, software_security, {
      control,
      issuer_nit: issuer.nit,
      issuer_nit_dv: issuer.nit_dv,
      qr_code: UblCommonBuilder.buildQrUrl(environment, cude),
    });

    doc.ele(UBL_NAMESPACES.CBC, 'UBLVersionID').txt(UBL_CONSTANTS.UBL_VERSION);
    doc
      .ele(UBL_NAMESPACES.CBC, 'CustomizationID')
      .txt(DIAN_OPERATION_TYPES.EQUIVALENT_DOCUMENT_SINGLE_MODE);
    doc
      .ele(UBL_NAMESPACES.CBC, 'ProfileID')
      .txt(UBL_CONSTANTS.PROFILE_ID_POS_EQUIVALENT);
    doc.ele(UBL_NAMESPACES.CBC, 'ProfileExecutionID').txt(profile_execution_id);
    doc.ele(UBL_NAMESPACES.CBC, 'ID').txt(invoice_data.invoice_number);
    // `CUDE-SHA384`, never `CUFE-SHA384`: the algorithm name declares WHICH key the
    // DIAN must recompute, and the two differ in their 14th field.
    doc
      .ele(UBL_NAMESPACES.CBC, 'UUID')
      .att('schemeID', profile_execution_id)
      .att('schemeName', 'CUDE-SHA384')
      .txt(cude);

    doc.ele(UBL_NAMESPACES.CBC, 'IssueDate').txt(invoice_data.issue_date);

    // Same fallback discipline as the invoice builder: derive the time in the
    // issuer's zone rather than labelling a UTC clock `-05:00`, which would name an
    // instant hours away from the one the ticket claims.
    const issue_time =
      invoice_data.issue_time ||
      localTimeString(new Date(), DEFAULT_STORE_TIMEZONE);
    doc.ele(UBL_NAMESPACES.CBC, 'IssueTime').txt(issue_time);

    doc
      .ele(UBL_NAMESPACES.CBC, 'InvoiceTypeCode')
      .txt(document_type_code || DIAN_DOCUMENT_TYPES.POS_EQUIVALENT_DOCUMENT);

    if (invoice_data.notes) {
      doc.ele(UBL_NAMESPACES.CBC, 'Note').txt(invoice_data.notes);
    }

    doc.ele(UBL_NAMESPACES.CBC, 'DocumentCurrencyCode').txt(currency);
    doc
      .ele(UBL_NAMESPACES.CBC, 'LineCountNumeric')
      .txt(String(invoice_data.items.length));

    UblCommonBuilder.buildSupplierParty(doc, issuer);
    UblCommonBuilder.buildCustomerParty(doc, customer);

    // A POS ticket is paid on the spot, so `PaymentDueDate` is the issue date
    // unless the caller says otherwise — an equivalent document does not carry
    // credit terms the way an invoice does.
    const payment_means = doc.ele(UBL_NAMESPACES.CAC, 'PaymentMeans');
    payment_means
      .ele(UBL_NAMESPACES.CBC, 'ID')
      .txt(invoice_data.payment_form || '1');
    payment_means
      .ele(UBL_NAMESPACES.CBC, 'PaymentMeansCode')
      .txt(invoice_data.payment_means || '10');
    payment_means
      .ele(UBL_NAMESPACES.CBC, 'PaymentDueDate')
      .txt(invoice_data.due_date || invoice_data.issue_date);

    UblCommonBuilder.buildDocumentAllowanceCharge(doc, invoice_data, currency);
    UblCommonBuilder.buildTaxTotals(doc, invoice_data.taxes, currency);
    UblCommonBuilder.buildLegalMonetaryTotal(doc, invoice_data, currency);
    UblCommonBuilder.buildInvoiceLines(
      doc,
      invoice_data.items,
      invoice_data.taxes,
      currency,
    );

    return doc.end({ prettyPrint: true });
  }
}
