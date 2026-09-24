import { FiscalDocumentValidator } from '../validators/fiscal-document.validator';
import { create } from 'xmlbuilder2';
import { UblCommonBuilder } from '../providers/dian-direct/xml/ubl-common.builder';
import { UBL_NAMESPACES } from '../providers/dian-direct/xml/xml-namespaces';
import { DianTotalsValidator } from '../providers/dian-direct/xml/dian-totals.validator';
import { projectFinancialAccountInvoice } from './split-invoice-projection.util';
import { allocateFinancialSplit } from '../../tables/utils/split-allocation.util';

function fixture() {
  const source = {
    subtotal_amount: '10000.00', discount_amount: '500.00', tax_amount: '1805.00', shipping_cost: '400.00', tip_amount: '600.00', grand_total: '12305.00', paid_total: '2305.00',
    items: [{ id: 7, subtotal_amount: '10000.00', taxes: [{ tax_rate_id: 1, tax_name: 'IVA', tax_rate: '0.19', tax_type: 'iva' as const, tax_amount: '1805.00', is_inclusive: true, is_compound: false }] }],
  };
  const result = allocateFinancialSplit(source, { mode: 'custom', n_splits: 2, amounts: ['3000.00', '7000.00'] });
  return [result.retained_account!, ...result.accounts].map((a, i) => ({ ...a, id: i + 1, label: `Cuenta ${i}`, lines: a.lines.map((line, j) => ({ ...line, id: i * 10 + j + 1, source_order_item_id: line.source_order_item_id ?? null, description: line.kind, source_snapshot: { quantity: 3 }, taxes: line.taxes.map((tax) => ({ ...tax, is_compound: tax.is_compound ?? false, tax_rate_id: tax.tax_rate_id ?? null, tax_type: tax.tax_type as 'iva' })) })) }));
}

describe('financial account invoice projection', () => {
  it('preserves exact independent totals including retained payment and discounts/tips/shipping', () => {
    const projections = fixture().map((a) => projectFinancialAccountInvoice(a, 'QA-001'));
    expect(projections.map((p) => p.total.toFixed(2))).toEqual(['2305.00', '3000.00', '7000.00']);
    expect(projections.reduce((sum, p) => sum + Number(p.total), 0)).toBe(12305);
    for (const p of projections) expect(p.subtotal.plus(p.tax).equals(p.total)).toBe(true);
  });
  it('represents financial participation explicitly without claiming additional stock units', () => {
    const p = projectFinancialAccountInvoice(fixture()[1], 'QA-001');
    for (const item of p.items) {
      expect(item.data.quantity.toString()).toBe('1');
      expect(item.data.product_id).toBeNull();
      expect(item.data.stock_units_consumed).toBeNull();
      expect(item.data.financial_source_line_id).toBeGreaterThan(0);
      expect(item.data.description).toContain('Participación');
    }
    expect(p.items[0].data.description).toContain('3 unidades originales');
    expect(p.items[0].taxes[0].tax_rate.toString()).toBe('19');
  });
  it('retains line taxes, with net-price semantics rather than clearing inclusive tax twice', () => {
    const p = projectFinancialAccountInvoice(fixture()[2], 'QA-001');
    expect(p.items[0].taxes[0].is_inclusive).toBe(false);
    expect(p.items[0].taxes[0].taxable_amount.equals(p.items[0].data.unit_price.minus(p.items[0].data.discount_amount))).toBe(true);
  });
  it('fails closed before persistence on corrupted header or tax snapshot', () => {
    const a = fixture()[1];
    expect(() => projectFinancialAccountInvoice({ ...a, grand_total: '3000.01' }, 'QA')).toThrow('account snapshot');
    a.lines[0].taxes[0].tax_amount = '0.00';
    expect(() => projectFinancialAccountInvoice(a, 'QA')).toThrow('tax snapshot');
  });
  it('uses per mille for ICA instead of blindly multiplying all taxes by 100', () => {
    // Sin descuento: la tarifa ficticia no pasa por la proyección del descuento
    // (que despeja con la tarifa); sólo se prueba la conversión de unidad.
    const a = fixture()[1];
    const lines = a.lines.map((l) => ({ ...l, discount_amount: '0.00', total_amount: (Number(l.subtotal_amount) + Number(l.tax_amount)).toFixed(2), taxes: l.taxes.map((t) => ({ ...t, tax_type: 'ica' as const, tax_rate: '0.007' })) }));
    const grand_total = lines.reduce((n, l) => n + Number(l.total_amount), 0).toFixed(2);
    const p = projectFinancialAccountInvoice({ ...a, discount_amount: '0.00', grand_total, lines }, 'QA');
    expect(p.items[0].taxes[0].tax_rate.toString()).toBe('7');
  });
});


