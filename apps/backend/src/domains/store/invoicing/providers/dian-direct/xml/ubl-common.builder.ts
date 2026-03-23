import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import { DIAN_TAX_CODES, DIAN_TAX_NAMES } from '../constants/dian-tax-codes';
import {
  DianIssuerData,
  DianCustomerData,
  DianSoftwareSecurity,
} from '../interfaces/dian-config.interface';
import { ProviderInvoiceTax, ProviderInvoiceItem } from '../../invoice-provider.interface';
import { createHash } from 'crypto';

/**
 * Shared UBL 2.1 element builders for Colombian electronic invoicing.
 * Used by both invoice and credit note builders.
 */
export class UblCommonBuilder {
  /**
   * Builds the UBLExtensions element with DIAN software security.
   */
  static buildExtensions(
    parent: any,
    software_security: DianSoftwareSecurity,
  ): void {
    const ext = parent
      .ele(UBL_NAMESPACES.EXT, 'UBLExtensions')
      .ele(UBL_NAMESPACES.EXT, 'UBLExtension')
      .ele(UBL_NAMESPACES.EXT, 'ExtensionContent')
      .ele(UBL_NAMESPACES.STS, 'DianExtensions');

    const invoice_control = ext.ele(
      UBL_NAMESPACES.STS,
      'InvoiceControl',
    );

    const software = ext.ele(UBL_NAMESPACES.STS, 'SoftwareProvider');
    software
      .ele(UBL_NAMESPACES.STS, 'ProviderID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', 'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)')
      .txt(software_security.software_id);

    software
      .ele(UBL_NAMESPACES.STS, 'SoftwareID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', 'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)')
      .txt(software_security.software_id);

    ext
      .ele(UBL_NAMESPACES.STS, 'SoftwareSecurityCode')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', 'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)')
      .txt(software_security.software_security_code);

