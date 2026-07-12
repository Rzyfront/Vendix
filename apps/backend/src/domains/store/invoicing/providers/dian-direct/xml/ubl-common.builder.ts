import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import { DIAN_TAX_CODES, DIAN_TAX_NAMES } from '../constants/dian-tax-codes';
import {
  DianIssuerData,
  DianCustomerData,
  DianSoftwareSecurity,
  DianInvoiceControl,
} from '../interfaces/dian-config.interface';
import {
  ProviderInvoiceTax,
  ProviderInvoiceItem,
} from '../../invoice-provider.interface';
import { createHash } from 'crypto';

/**
 * Shared UBL 2.1 element builders for Colombian electronic invoicing.
 * Used by both invoice and credit note builders.
 */
export class UblCommonBuilder {
  /** DIAN scheme agency attributes shared by every sts:* identifier. */
  private static readonly DIAN_SCHEME_AGENCY_NAME =
    'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)';

  /**
   * Builds the UBLExtensions element with the full DIAN `sts:DianExtensions`
   * block that DIAN validates, in the mandated order:
   *   1. InvoiceControl  (InvoiceAuthorization, AuthorizationPeriod, AuthorizedInvoices)
   *   2. InvoiceSource   (country code 'CO')
   *   3. SoftwareProvider (ProviderID = software provider NIT, SoftwareID = DIAN GUID)
   *   4. SoftwareSecurityCode
   *   5. AuthorizationProvider (always the DIAN NIT 800197268)
   *   6. QRCode          (document consultation URL, contains the CUFE/CUDE/CUDS)
   * A second empty UBLExtension is appended as the placeholder for the XAdES
   * digital signature (inserted later by dian-xml-signer.service.ts).
   *
   * `options.control`, `options.issuer_nit`/`issuer_nit_dv` and
   * `options.qr_code` are optional so existing callers keep compiling; the
   * orchestrator populates them from the numbering resolution + CUFE.
   */
  static buildExtensions(
    parent: any,
    software_security: DianSoftwareSecurity,
    options?: {
      control?: DianInvoiceControl;
      issuer_nit?: string;
      issuer_nit_dv?: string;
      qr_code?: string;
    },
  ): void {
    const agency_name = UblCommonBuilder.DIAN_SCHEME_AGENCY_NAME;
    const dian = parent
      .ele(UBL_NAMESPACES.EXT, 'UBLExtensions')
      .ele(UBL_NAMESPACES.EXT, 'UBLExtension')
      .ele(UBL_NAMESPACES.EXT, 'ExtensionContent')
      .ele(UBL_NAMESPACES.STS, 'DianExtensions');

    // 1. InvoiceControl — numbering resolution authorization + range.
    const control = options?.control;
    const invoice_control = dian.ele(UBL_NAMESPACES.STS, 'InvoiceControl');
    invoice_control
      .ele(UBL_NAMESPACES.STS, 'InvoiceAuthorization')
      .txt(control?.invoice_authorization ?? '');
    const period = invoice_control.ele(
      UBL_NAMESPACES.STS,
      'AuthorizationPeriod',
    );
    period
      .ele(UBL_NAMESPACES.CBC, 'StartDate')
      .txt(control?.authorization_start_date ?? '');
    period
      .ele(UBL_NAMESPACES.CBC, 'EndDate')
      .txt(control?.authorization_end_date ?? '');
    const authorized = invoice_control.ele(
      UBL_NAMESPACES.STS,
      'AuthorizedInvoices',
    );
    // Prefix is optional (0..1) — omit the element when the resolution has none.
    if (control?.prefix) {
      authorized.ele(UBL_NAMESPACES.STS, 'Prefix').txt(control.prefix);
    }
    authorized.ele(UBL_NAMESPACES.STS, 'From').txt(control?.range_from ?? '');
    authorized.ele(UBL_NAMESPACES.STS, 'To').txt(control?.range_to ?? '');

    // 2. InvoiceSource — ISO 3166-1 country code of the document source.
    dian
      .ele(UBL_NAMESPACES.STS, 'InvoiceSource')
      .ele(UBL_NAMESPACES.CBC, 'IdentificationCode')
      .att('listAgencyID', '6')
      .att('listAgencyName', 'United Nations Economic Commission for Europe')
      .att(
        'listSchemeURI',
        'urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1',
      )
      .txt(UBL_CONSTANTS.COUNTRY_CODE);

    // 3. SoftwareProvider — ProviderID is the software provider NIT (falls back
    //    to the issuer NIT for self-developed software); SoftwareID is the DIAN
    //    software GUID.
    const software = dian.ele(UBL_NAMESPACES.STS, 'SoftwareProvider');
    // ProviderID: NIT of the software provider WITHOUT its DV (the DV is the
    // schemeID). schemeAgencyID/@schemeName/@schemeID are all mandatory (1..1).
    software
      .ele(UBL_NAMESPACES.STS, 'ProviderID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', agency_name)
      .att(
        'schemeID',
        software_security.provider_nit_dv ?? options?.issuer_nit_dv ?? '',
      )
      .att('schemeName', '31') // 31 = NIT
      .txt(software_security.provider_nit ?? options?.issuer_nit ?? '');

    // NOTE: the DIAN sts schema names this element `softwareID` (lowercase 's'),
    // NOT `SoftwareID`. Using the wrong casing fails schema validation.
    software
      .ele(UBL_NAMESPACES.STS, 'softwareID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', agency_name)
      .txt(software_security.software_id);

    // 4. SoftwareSecurityCode.
    dian
      .ele(UBL_NAMESPACES.STS, 'SoftwareSecurityCode')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', agency_name)
      .txt(software_security.software_security_code);

    // 5. AuthorizationProvider — always the DIAN NIT.
    dian
      .ele(UBL_NAMESPACES.STS, 'AuthorizationProvider')
      .ele(UBL_NAMESPACES.STS, 'AuthorizationProviderID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', agency_name)
      .att('schemeID', '4')
      .att('schemeName', '31')
      .txt(UBL_CONSTANTS.DIAN_NIT);

    // 6. QRCode — document consultation URL (embeds the CUFE/CUDE/CUDS).
    if (options?.qr_code) {
      dian.ele(UBL_NAMESPACES.STS, 'QRCode').txt(options.qr_code);
    }

    // Second UBLExtension: placeholder ExtensionContent for the XAdES signature.
    // dian → .up() ExtensionContent → .up() UBLExtension → .up() UBLExtensions
    dian
      .up() // → ExtensionContent
      .up() // → UBLExtension (first)
      .up() // → UBLExtensions
      .ele(UBL_NAMESPACES.EXT, 'UBLExtension')
      .ele(UBL_NAMESPACES.EXT, 'ExtensionContent');
  }