describe('financial account fiscal pipeline (real prevalidator and UBL totals)', () => {
  it.each([0, 1, 2])('independent account %s validates without changing money or weakening a gate', (index) => {
    const account = fixture()[index];
    const p = projectFinancialAccountInvoice(account, 'QA');
    const taxes = p.items.flatMap((line) => line.taxes.map((tax) => ({
      tax_name: tax.tax_name, tax_type: tax.tax_type ?? undefined,
      tax_rate: tax.tax_rate.toString(), taxable_amount: tax.taxable_amount.toFixed(2), tax_amount: tax.tax_amount.toFixed(2),
    })));
    const items = p.items.map((line, i) => ({
      line_number: i + 1, description: line.data.description, quantity: '1', unit_code: 'EA',
      unit_price: line.data.unit_price.toFixed(2), discount_amount: line.data.discount_amount.toFixed(2),
      tax_amount: line.data.tax_amount.toFixed(2), total_amount: line.data.total_amount.toFixed(2),
      taxes: line.taxes.map((tax) => ({ tax_name: tax.tax_name, tax_type: tax.tax_type ?? undefined, tax_rate: tax.tax_rate.toString(), taxable_amount: tax.taxable_amount.toFixed(2), tax_amount: tax.tax_amount.toFixed(2) })),
    }));
    const result = new FiscalDocumentValidator().validate({
      document_type: 'sales_invoice', invoice_number: 'FE6', issue_date: '2026-09-20', currency: 'COP', operation_type: '10',
      subtotal_amount: p.subtotal.toFixed(2), discount_amount: p.discount.toFixed(2),
      tax_amount: p.tax.toFixed(2), total_amount: p.total.toFixed(2), withholding_amount: '0', items, taxes,
      resolution: { id: 7, resolution_number: '18760000001', prefix: 'FE', range_from: 1, range_to: 1000, current_number: 5, valid_from: '2026-01-01', valid_to: '2026-12-31', is_active: true, technical_key: 'a1b2c3d4e5'.repeat(4) },
    });
    expect(result.findings.filter((f) => f.severity === 'blocker')).toEqual([]);
    const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(UBL_NAMESPACES.INVOICE, 'Invoice', { 'xmlns:cac': UBL_NAMESPACES.CAC, 'xmlns:cbc': UBL_NAMESPACES.CBC, 'xmlns:ext': UBL_NAMESPACES.EXT });
    const payload = { items, taxes, discount_amount: p.discount.toFixed(2), tax_amount: p.tax.toFixed(2) };
    UblCommonBuilder.buildTaxTotals(doc, taxes, 'COP');
    UblCommonBuilder.buildLegalMonetaryTotal(doc, payload, 'COP');
    UblCommonBuilder.buildInvoiceLines(doc, items, taxes, 'COP');
    const xml = doc.end({ prettyPrint: false });
    const xmlReport = DianTotalsValidator.validate(xml);
    expect(xmlReport.violations.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
    expect(xml).toContain(`<cbc:PayableAmount currencyID="COP">${account.grand_total}</cbc:PayableAmount>`);
  });
});
