import { Prisma } from '@prisma/client';
import { create } from 'xmlbuilder2';
import { FiscalDocumentValidator } from '../validators/fiscal-document.validator';
import { UblCommonBuilder } from '../providers/dian-direct/xml/ubl-common.builder';
import { UBL_NAMESPACES } from '../providers/dian-direct/xml/xml-namespaces';
import { DianTotalsValidator } from '../providers/dian-direct/xml/dian-totals.validator';
import {
  FinancialAccountShippingSource,
  projectFinancialAccountInvoice,
} from './split-invoice-projection.util';
import {
  allocateFinancialSplit,
  FinancialSplitRequest,
} from '../../tables/utils/split-allocation.util';
import { projectOrderDiscountedTaxes } from '../../payments/utils/order-sale-tax-payload.util';
import { allocateFinancialAccountShippingTax } from '../../shipping/utils/financial-account-shipping-tax.util';

/**
 * Factura de cuenta financiera (cuenta dividida) con descuento de ORDEN.
 *
 * Caso: camisa IVA 19 % (100.000 + 19.000), licor INC 8 % (100.000 + 8.000),
 * libro exento (20.000), envío 5.000 con IVA 19 % incluido (798,31) y
 * descuento de orden 10.000 ⇒ total 242.000, partido en 2 facturas.
 */
const TAX = (over: Record<string, unknown>) => ({
  tax_rate_id: 1,
  tax_name: 'IVA',
  tax_rate: '0.19',
  tax_type: 'iva',
  tax_amount: '0.00',
  is_inclusive: false,
  is_compound: false,
  ...over,
});

function source(discount: '10000.00' | '0.00') {
  const grand = discount === '0.00' ? '252000.00' : '242000.00';
  return {
    subtotal_amount: '220000.00',
    discount_amount: discount,
    tax_amount: '27000.00',
    shipping_cost: '5000.00',
    tip_amount: '0.00',
    grand_total: grand,
    paid_total: '0.00',
    items: [
      { id: 1, subtotal_amount: '100000.00', taxes: [TAX({ tax_amount: '19000.00' })] },
      {
        id: 2,
        subtotal_amount: '100000.00',
        taxes: [TAX({ tax_rate_id: 2, tax_name: 'INC', tax_rate: '0.08', tax_type: 'inc', tax_amount: '8000.00', is_inclusive: true })],
      },
      { id: 3, subtotal_amount: '20000.00', taxes: [] },
    ],
  };
}

const SHIPPING_ORDER = {
  shipping_cost: '5000.00',
  shipping_tax_rate_id: 9,
  shipping_tax_name: 'IVA',
  shipping_tax_type: 'iva',
  shipping_tax_rate: '0.19',
  shipping_tax_amount: '798.31',
};

function accounts(discount: '10000.00' | '0.00', request: FinancialSplitRequest) {
  const result = allocateFinancialSplit(source(discount), request);
  const rows = result.accounts.map((a, i) => ({
    ...a,
    id: i + 1,
    label: `Cuenta ${i + 1}`,
    lines: a.lines.map((line, j) => ({
      ...line,
      id: i * 10 + j + 1,
      source_order_item_id: line.source_order_item_id ?? null,
      description: line.kind,
      source_snapshot: { quantity: 1 },
      taxes: line.taxes.map((tax) => ({
        ...tax,
        is_compound: tax.is_compound ?? false,
        tax_rate_id: tax.tax_rate_id ?? null,
        tax_type: tax.tax_type as 'iva',
      })),
    })),
  }));
  const shipping: FinancialAccountShippingSource = {
    source_order: SHIPPING_ORDER,
    accounts: rows.map((row) => ({ id: row.id, shipping_cost: row.shipping_cost })),
  };
  return { rows, shipping };
}

