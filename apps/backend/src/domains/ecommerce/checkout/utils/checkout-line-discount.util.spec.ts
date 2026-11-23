import { applyCheckoutLineDiscounts } from './checkout-line-discount.util';
import { promotionDiscountByLine } from '../../../store/promotions/promotion-line-discount.util';
import { projectOrderInvoiceLines } from '../../../store/invoicing/utils/order-invoice-lines.util';

/**
 * F1 en ecommerce: el checkout persiste el contrato NUEVO (descuento de base
 * por línea, impuesto post-descuento) con el mismo kernel del POS, y la
 * factura lo lee tal cual en vez de repartir `orders.discount_amount` entre
 * todas las líneas.
 */
describe('applyCheckoutLineDiscounts — contrato nuevo de descuento en ecommerce', () => {
  // A = 119.000 (IVA 19 % incluido, base 100.000) · B = 100.000 (excluido).
  const A = {
    quantity: 1,
    total_net: 100000,
    total_tax: 19000,
    item_taxes: [{ rate: 0.19, amount: 19000, tax_type: 'iva', tax_rate_id: 1, name: 'IVA 19%' }],
  };
  const B = { quantity: 1, total_net: 100000, total_tax: 0, item_taxes: [] };

  const quote = (byLine: number[], scope = 'product') => {
    const total = byLine.reduce((s, v) => s + v, 0);
    return {
      total_discount: total,
      applied_promotions: [{ scope, discount_amount: total }] as any,
      items: byLine.map((promotion_discount, line_id) => ({ line_id, promotion_discount })) as any,
    };
  };

  /** Lo que persiste `orders.create` y luego lee la factura. */
  const persist = (
    lines: Array<typeof A | typeof B>,
    result: NonNullable<ReturnType<typeof applyCheckoutLineDiscounts>>,
  ) =>
    lines.map((line, i) => ({
      quantity: line.quantity,
      total_price: line.total_net,
      discount_amount: result.lines[i].discount_amount,
      tax_amount_item: result.lines[i].tax_amount_item,
      order_item_taxes: line.item_taxes.map((t, k) => ({
        tax_name: t.name,
        tax_rate: t.rate,
        tax_type: t.tax_type,
        tax_amount: result.lines[i].tax_amounts[k],
        is_inclusive: true,
      })),
    }));

  const split = (q: ReturnType<typeof quote>, coupon = 0) => ({
    promotionTotal: q.total_discount,
    couponTotal: coupon,
    promotionByLine: promotionDiscountByLine(q, 2, (id) => Number(id)),
  });

  it('escenario A hasta la factura: A base 90.000 / desc. 10.000 / IVA 17.100; B intacta; total 207.100', () => {
    const result = applyCheckoutLineDiscounts([A, B], split(quote([11900, 0])))!;
    expect(result.total_tax).toBe(17100);
    expect(result.total_base_discount).toBe(10000);
    const grandTotal = 200000 + result.total_tax - result.total_base_discount;
    expect(grandTotal).toBe(207100);

    const invoice = projectOrderInvoiceLines(persist([A, B], result), result.total_base_discount);
    expect(invoice.error).toBeUndefined();
    expect(
      invoice.lines.map((l) => [l.base.toNumber(), l.discount.toNumber(), l.tax_total.toNumber()]),
    ).toEqual([
      [90000, 10000, 17100],
      [100000, 0, 0],
    ]);
  });

  it('escenario B hasta la factura: IVA 19.000 completo, B base 90.000; total 209.000', () => {
    const result = applyCheckoutLineDiscounts([A, B], split(quote([0, 10000])))!;
    expect(result.total_tax).toBe(19000);
    const invoice = projectOrderInvoiceLines(persist([A, B], result), result.total_base_discount);
    expect(
      invoice.lines.map((l) => [l.base.toNumber(), l.tax_total.toNumber()]),
    ).toEqual([
      [100000, 19000],
      [90000, 0],
    ]);
    expect(200000 + result.total_tax - result.total_base_discount).toBe(209000);
  });

  it('pedido de 1 producto 119.000 con promo 10 %: la orden ya guarda IVA 17.100 (F7) y cobra 107.100', () => {
    const result = applyCheckoutLineDiscounts(
      [A],
      { promotionTotal: 11900, couponTotal: 0, promotionByLine: [11900] },
    )!;
    expect(result.total_tax).toBe(17100);
    expect(result.total_base_discount).toBe(10000);
    expect(100000 + result.total_tax - result.total_base_discount).toBe(107100);
    expect(result.lines[0]).toEqual({ discount_amount: 10000, tax_amounts: [17100], tax_amount_item: 17100 });
  });

  it('regresión: promoción de ORDEN con tarifas mezcladas factura igual que el contrato legado', () => {
    const q = quote([11900, 10000], 'order');
    const result = applyCheckoutLineDiscounts([A, B], split(q))!;
    const nuevo = projectOrderInvoiceLines(persist([A, B], result), result.total_base_discount);
    // Orden legada (antes del fix): descuento bruto en la cabecera, líneas sin descuento.
    const legado = projectOrderInvoiceLines(
      [
        { quantity: 1, total_price: 100000, discount_amount: null, tax_amount_item: 19000,
          order_item_taxes: [{ tax_name: 'IVA 19%', tax_rate: 0.19, tax_amount: 19000, tax_type: 'iva' }] },
        { quantity: 1, total_price: 100000, discount_amount: null, tax_amount_item: 0, order_item_taxes: [] },
      ],
      21900,
    );
    const shape = (p: typeof nuevo) =>
      p.lines.map((l) => [l.base.toNumber(), l.tax_total.toNumber()]);
    expect(shape(nuevo)).toEqual(shape(legado));
    expect(shape(nuevo)).toEqual([
      [90000, 17100],
      [90000, 0],
    ]);
  });

  it('promo de producto + cupón: el cupón cae sobre el bruto remanente de todas las líneas', () => {
    const result = applyCheckoutLineDiscounts([A, B], split(quote([11900, 0]), 20710))!;
    expect(result.lines.map((l) => l.discount_amount)).toEqual([19000, 10000]);
    expect(result.total_tax).toBe(15390);
    expect(200000 + result.total_tax - result.total_base_discount).toBe(186390);
  });

  it('sin descuento no toca la orden (contrato legado intacto)', () => {
    expect(
      applyCheckoutLineDiscounts([A, B], { promotionTotal: 0, couponTotal: 0, promotionByLine: null }),
    ).toBeNull();
  });
});
