import { create } from 'xmlbuilder2';
import { FullTaxRow, resolveCatalogLine } from '../../../orders/utils/catalog-line-pricing.util';
import { TaxFiscalType } from '../../../taxes/dto';
import { UblCommonBuilder, UblDocumentLine } from '../../../invoicing/providers/dian-direct/xml/ubl-common.builder';
import { DianTotalsValidator } from '../../../invoicing/providers/dian-direct/xml/dian-totals.validator';
import { UBL_NAMESPACES } from '../../../invoicing/providers/dian-direct/xml/xml-namespaces';
import { ProviderInvoiceTax } from '../../../invoicing/providers/invoice-provider.interface';
import {
  entryPermitLabel,
  exemptNightTaxRows,
  normalizeEntryPermit,
  VAT_EXEMPTION_TAX_NAME,
  VatExemptionGuest,
  vatExemptionBlockers,
} from './lodging-vat-exemption';

/** Holder of H-0001: US passport with the PIP-5 tourist stamp. */
const tourist: VatExemptionGuest = {
  is_primary: true,
  document_type: 'PA',
  nationality_country_code: 'US',
  entry_permit_type: 'PIP-5',
  is_non_resident: true,
};

const IVA19: FullTaxRow = { tax_rate_id: 7, name: 'IVA 19%', rate: 0.19, is_inclusive: false, tax_type: TaxFiscalType.IVA };