  /**
   * Builds the DIAN document consultation (QR) URL. Habilitación and production
   * use different catalog hosts.
   */
  static buildQrUrl(
    environment: 'test' | 'production',
    document_key: string,
  ): string {
    const base =
      environment === 'production'
        ? 'https://catalogo-vpfe.dian.gov.co'
        : 'https://catalogo-vpfe-hab.dian.gov.co';
    return `${base}/document/searchqr?documentkey=${document_key}`;
  }

  /**
   * Builds the supplier (emisor) party element.
   */
  static buildSupplierParty(parent: any, issuer: DianIssuerData): void {
    const supplier = parent.ele(UBL_NAMESPACES.CAC, 'AccountingSupplierParty');
    // AdditionalAccountID = tipo de persona/organización ('1' Jurídica default,
    // '2' Natural). The tax regime ('48'/'49') belongs in TaxLevelCode, not here.
    supplier
      .ele(UBL_NAMESPACES.CBC, 'AdditionalAccountID')
      .txt(issuer.person_type ?? '1');

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
    const tax_scheme = party.ele(UBL_NAMESPACES.CAC, 'PartyTaxScheme');
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'RegistrationName')
      .txt(issuer.legal_name);
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att(
        'schemeAgencyName',
        'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
      )
      .att('schemeID', issuer.nit_dv)
      .att('schemeName', issuer.document_type || '31') // NIT by default
      .txt(issuer.nit);

    // cbc:TaxLevelCode carries the fiscal responsibilities of the issuer (its
    // value, e.g. 'O-13;O-15' or 'R-99-PN'), which already encode the tax
    // regime. Per the DIAN annex (FAJ26/CAJ27) the @listName attribute is the
    // literal 'No aplica'. The regime is NOT emitted as a 48/49 code, and it no
    // longer lives in AdditionalAccountID (which is now the person type).
    const tax_level = tax_scheme.ele(UBL_NAMESPACES.CBC, 'TaxLevelCode');
    tax_level.att('listName', 'No aplica').txt(issuer.tax_scheme);

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
    legal.ele(UBL_NAMESPACES.CBC, 'RegistrationName').txt(issuer.legal_name);
    legal
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att(
        'schemeAgencyName',
        'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
      )
      .att('schemeID', issuer.nit_dv)
      .att('schemeName', issuer.document_type || '31')
      .txt(issuer.nit);