function validate(p: ReturnType<typeof projectFinancialAccountInvoice>) {
  const items = p.items.map((line, i) => ({
    line_number: i + 1,
    description: line.data.description,
    quantity: '1',
    unit_code: 'EA',
    unit_price: line.data.unit_price.toFixed(2),
    discount_amount: line.data.discount_amount.toFixed(2),
    tax_amount: line.data.tax_amount.toFixed(2),
    total_amount: line.data.total_amount.toFixed(2),
    taxes: line.taxes.map((tax) => ({
      tax_name: tax.tax_name,
      tax_type: tax.tax_type ?? undefined,
      tax_rate: tax.tax_rate.toString(),
      taxable_amount: tax.taxable_amount.toFixed(2),
      tax_amount: tax.tax_amount.toFixed(2),
    })),
  }));
  const taxes = items.flatMap((item) => item.taxes);
  const result = new FiscalDocumentValidator().validate({
    document_type: 'sales_invoice', invoice_number: 'FE6', issue_date: '2026-09-20', currency: 'COP', operation_type: '10',
    subtotal_amount: p.subtotal.toFixed(2), discount_amount: p.discount.toFixed(2),
    tax_amount: p.tax.toFixed(2), total_amount: p.total.toFixed(2), withholding_amount: '0', items, taxes,
    resolution: { id: 7, resolution_number: '18760000001', prefix: 'FE', range_from: 1, range_to: 1000, current_number: 5, valid_from: '2026-01-01', valid_to: '2026-12-31', is_active: true, technical_key: 'a1b2c3d4e5'.repeat(4) },
  } as any);
  const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(UBL_NAMESPACES.INVOICE, 'Invoice', {
    'xmlns:cac': UBL_NAMESPACES.CAC, 'xmlns:cbc': UBL_NAMESPACES.CBC, 'xmlns:ext': UBL_NAMESPACES.EXT,
  });
  const payload = { items, taxes, discount_amount: p.discount.toFixed(2), tax_amount: p.tax.toFixed(2) };
  UblCommonBuilder.buildTaxTotals(doc, taxes as any, 'COP');
  UblCommonBuilder.buildLegalMonetaryTotal(doc, payload as any, 'COP');
  UblCommonBuilder.buildInvoiceLines(doc, items as any, taxes as any, 'COP');
  const xml = doc.end({ prettyPrint: false });
  return {
    blockers: result.findings.filter((f) => f.severity === 'blocker').map((f) => `${f.code}: ${f.problem}`),
    violations: DianTotalsValidator.validate(xml).violations.map((v) => `${v.rule}: ${v.message}`),
    xml,
  };
}

const money = (value: Prisma.Decimal) => value.toFixed(2);
const sumBy = (p: ReturnType<typeof projectFinancialAccountInvoice>, type: string) =>
  p.items
    .flatMap((line) => line.taxes)
    .filter((tax) => tax.tax_type === type)
    .reduce((n, tax) => n.plus(tax.tax_amount), new Prisma.Decimal(0));