    // Navigate back to UBLExtensions and add second UBLExtension (placeholder for digital signature)
    // ext → DianExtensions → .up() ExtensionContent → .up() UBLExtension → .up() UBLExtensions
    ext
      .up() // → ExtensionContent
      .up() // → UBLExtension (first)
      .up() // → UBLExtensions
      .ele(UBL_NAMESPACES.EXT, 'UBLExtension')
      .ele(UBL_NAMESPACES.EXT, 'ExtensionContent');
  }

  /**
   * Builds the supplier (emisor) party element.
   */
  static buildSupplierParty(parent: any, issuer: DianIssuerData): void {
    const supplier = parent.ele(UBL_NAMESPACES.CAC, 'AccountingSupplierParty');
    supplier
      .ele(UBL_NAMESPACES.CBC, 'AdditionalAccountID')
      .txt(issuer.tax_regime);

    const party = supplier.ele(UBL_NAMESPACES.CAC, 'Party');

    // Party name
    party
      .ele(UBL_NAMESPACES.CAC, 'PartyName')
      .ele(UBL_NAMESPACES.CBC, 'Name')
      .txt(issuer.trade_name || issuer.legal_name);

    // Physical location
    UblCommonBuilder.buildAddress(
      party.ele(UBL_NAMESPACES.CAC, 'PhysicalLocation'),
      issuer,
    );

    // Tax scheme
    const tax_scheme = party
      .ele(UBL_NAMESPACES.CAC, 'PartyTaxScheme');
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'RegistrationName')
      .txt(issuer.legal_name);
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', 'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)')
      .att('schemeID', issuer.nit_dv)
      .att('schemeName', '31') // NIT
      .txt(issuer.nit);

    const tax_level = tax_scheme.ele(UBL_NAMESPACES.CAC, 'TaxLevelCode');
    tax_level
      .att('listName', 'No aplica')
      .txt(issuer.tax_scheme);

    UblCommonBuilder.buildAddress(
      tax_scheme.ele(UBL_NAMESPACES.CAC, 'RegistrationAddress'),
      issuer,
    );

    tax_scheme
      .ele(UBL_NAMESPACES.CAC, 'TaxScheme')
      .ele(UBL_NAMESPACES.CBC, 'ID')
      .txt(DIAN_TAX_CODES.IVA);

    // Party legal entity
    const legal = party.ele(UBL_NAMESPACES.CAC, 'PartyLegalEntity');
    legal
      .ele(UBL_NAMESPACES.CBC, 'RegistrationName')
      .txt(issuer.legal_name);
    legal
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', 'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)')
      .att('schemeID', issuer.nit_dv)
      .att('schemeName', '31')
      .txt(issuer.nit);

    // Contact
    if (issuer.email || issuer.phone) {
      const contact = party.ele(UBL_NAMESPACES.CAC, 'Contact');
      if (issuer.phone) {
        contact.ele(UBL_NAMESPACES.CBC, 'Telephone').txt(issuer.phone);
      }
      if (issuer.email) {
        contact
          .ele(UBL_NAMESPACES.CBC, 'ElectronicMail')
          .txt(issuer.email);
      }
    }
  }

  /**
   * Builds the customer (adquirente) party element.
   */
  static buildCustomerParty(
    parent: any,
    customer: DianCustomerData,
  ): void {
    const customer_party = parent.ele(
      UBL_NAMESPACES.CAC,
      'AccountingCustomerParty',
    );
    customer_party
      .ele(UBL_NAMESPACES.CBC, 'AdditionalAccountID')
      .txt(customer.tax_regime || '49'); // Default: No responsable IVA

    const party = customer_party.ele(UBL_NAMESPACES.CAC, 'Party');

    // Party name
    party
      .ele(UBL_NAMESPACES.CAC, 'PartyName')
      .ele(UBL_NAMESPACES.CBC, 'Name')
      .txt(customer.trade_name || customer.legal_name);

    // Physical location
    if (customer.city_code) {
      UblCommonBuilder.buildAddress(
        party.ele(UBL_NAMESPACES.CAC, 'PhysicalLocation'),
        customer,
      );
    }

    // Tax scheme
    const tax_scheme = party.ele(UBL_NAMESPACES.CAC, 'PartyTaxScheme');
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'RegistrationName')
      .txt(customer.legal_name);
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', 'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)')
      .att('schemeID', customer.document_dv || '')
      .att('schemeName', customer.document_type)
      .txt(customer.document_number);

    const tax_level = tax_scheme.ele(UBL_NAMESPACES.CAC, 'TaxLevelCode');
    tax_level
      .att('listName', 'No aplica')
      .txt(customer.tax_responsibilities?.[0] || 'R-99-PN');

    if (customer.city_code) {
      UblCommonBuilder.buildAddress(
        tax_scheme.ele(UBL_NAMESPACES.CAC, 'RegistrationAddress'),
        customer,
      );
    }

    tax_scheme
      .ele(UBL_NAMESPACES.CAC, 'TaxScheme')
      .ele(UBL_NAMESPACES.CBC, 'ID')
      .txt(DIAN_TAX_CODES.IVA);

    // Legal entity
    const legal = party.ele(UBL_NAMESPACES.CAC, 'PartyLegalEntity');
    legal
      .ele(UBL_NAMESPACES.CBC, 'RegistrationName')
      .txt(customer.legal_name);
    legal
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', 'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)')
      .att('schemeID', customer.document_dv || '')
      .att('schemeName', customer.document_type)
      .txt(customer.document_number);

    // Contact
    if (customer.email || customer.phone) {
      const contact = party.ele(UBL_NAMESPACES.CAC, 'Contact');
      if (customer.phone) {
        contact.ele(UBL_NAMESPACES.CBC, 'Telephone').txt(customer.phone);
      }
      if (customer.email) {
        contact
          .ele(UBL_NAMESPACES.CBC, 'ElectronicMail')
          .txt(customer.email);
      }
    }
  }

  /**
   * Builds an address element (used for PhysicalLocation and RegistrationAddress).
   */
  static buildAddress(
    parent: any,
    address: {
      address_line?: string;
      city_code?: string;
      city_name?: string;
      department_code?: string;
      department_name?: string;
      country_code?: string;
      postal_code?: string;
    },
  ): void {
    const addr = parent.ele(UBL_NAMESPACES.CAC, 'Address');

    addr
      .ele(UBL_NAMESPACES.CBC, 'ID')
      .txt(address.city_code || '11001');
    addr
      .ele(UBL_NAMESPACES.CBC, 'CityName')
      .txt(address.city_name || 'Bogotá');
    addr
      .ele(UBL_NAMESPACES.CBC, 'PostalZone')
      .txt(address.postal_code || '110111');
    addr
      .ele(UBL_NAMESPACES.CBC, 'CountrySubentity')
      .txt(address.department_name || 'Bogotá');
    addr
      .ele(UBL_NAMESPACES.CBC, 'CountrySubentityCode')
      .txt(address.department_code || '11');

    addr
      .ele(UBL_NAMESPACES.CAC, 'AddressLine')
      .ele(UBL_NAMESPACES.CBC, 'Line')
      .txt(address.address_line || 'N/A');

    const country = addr.ele(UBL_NAMESPACES.CAC, 'Country');
    country
      .ele(UBL_NAMESPACES.CBC, 'IdentificationCode')
      .txt(address.country_code || 'CO');
    country
      .ele(UBL_NAMESPACES.CBC, 'Name')
      .att('languageID', 'es')
      .txt('Colombia');
  }

  /**
   * Builds tax total elements from invoice taxes.
   */
  static buildTaxTotals(
    parent: any,
    taxes: ProviderInvoiceTax[],
    currency: string,
  ): void {
    // Group taxes by tax code
    const tax_groups = new Map<string, ProviderInvoiceTax[]>();
    for (const tax of taxes) {
      const code = UblCommonBuilder.resolveTaxCode(tax.tax_name);
      if (!tax_groups.has(code)) {
        tax_groups.set(code, []);
      }
      tax_groups.get(code)!.push(tax);
    }

    // Calculate total tax amount
    const total_tax = taxes.reduce(
      (sum, t) => sum + parseFloat(t.tax_amount),
      0,
    );

    const tax_total = parent.ele(UBL_NAMESPACES.CAC, 'TaxTotal');
    tax_total
      .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
      .att('currencyID', currency)
      .txt(total_tax.toFixed(2));

    for (const [code, group_taxes] of tax_groups) {
      const group_amount = group_taxes.reduce(
        (sum, t) => sum + parseFloat(t.tax_amount),
        0,
      );
      const group_taxable = group_taxes.reduce(
        (sum, t) => sum + parseFloat(t.taxable_amount),
        0,
      );

      const subtotal = tax_total.ele(UBL_NAMESPACES.CAC, 'TaxSubtotal');
      subtotal
        .ele(UBL_NAMESPACES.CBC, 'TaxableAmount')
        .att('currencyID', currency)
        .txt(group_taxable.toFixed(2));
      subtotal
        .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
        .att('currencyID', currency)
        .txt(group_amount.toFixed(2));

      const tax_category = subtotal.ele(UBL_NAMESPACES.CAC, 'TaxCategory');

      // ICA rates are stored in "per mil" (‰) — convert to percentage for UBL
      const tax_percent =
        code === DIAN_TAX_CODES.ICA
          ? (parseFloat(group_taxes[0].tax_rate) / 10).toFixed(4)
          : group_taxes[0].tax_rate;
      tax_category
        .ele(UBL_NAMESPACES.CBC, 'Percent')
        .txt(tax_percent);

      const scheme = tax_category.ele(UBL_NAMESPACES.CAC, 'TaxScheme');
      scheme.ele(UBL_NAMESPACES.CBC, 'ID').txt(code);
      scheme
        .ele(UBL_NAMESPACES.CBC, 'Name')
        .txt(DIAN_TAX_NAMES[code] || code);
    }
  }

  /**
   * Builds invoice line items.
   */
  static buildInvoiceLines(
    parent: any,
    items: ProviderInvoiceItem[],
    taxes: ProviderInvoiceTax[],
    currency: string,
  ): void {
    items.forEach((item, index) => {
      const line = parent.ele(UBL_NAMESPACES.CAC, 'InvoiceLine');
      line.ele(UBL_NAMESPACES.CBC, 'ID').txt(String(index + 1));

      line
        .ele(UBL_NAMESPACES.CBC, 'InvoicedQuantity')
        .att('unitCode', 'EA') // Each (unit)
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

      // Allowance/charge for discount
      if (parseFloat(item.discount_amount) > 0) {
        const allowance = line.ele(UBL_NAMESPACES.CAC, 'AllowanceCharge');
        allowance
          .ele(UBL_NAMESPACES.CBC, 'ChargeIndicator')
          .txt('false');
        allowance
          .ele(UBL_NAMESPACES.CBC, 'Amount')
          .att('currencyID', currency)
          .txt(parseFloat(item.discount_amount).toFixed(2));
      }

      // Tax total for line
      const line_tax = parseFloat(item.tax_amount);
      const line_tax_total = line.ele(UBL_NAMESPACES.CAC, 'TaxTotal');
      line_tax_total
        .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
        .att('currencyID', currency)
        .txt(line_tax.toFixed(2));

      // Use first tax rate as line tax rate
      const tax_rate = taxes.length > 0 ? taxes[0].tax_rate : '19.00';
      const tax_code =
        taxes.length > 0
          ? UblCommonBuilder.resolveTaxCode(taxes[0].tax_name)
          : DIAN_TAX_CODES.IVA;

      const subtotal = line_tax_total.ele(
        UBL_NAMESPACES.CAC,
        'TaxSubtotal',
      );
      subtotal
        .ele(UBL_NAMESPACES.CBC, 'TaxableAmount')
        .att('currencyID', currency)
        .txt(
          (
            parseFloat(item.quantity) * parseFloat(item.unit_price) -
            parseFloat(item.discount_amount)
          ).toFixed(2),
        );
      subtotal
        .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
        .att('currencyID', currency)
        .txt(line_tax.toFixed(2));

      const category = subtotal.ele(UBL_NAMESPACES.CAC, 'TaxCategory');
      category.ele(UBL_NAMESPACES.CBC, 'Percent').txt(tax_rate);
      category
        .ele(UBL_NAMESPACES.CAC, 'TaxScheme')
        .ele(UBL_NAMESPACES.CBC, 'ID')
        .txt(tax_code);

      // Item description
      const ubl_item = line.ele(UBL_NAMESPACES.CAC, 'Item');
      ubl_item
        .ele(UBL_NAMESPACES.CBC, 'Description')
        .txt(item.description);

      // Price
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

  /**
   * Resolves a tax name (IVA, INC, ICA) to its DIAN code.
   */
  static resolveTaxCode(tax_name: string): string {
    const name = tax_name.toUpperCase().trim();
    if (name.includes('IVA') || name.includes('VAT')) {
      return DIAN_TAX_CODES.IVA;
    }
    if (name.includes('INC') || name.includes('CONSUMO')) {
      return DIAN_TAX_CODES.INC;
    }
    if (name.includes('ICA')) {
      return DIAN_TAX_CODES.ICA;
    }
    return DIAN_TAX_CODES.IVA; // Default
  }

  /**
   * Generates the SoftwareSecurityCode hash.
   * SHA-384(software_id + pin + invoice_number)
   */
  static generateSoftwareSecurityCode(
    software_id: string,
    pin: string,
    invoice_number: string,
  ): string {
    const raw = software_id + pin + invoice_number;
    return createHash('sha384').update(raw).digest('hex');
  }
}
