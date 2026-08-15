import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import {
  UblCommonBuilder,
  DianDocumentExtras,
  UblDocumentLine,
} from './ubl-common.builder';
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
 * Builds UBL 2.1 Invoice XML documents compliant with DIAN Colombia specifications.
 *
 * The generated XML follows the structure:
 * 1. UBLExtensions (DIAN software security + digital signature placeholder)
 * 2. Document metadata (UBLVersionID, CustomizationID, ProfileID, etc.)
 * 3. Supplier party (emisor)
 * 4. Customer party (adquirente)
 * 5. Payment means and terms
 * 6. Document allowance charge
 * 7. Payment exchange rate (divisa — el documento sigue en COP)
 * 8. Tax totals
 * 9. Withholding tax total (NO resta de PayableAmount, §11.9.1)
 * 10. Legal monetary total
 * 11. Invoice lines
 */
export class UblInvoiceBuilder {
  /**
   * Builds the complete UBL 2.1 Invoice XML string.
   */
  static build(params: {
    /**
     * `DianDocumentExtras` amplía el contrato con lo que la Fase 6 necesita
     * declarar —tipo de operación, tasa de cambio y retenciones—. Todos sus
     * campos son opcionales, así que un `ProviderInvoiceData` pelado sigue
     * siendo asignable y los llamadores que no los pueblan compilan y emiten
     * exactamente igual que antes.
     */
    invoice_data: ProviderInvoiceData & DianDocumentExtras;
    issuer: DianIssuerData;
    customer: DianCustomerData;
    software_security: DianSoftwareSecurity;
    cufe: string;
    environment: 'test' | 'production';
    /**
     * Numbering-resolution control (InvoiceAuthorization, period, range) for
     * the sts:DianExtensions/InvoiceControl block. Optional so existing callers
     * compile; the orchestrator populates it from the invoice_resolutions row.
     */
    control?: DianInvoiceControl;
    /**
     * `cbc:InvoiceTypeCode`. Defaults to `'01'` (factura nacional). Callers pass
     * `'04'` when the document is expedited under DIAN contingency (Anexo §12.2)
     * and `'03'` when transcribing a paper contingency invoice (§12.1). It used to
     * be hardcoded to `'01'`, which made contingency unrepresentable.
     */
    invoice_type_code?: string;
  }): string {
    const {
      invoice_data,
      issuer,
      customer,
      software_security,
      cufe,
      environment,
      control,
      invoice_type_code,
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

    // 1. UBL Extensions (DIAN software security + invoice control + QR)
    UblCommonBuilder.buildExtensions(doc, software_security, {
      control,
      issuer_nit: issuer.nit,
      issuer_nit_dv: issuer.nit_dv,
      qr_code: UblCommonBuilder.buildQrUrl(environment, cufe),
    });

    // 2. Document metadata. CustomizationID = tipo de operación; '10' = Estándar
    //    (factura electrónica de venta nacional).
    //
    //    Estaba CABLEADO a '10', así que un contrato AIU salía declarado como
    //    operación estándar y la DIAN no aplicaba las reglas CAV/CAX del AIU:
    //    el documento entraba, pero con una base gravable que nadie validaba.
    //    `operation_type` lo trae la factura (`invoices.operation_type`, nulo
    //    ≡ estándar), y el nulo se mapea aquí para no obligar a los llamadores
    //    históricos a poblarlo.
    doc.ele(UBL_NAMESPACES.CBC, 'UBLVersionID').txt(UBL_CONSTANTS.UBL_VERSION);
    doc
      .ele(UBL_NAMESPACES.CBC, 'CustomizationID')
      .txt(
        (invoice_data.operation_type || '').trim() ||
          DIAN_OPERATION_TYPES.STANDARD_INVOICE,
      );
    doc.ele(UBL_NAMESPACES.CBC, 'ProfileID').txt(UBL_CONSTANTS.PROFILE_ID);
    doc.ele(UBL_NAMESPACES.CBC, 'ProfileExecutionID').txt(profile_execution_id);
    doc.ele(UBL_NAMESPACES.CBC, 'ID').txt(invoice_data.invoice_number);
    doc
      .ele(UBL_NAMESPACES.CBC, 'UUID')
      .att('schemeID', environment === 'production' ? '1' : '2')
      .att('schemeName', 'CUFE-SHA384')
      .txt(cufe);

    doc.ele(UBL_NAMESPACES.CBC, 'IssueDate').txt(invoice_data.issue_date);

    // Fallback only: the caller normally supplies issue_time already resolved in
    // the issuer's zone. Deriving it here (instead of labelling a UTC clock
    // `-05:00`) keeps the fallback from declaring an instant hours in the future.
    const issue_time =
      invoice_data.issue_time ||
      localTimeString(new Date(), DEFAULT_STORE_TIMEZONE);
    doc.ele(UBL_NAMESPACES.CBC, 'IssueTime').txt(issue_time);

    doc
      .ele(UBL_NAMESPACES.CBC, 'InvoiceTypeCode')
      .txt(invoice_type_code || DIAN_DOCUMENT_TYPES.INVOICE);

    if (invoice_data.notes) {
      doc.ele(UBL_NAMESPACES.CBC, 'Note').txt(invoice_data.notes);
    }

    doc.ele(UBL_NAMESPACES.CBC, 'DocumentCurrencyCode').txt(currency);

    doc
      .ele(UBL_NAMESPACES.CBC, 'LineCountNumeric')
      .txt(String(invoice_data.items.length));

    // 3. Invoice period (optional — for recurrent invoicing)
    if (invoice_data.due_date) {
      const period = doc.ele(UBL_NAMESPACES.CAC, 'InvoicePeriod');
      period.ele(UBL_NAMESPACES.CBC, 'StartDate').txt(invoice_data.issue_date);
      period.ele(UBL_NAMESPACES.CBC, 'EndDate').txt(invoice_data.due_date);
    }

    // 4. Supplier party
    UblCommonBuilder.buildSupplierParty(doc, issuer, control?.prefix);

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

    // 7. Document-level allowance (only when a footer discount exists that the
    // lines do not already carry). UBL fixes the order
    // PaymentTerms → AllowanceCharge → TaxTotal → LegalMonetaryTotal, so this
    // must precede the tax totals.
    UblCommonBuilder.buildDocumentAllowanceCharge(doc, invoice_data, currency);

    // 8. Tasa de cambio, cuando la operación se pactó en divisa.
    //
    //    Va DESPUÉS de `AllowanceCharge` y ANTES de `TaxTotal`: la secuencia de
    //    `InvoiceType` es AllowanceCharge → TaxExchangeRate → PricingExchangeRate
    //    → PaymentExchangeRate → PaymentAlternativeExchangeRate → TaxTotal.
    //    De los cuatro grupos de cambio, la DIAN sólo describe `Payment...`.
    //
    //    La factura NO cambia de moneda: sigue en COP (Res. 000042/2020 art. 73;
    //    Oficios 901544 y 903436 de 2020; Concepto 1509 de 2024). Este grupo es
    //    una DECLARACIÓN de la conversión, no la moneda del documento.
    UblCommonBuilder.buildPaymentExchangeRate(doc, invoice_data.exchange_rate);

    // 9. Tax totals
    UblCommonBuilder.buildTaxTotals(doc, invoice_data.taxes, currency);

    // 10. Retenciones — `cac:WithholdingTaxTotal`, entre `TaxTotal` y
    //     `LegalMonetaryTotal` según la secuencia de `InvoiceType`.
    //
    //     NO tocan `cbc:PayableAmount` (§11.9.1): la DIAN valida los totales sin
    //     mirar este grupo, así que restarlas descuadra la factura y la rechaza.
    //     Vale para los tres roles, incluida la autorretención.
    UblCommonBuilder.buildWithholdingTaxTotal(
      doc,
      invoice_data.withholdings,
      currency,
    );

    // 11. Legal monetary total
    UblCommonBuilder.buildLegalMonetaryTotal(doc, invoice_data, currency);

    // 12. Invoice lines
    UblCommonBuilder.buildInvoiceLines(
      doc,
      invoice_data.items as UblDocumentLine[],
      invoice_data.taxes,
      currency,
    );

    return doc.end({ prettyPrint: true });
  }
}