describe('financial account invoice — order discount and shipping tax', () => {
  describe.each<[string, FinancialSplitRequest]>([
    ['equal', { mode: 'equal', n_splits: 2 }],
    ['items', { mode: 'items', item_groups: [{ order_item_ids: [1] }, { order_item_ids: [2, 3] }] }],
  ])('split %s in 2 invoices', (_mode, request) => {
    const { rows, shipping } = accounts('10000.00', request);
    const invoices = rows.map((row) => projectFinancialAccountInvoice(row, 'QA-001', shipping));

    it('each partial invoice closes to its account and Σ partial invoices = order grand_total', () => {
      invoices.forEach((p, i) => expect(money(p.total)).toBe(rows[i].grand_total));
      expect(money(invoices.reduce((n, p) => n.plus(p.total), new Prisma.Decimal(0)))).toBe('242000.00');
    });

    it('header = Σ lines (net subtotal, Σ discounts, Σ taxes) and total = subtotal + tax', () => {
      for (const p of invoices) {
        const lines = p.items.map((l) => l.data);
        const s = (f: (l: (typeof lines)[number]) => Prisma.Decimal) =>
          lines.reduce((n, l) => n.plus(f(l)), new Prisma.Decimal(0));
        expect(p.subtotal.equals(s((l) => l.unit_price.minus(l.discount_amount)))).toBe(true);
        expect(p.discount.equals(s((l) => l.discount_amount))).toBe(true);
        expect(p.tax.equals(s((l) => l.tax_amount))).toBe(true);
        expect(p.subtotal.plus(p.tax).equals(p.total)).toBe(true);
        for (const line of p.items) {
          expect(line.data.unit_price.minus(line.data.discount_amount).plus(line.data.tax_amount).equals(line.data.total_amount)).toBe(true);
          for (const tax of line.taxes)
            expect(tax.taxable_amount.equals(line.data.unit_price.minus(line.data.discount_amount))).toBe(true);
        }
      }
    });

    it('declares the POST-discount tax: Σ IVA/INC of products below the pre-discount 19.000/8.000', () => {
      const productTax = (type: string) =>
        invoices.reduce(
          (n, p) =>
            n.plus(
              p.items
                .filter((l) => !l.data.description.includes('shipping'))
                .flatMap((l) => l.taxes)
                .filter((t) => t.tax_type === type)
                .reduce((m, t) => m.plus(t.tax_amount), new Prisma.Decimal(0)),
            ),
          new Prisma.Decimal(0),
        );
      expect(productTax('iva').lessThan(19000)).toBe(true);
      expect(productTax('inc').lessThan(8000)).toBe(true);
      // Reparto parejo: cada línea queda partida en las dos cuentas con la misma
      // proporción, así que la suma replica la proyección de la orden entera
      // (IVA 18.230,76 · INC 7.676,11) a ±1 ¢ por cuenta. Por productos, el
      // descuento de cada cuenta lo reparte la división (por base), no la
      // proyección de la orden (por bruto): la cuota difiere legítimamente.
      if (_mode === 'equal') {
        expect(productTax('iva').minus('18230.76').abs().lte(0.02)).toBe(true);
        expect(productTax('inc').minus('7676.11').abs().lte(0.02)).toBe(true);
      }
    });

    it('shipping tax travels from the order copy: Σ shipping IVA = 798,31 and the shipping line keeps its gross', () => {
      const shippingLines = invoices.flatMap((p) => p.items.filter((l) => l.data.description.includes('shipping')));
      expect(money(shippingLines.reduce((n, l) => n.plus(l.data.tax_amount), new Prisma.Decimal(0)))).toBe('798.31');
      expect(money(shippingLines.reduce((n, l) => n.plus(l.data.total_amount), new Prisma.Decimal(0)))).toBe('5000.00');
      for (const line of shippingLines) {
        expect(money(line.data.discount_amount)).toBe('0.00');
        expect(line.taxes).toHaveLength(1);
        expect(line.taxes[0].tax_rate.toString()).toBe('19');
      }
    });

    it('matches the accounting projection of the same account (same kernel, same tax per account)', () => {
      rows.forEach((row, i) => {
        const itemLines = row.lines.filter((l) => l.kind === 'item');
        const accounting = projectOrderDiscountedTaxes(
          itemLines.map((line) => ({
            quantity: 1,
            total_price: line.subtotal_amount,
            tax_amount_item: line.tax_amount,
            order_item_taxes: line.taxes,
          })) as any,
          { id: row.id, discount_amount: row.discount_amount, tax_amount: row.tax_amount, subtotal_amount: row.subtotal_amount } as any,
          'cuenta financiera',
        )!;
        const productTax = invoices[i].items
          .filter((l) => !l.data.description.includes('shipping'))
          .reduce((n, l) => n.plus(l.data.tax_amount), new Prisma.Decimal(0));
        expect(Math.round(productTax.toNumber() * 100)).toBe(accounting.product_tax_cents);
      });
    });

    it.each([0, 1])('account %s passes the real prevalidator and DIAN totals (FAU02/FAU04/FAU06/FAX07)', (index) => {
      const report = validate(invoices[index]);
      expect(report.blockers).toEqual([]);
      expect(report.violations).toEqual([]);
      expect(report.xml).toContain(`<cbc:PayableAmount currencyID="COP">${rows[index].grand_total}</cbc:PayableAmount>`);
    });
  });

  describe('shipping 3.000 / 2.000 in two accounts (contract with the account journal entry)', () => {
    // Custom 145.200 / 96.800 de 242.000 reparte el flete 5.000 en 3.000 / 2.000.
    const { rows, shipping } = accounts('10000.00', { mode: 'custom', n_splits: 2, amounts: ['145200.00', '96800.00'] });
    const invoices = rows.map((row) => projectFinancialAccountInvoice(row, 'QA-001', shipping));
    const shipLine = (i: number) => invoices[i].items.find((l) => l.data.description.includes('shipping'))!;

    it('splits the order shipping IVA 798,31 by gross freight: 478,99 on the 3.000 account, 319,32 on the 2.000 one', () => {
      expect(rows.map((r) => r.shipping_cost)).toEqual(['3000.00', '2000.00']);
      expect(money(shipLine(0).data.tax_amount)).toBe('478.99');
      expect(money(shipLine(0).data.unit_price)).toBe('2521.01');
      expect(money(shipLine(0).data.total_amount)).toBe('3000.00');
      expect(money(shipLine(1).data.tax_amount)).toBe('319.32');
      expect(money(shipLine(1).data.unit_price)).toBe('1680.68');
      expect(money(shipLine(0).taxes[0].taxable_amount)).toBe('2521.01');
    });

    it('invoice = journal entry per account: same shipping tax (shared function) and same product tax (same kernel)', () => {
      rows.forEach((row, i) => {
        // Exactamente lo que lee `AutoEntryService` de la cuenta.
        const entryShipping = allocateFinancialAccountShippingTax({
          id: row.id,
          shipping_cost: row.shipping_cost,
          split: { source_order: SHIPPING_ORDER, accounts: rows.map((r) => ({ id: r.id, shipping_cost: r.shipping_cost })) },
        })!;
        expect(Math.round(shipLine(i).data.tax_amount.toNumber() * 100)).toBe(Number(entryShipping.amount));
        const entryProducts = projectOrderDiscountedTaxes(
          row.lines.filter((l) => l.kind === 'item').map((line) => ({
            quantity: 1, total_price: line.subtotal_amount, tax_amount_item: line.tax_amount, order_item_taxes: line.taxes,
          })) as any,
          { id: row.id, discount_amount: row.discount_amount, tax_amount: row.tax_amount, subtotal_amount: row.subtotal_amount } as any,
          'cuenta financiera',
        )!;
        expect(Math.round(invoices[i].tax.toNumber() * 100)).toBe(entryProducts.product_tax_cents + Number(entryShipping.amount));
        expect(money(invoices[i].total)).toBe(row.grand_total);
      });
    });

    it.each([0, 1])('account %s passes the prevalidator and DIAN totals', (index) => {
      const report = validate(invoices[index]);
      expect(report.blockers).toEqual([]);
      expect(report.violations).toEqual([]);
    });
  });

  it('without order discount the invoice is identical to the historical mapping', () => {
    const { rows } = accounts('0.00', { mode: 'equal', n_splits: 2 });
    for (const row of rows) {
      const p = projectFinancialAccountInvoice(row, 'QA-001');
      row.lines.forEach((line, i) => {
        expect(money(p.items[i].data.unit_price)).toBe(line.subtotal_amount);
        expect(money(p.items[i].data.discount_amount)).toBe('0.00');
        expect(money(p.items[i].data.tax_amount)).toBe(line.tax_amount);
        expect(money(p.items[i].data.total_amount)).toBe(line.total_amount);
        p.items[i].taxes.forEach((tax, k) => expect(money(tax.tax_amount)).toBe(line.taxes[k].tax_amount));
      });
      expect(money(p.subtotal)).toBe(
        new Prisma.Decimal(row.subtotal_amount).plus(row.shipping_cost).plus(row.tip_amount).toFixed(2),
      );
      expect(money(p.tax)).toBe(row.tax_amount);
      expect(money(p.total)).toBe(row.grand_total);
    }
  });

  it('without shipping copy the shipping line stays gross and untaxed', () => {
    const { rows } = accounts('10000.00', { mode: 'equal', n_splits: 2 });
    const p = projectFinancialAccountInvoice(rows[0], 'QA', { source_order: { shipping_cost: '5000.00', shipping_tax_amount: 0 }, accounts: [] });
    const ship = p.items.find((l) => l.data.description.includes('shipping'))!;
    expect(money(ship.data.unit_price)).toBe(rows[0].shipping_cost);
    expect(ship.taxes).toEqual([]);
    expect(money(p.total)).toBe(rows[0].grand_total);
    expect(sumBy(p, 'iva').greaterThan(0)).toBe(true);
  });

  it('rejects an incoherent shipping copy before persistence instead of dropping the tax', () => {
    const { rows, shipping } = accounts('10000.00', { mode: 'equal', n_splits: 2 });
    expect(() =>
      projectFinancialAccountInvoice(rows[0], 'QA', { ...shipping, source_order: { ...SHIPPING_ORDER, shipping_tax_rate: 0 } }),
    ).toThrow(/copia del impuesto del envío incoherente/);
  });

  it('rejects a compound row under a discount (projection cannot clear it) with an operator message', () => {
    const { rows } = accounts('10000.00', { mode: 'equal', n_splits: 2 });
    const row = { ...rows[0], lines: rows[0].lines.map((l) => ({ ...l, taxes: l.taxes.map((t) => ({ ...t, is_compound: true })) })) };
    expect(() => projectFinancialAccountInvoice(row, 'QA')).toThrow(/No se creó la factura/);
  });
});
