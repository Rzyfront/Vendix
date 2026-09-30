import { Prisma } from '@prisma/client';
import { buildManualRefundFiscalPayload } from './manual-refund-accounting.util';

const D = (value: number | string) => new Prisma.Decimal(value);

const order = () => ({
  grand_total: D(133), tip_amount: D(10), tax_amount: D(11), shipping_cost: D(12),
  shipping_tax_amount: D(2), shipping_tax_type: 'iva',
  order_items: [{ order_item_taxes: [
    { tax_type: 'inc', tax_amount: D(8) },
    { tax_type: 'iva', tax_amount: D(3) },
  ] }],
});
const refund = (overrides: Record<string, unknown> = {}) => ({
  id: 1, amount: D(133), subtotal_refund: D(100), tax_refund: D(11),
  shipping_refund: D(12), notes: 'Cancelación; pagos en efectivo: 1', refund_items: [], ...overrides,
});

describe('manual refund fiscal reconstruction', () => {
  it('separates tip liability, typed product taxes and tax inside gross shipping', () => {
    const result = buildManualRefundFiscalPayload(order(), refund(), []);
    expect(result).toEqual(expect.objectContaining({
      amount: 133, subtotal: 100, tip_amount: 10, shipping: 12,
      tax_amount: 13, is_full_refund: true,
      tax_breakdown: expect.arrayContaining([
        { tax_type: 'inc', tax_amount: 8 },
        { tax_type: 'iva', tax_amount: 3 },
        { tax_type: 'iva', tax_amount: 2 },
      ]),
    }));
  });

  it('does not relabel an unexplained historical fee as a tip', () => {
    expect(() => buildManualRefundFiscalPayload(
      { ...order(), tip_amount: D(0) }, refund(), [],
    )).toThrow(/REF_TAX_BREAKDOWN_MISSING_001/);
  });

  it('recovers an existing cancellation row whose subtotal embedded tip', () => {
    const legacy = refund({ subtotal_refund: D(110) });
    const result = buildManualRefundFiscalPayload(order(), legacy, []);
    expect(result).toEqual(expect.objectContaining({ subtotal: 100, tip_amount: 10 }));
  });

  it('leaves an unmarked legacy row unresolved rather than assuming its subtotal contains tip', () => {
    expect(() => buildManualRefundFiscalPayload(order(),
      refund({ subtotal_refund: D(110), notes: 'manual payout' }), [],
    )).toThrow(/lacks cancellation evidence/);
  });

  it('fails closed when product tax cannot be typed', () => {
    expect(() => buildManualRefundFiscalPayload(
      { ...order(), order_items: [] }, refund(), [],
    )).toThrow(/product tax has no typed source/);
  });

  it('does not allocate more tip than remains after earlier completed refunds', () => {
    const prior = refund({ id: 2, amount: D(5), subtotal_refund: D(0), tax_refund: D(0), shipping_refund: D(0) });
    expect(() => buildManualRefundFiscalPayload(order(), refund(), [prior])).toThrow(/available tip/);
  });

  it('accepts the ADR-12 leg marker as cancellation evidence (PR #843 finding 2)', () => {
    const adr12 = refund({ subtotal_refund: D(110), notes: 'Cancelación ADR-12; pierna pago #7 (tarjeta)' });
    const result = buildManualRefundFiscalPayload(order(), adr12, []);
    expect(result).toEqual(expect.objectContaining({ subtotal: 100, tip_amount: 10 }));
  });
});