describe('H3.9 — VAT exemption of a non-resident tourist', () => {
  describe('who can take it', () => {
    it('a foreign holder with passport and PIP-5 in a store with RNT has no blockers', () => {
      expect(vatExemptionBlockers('12345', tourist)).toEqual([]);
    });

    it('a store without RNT cannot apply it', () => {
      expect(vatExemptionBlockers('  ', tourist)).toEqual([
        'La tienda no tiene RNT: regístralo en Configuración → Hotelería',
      ]);
    });

    it('without passport nor entry permit the box is disabled with both reasons', () => {
      const reasons = vatExemptionBlockers('12345', {
        ...tourist,
        document_type: 'CC',
        entry_permit_type: null,
      });
      expect(reasons).toEqual([
        'El titular debe identificarse con pasaporte',
        'Falta el sello o permiso de ingreso (PIP-3, PIP-5, PIP-6, PIP-10, TP-7, TP-11, TP-12, PT)',
      ]);
    });

    it('a Colombian or resident holder does not qualify, and no holder asks to register one', () => {
      expect(vatExemptionBlockers('12345', { ...tourist, nationality_country_code: 'CO' })).toEqual([
        'El titular debe tener nacionalidad extranjera',
      ]);
      expect(vatExemptionBlockers('12345', { ...tourist, is_non_resident: false })).toEqual([
        'El titular debe estar marcado como no residente',
      ]);
      expect(vatExemptionBlockers('12345', null)).toEqual(['Registra al titular de la reserva']);
    });

    it('reads the permit however the desk typed it', () => {
      expect(normalizeEntryPermit('pip 5')).toBe('PIP-5');
      expect(normalizeEntryPermit('PIP5')).toBe('PIP-5');
      expect(normalizeEntryPermit('pt')).toBe('PT');
      expect(normalizeEntryPermit('')).toBeNull();
      expect(vatExemptionBlockers('12345', { ...tourist, entry_permit_type: 'pip5' })).toEqual([]);
    });

    it('names the permit by its family and keeps the code (U18)', () => {
      expect(entryPermitLabel('PIP-5')).toBe('Permiso de ingreso y permanencia (PIP-5)');
      expect(entryPermitLabel('tp11')).toBe('Visa temporal (TP-11)');
      expect(entryPermitLabel('pt')).toBe('Permiso temporal (PT)');
      expect(entryPermitLabel('XYZ-1')).toBe('XYZ-1');
      expect(entryPermitLabel(null)).toBeNull();
    });
  });

  describe('night tax rows', () => {
    it('the VAT of a night becomes one VAT 0 % row "Exento – art. 481 lit. d ET"', () => {
      const rows = exemptNightTaxRows([IVA19]);
      expect(rows).toEqual([
        { tax_rate_id: null, name: VAT_EXEMPTION_TAX_NAME, rate: 0, is_inclusive: false, tax_type: TaxFiscalType.IVA },
      ]);
      const line = resolveCatalogLine({
        catalogUnitPrice: 250000,
        quantity: 1,
        priceUnitQuantityRaw: null,
        rows: rows as FullTaxRow[],
      });
      expect(line.totalPrice).toBe(250000);
      expect(line.taxAmountItem).toBe(0);
    });

    it('a product without VAT has nothing to exempt and keeps its rows', () => {
      const inc: FullTaxRow = { tax_rate_id: 8, name: 'INC 8%', rate: 0.08, is_inclusive: false, tax_type: TaxFiscalType.INC };
      expect(exemptNightTaxRows([inc])).toEqual([inc]);
    });
  });

  /**
   * Snapshot of the tributes the DIAN receives for a folio with two exempt
   * nights and one restaurant dish (INC 8 %): the nights declare IVA (01) at
   * `Percent 0.00` with tax 0, never omitted; the dish keeps its INC.
   */
  describe('UBL tribute of the folio invoice', () => {
    const EXEMPT: ProviderInvoiceTax = {
      tax_name: VAT_EXEMPTION_TAX_NAME,
      tax_type: 'iva',
      tax_rate: '0.00',
      taxable_amount: '500000.00',
      tax_amount: '0.00',
    } as ProviderInvoiceTax;
    const INC8: ProviderInvoiceTax = {
      tax_name: 'INC 8%',
      tax_type: 'inc',
      tax_rate: '8.00',
      taxable_amount: '100000.00',
      tax_amount: '8000.00',
    } as ProviderInvoiceTax;

    function emit(items: UblDocumentLine[], taxes: ProviderInvoiceTax[], tax_amount: string) {
      const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(UBL_NAMESPACES.INVOICE, 'Invoice', {
        'xmlns:cac': UBL_NAMESPACES.CAC,
        'xmlns:cbc': UBL_NAMESPACES.CBC,
        'xmlns:ext': UBL_NAMESPACES.EXT,
      });
      UblCommonBuilder.buildTaxTotals(doc, taxes, 'COP');
      UblCommonBuilder.buildLegalMonetaryTotal(doc, { tax_amount, items, taxes, discount_amount: '0.00' } as any, 'COP');
      UblCommonBuilder.buildInvoiceLines(doc, items, taxes, 'COP');
      const xml = doc.end({ prettyPrint: false });
      const lines = [...xml.matchAll(/<cac:InvoiceLine>(.*?)<\/cac:InvoiceLine>/g)].map((m) => m[1]);
      const header = xml.split('<cac:InvoiceLine>')[0];
      return { xml, lines, header };
    }

    const nights: UblDocumentLine = {
      description: 'Alojamiento – Doble',
      quantity: '2',
      unit_price: '250000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: '500000.00',
    };
    const dish: UblDocumentLine = {
      description: 'Bandeja paisa',
      quantity: '1',
      unit_price: '100000.00',
      discount_amount: '0.00',
      tax_amount: '8000.00',
      total_amount: '108000.00',
    };

    it('exempt nights + taxed dish: IVA 01 at 0.00 on the nights, INC 8 % on the dish', () => {
      const { xml, lines, header } = emit(
        [
          { ...nights, taxes: [{ ...EXEMPT }] } as UblDocumentLine,
          { ...dish, taxes: [{ ...INC8 }] } as UblDocumentLine,
        ],
        [EXEMPT, INC8],
        '8000.00',
      );

      expect(lines[0]).toContain(
        '<cac:TaxSubtotal><cbc:TaxableAmount currencyID="COP">500000.00</cbc:TaxableAmount>' +
          '<cbc:TaxAmount currencyID="COP">0.00</cbc:TaxAmount><cac:TaxCategory>' +
          '<cbc:Percent>0.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name>',
      );
      expect(lines[1]).toContain('<cbc:Percent>8.00</cbc:Percent>');
      expect(lines[1]).toContain('<cbc:ID>04</cbc:ID>');
      expect(header).toContain('<cbc:Percent>0.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID>');
      const result = DianTotalsValidator.validate(xml);
      expect(result.violations.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
    });

    it('a folio of only exempt nights declares its IVA 0.00 in the header and the line', () => {
      const { xml, lines, header } = emit([nights], [EXEMPT], '0.00');

      expect(lines[0]).toContain('<cbc:Percent>0.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID>');
      expect(header).toContain('<cbc:Percent>0.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID>');
      expect(DianTotalsValidator.validate(xml).violations).toEqual([]);
    });
  });
});