    // Contact
    if (issuer.email || issuer.phone) {
      const contact = party.ele(UBL_NAMESPACES.CAC, 'Contact');
      if (issuer.phone) {
        contact.ele(UBL_NAMESPACES.CBC, 'Telephone').txt(issuer.phone);
      }
      if (issuer.email) {
        contact.ele(UBL_NAMESPACES.CBC, 'ElectronicMail').txt(issuer.email);
      }
    }
  }

  /**
   * Builds the customer (adquirente) party element.
   */
  static buildCustomerParty(parent: any, customer: DianCustomerData): void {
    const customer_party = parent.ele(
      UBL_NAMESPACES.CAC,
      'AccountingCustomerParty',
    );
    // AdditionalAccountID = tipo de persona ('1' Jurídica / '2' Natural), NOT
    // the tax regime. When person_type is absent, derive it from the document
    // type (NIT '31' → Jurídica, otherwise Natural — e.g. consumidor final CC).
    customer_party
      .ele(UBL_NAMESPACES.CBC, 'AdditionalAccountID')
      .txt(
        customer.person_type ??
          (customer.document_type === '31' ? '1' : '2'),
      );

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
      .att(
        'schemeAgencyName',
        'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
      )
      .att('schemeID', customer.document_dv || '')
      .att('schemeName', customer.document_type)
      .txt(customer.document_number);

    // cbc:TaxLevelCode — fiscal responsibilities of the acquirer (value); the
    // @listName is the literal 'No aplica' per the DIAN annex. A consumidor
    // final / natural person reports 'R-99-PN'.
    const tax_level = tax_scheme.ele(UBL_NAMESPACES.CBC, 'TaxLevelCode');
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
    legal.ele(UBL_NAMESPACES.CBC, 'RegistrationName').txt(customer.legal_name);
    legal
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att(
        'schemeAgencyName',
        'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
      )
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
        contact.ele(UBL_NAMESPACES.CBC, 'ElectronicMail').txt(customer.email);
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

    addr.ele(UBL_NAMESPACES.CBC, 'ID').txt(address.city_code || '11001');
    addr.ele(UBL_NAMESPACES.CBC, 'CityName').txt(address.city_name || 'Bogotá');
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
    // Group taxes by DIAN scheme code (tax_type-aware): IVA→01, INC→04, ICA→03.
    // This is the document-level TaxTotal DIAN validates, so IVA and INC must
    // land in separate TaxSubtotal blocks with their own scheme.
    const tax_groups = new Map<string, ProviderInvoiceTax[]>();
    for (const tax of taxes) {
      const code = UblCommonBuilder.resolveTaxCodeFromTax(tax);
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
      tax_category.ele(UBL_NAMESPACES.CBC, 'Percent').txt(tax_percent);

      const scheme = tax_category.ele(UBL_NAMESPACES.CAC, 'TaxScheme');
      scheme.ele(UBL_NAMESPACES.CBC, 'ID').txt(code);
      scheme.ele(UBL_NAMESPACES.CBC, 'Name').txt(DIAN_TAX_NAMES[code] || code);
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
        allowance.ele(UBL_NAMESPACES.CBC, 'ChargeIndicator').txt('false');
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

      // Line-level tax code/rate. invoice_taxes is header-level (not persisted
      // per item), so a line inherits the invoice's primary tax. The code is
      // resolved tax_type-first for correctness on single-tax invoices (a pure
      // INC restaurant bill emits scheme 04, not 01). Mixed IVA+INC invoices
      // are reconciled at the authoritative document-level TaxTotal above.
      const tax_rate = taxes.length > 0 ? taxes[0].tax_rate : '19.00';
      const tax_code =
        taxes.length > 0
          ? UblCommonBuilder.resolveTaxCodeFromTax(taxes[0])
          : DIAN_TAX_CODES.IVA;

      const subtotal = line_tax_total.ele(UBL_NAMESPACES.CAC, 'TaxSubtotal');
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
      ubl_item.ele(UBL_NAMESPACES.CBC, 'Description').txt(item.description);

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
   * Resolves the DIAN tax scheme code for a tax row, prioritizing the persisted
   * fiscal type over the tax_name heuristic. This makes IVA (01), INC (04) and
   * ICA (03) deterministic regardless of how the tax was named by the user.
   */
  static resolveTaxCodeFromTax(tax: ProviderInvoiceTax): string {
    switch ((tax.tax_type || '').toLowerCase()) {
      case 'iva':
        return DIAN_TAX_CODES.IVA;
      case 'inc':
        return DIAN_TAX_CODES.INC;
      case 'ica':
        return DIAN_TAX_CODES.ICA;
      default:
        return UblCommonBuilder.resolveTaxCode(tax.tax_name);
    }
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
