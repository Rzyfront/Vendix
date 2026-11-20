import { Logger } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { projectOrderInvoiceLines } from '../invoicing/utils/order-invoice-lines.util';

/**
 * F1 — una promoción de producto/categoría/escala se reparte SÓLO entre las
 * líneas a las que el motor la aplicó (antes: entre todas, proporcional al
 * bruto, y con tarifas mezcladas el IVA de la factura quedaba mal declarado).
 *
 * Escenario A del informe: A = 119.000 (IVA 19 % incluido, base 100.000) y
 * B = 100.000 (excluido). Promo 10 % de producto sobre A ⇒ 11.900 en bruto.
 */
describe('PaymentsService — reparto por línea de la promoción (F1)', () => {
  let svc: any;

  beforeEach(() => {
    svc = Object.create(PaymentsService.prototype);
    svc.logger = new Logger('spec');
  });

  const lineA = () => ({
    product_id: 1,
    quantity: 1,
    total_price: 100000,
    tax_amount_item: 19000,
    order_item_taxes: {
      create: [
        { tax_rate: 0.19, tax_amount: 19000, tax_type: 'iva', tax_rate_id: 1, tax_name: 'IVA 19%' },
      ],
    },
  });
  const lineB = () => ({
    product_id: 2,
    quantity: 1,
    total_price: 100000,
    tax_amount_item: 0,
    order_item_taxes: { create: [] as any[] },
  });

  const productQuote = (discountByLine: Array<[number, number]>, scope = 'product') => {
    const total = discountByLine.reduce((s, [, d]) => s + d, 0);
    return {
      total_discount: total,
      applied_promotions: [{ promotion_id: 9, scope, discount_amount: total }],
      items: discountByLine.map(([line_id, promotion_discount]) => ({
        line_id,
        promotion_discount,
      })),
      order_promotions_snapshot: [{ promotion_id: 9, discount_amount: total }],
    };
  };

  /** Lo que lee la factura: filas de impuesto como arreglo (post-insert). */
  const persisted = (items: any[]) =>
    items.map((item) => ({
      ...item,
      order_item_taxes: item.order_item_taxes.create,
    }));

  it('venta nueva, escenario A: A descuento base 10.000 / base 90.000 / IVA 17.100; B sin descuento; total 207.100', () => {
    const items = [lineA(), lineB()];
    const quote = productQuote([[0, 11900], [1, 0]]);
    const split = svc.buildPosDiscountSplit(quote, 0, items.length, (i: number) => i);
    const result = svc.retaxPosOrderItemsAfterDiscount(items, 11900, split);

    expect(items[0].discount_amount).toBe(10000);
    expect(items[0].order_item_taxes.create[0].tax_amount).toBe(17100);
    expect(items[1].discount_amount).toBe(0);
    expect(result).toEqual({ tax_amount: 17100, discount_amount_base: 10000 });
    const grandTotal = 200000 + result.tax_amount - result.discount_amount_base;
    expect(grandTotal).toBe(207100);

    // La factura (contrato nuevo) declara exactamente eso.
    const invoice = projectOrderInvoiceLines(persisted(items), result.discount_amount_base);
    expect(invoice.error).toBeUndefined();
    expect(invoice.lines.map((l) => [l.base.toNumber(), l.discount.toNumber(), l.tax_total.toNumber()])).toEqual([
      [90000, 10000, 17100],
      [100000, 0, 0],
    ]);
  });

  it('venta nueva, escenario B (promo sobre el excluido): IVA 19.000 completo, B base 90.000, total 209.000', () => {
    const items = [lineA(), lineB()];
    const quote = productQuote([[0, 0], [1, 10000]]);
    const split = svc.buildPosDiscountSplit(quote, 0, items.length, (i: number) => i);
    const result = svc.retaxPosOrderItemsAfterDiscount(items, 10000, split);

    expect(items[0].discount_amount).toBe(0);
    expect(items[0].order_item_taxes.create[0].tax_amount).toBe(19000);
    expect(items[1].discount_amount).toBe(10000);
    expect(result).toEqual({ tax_amount: 19000, discount_amount_base: 10000 });
    expect(200000 + result.tax_amount - result.discount_amount_base).toBe(209000);
  });

  it('regresión: una promoción de ORDEN con tarifas mezcladas se reparte por bruto como hoy', () => {
    const today = [lineA(), lineB()];
    const legacy = svc.retaxPosOrderItemsAfterDiscount(today, 21910);

    const items = [lineA(), lineB()];
    const quote = productQuote([[0, 11900], [1, 10010]], 'order');
    const split = svc.buildPosDiscountSplit(quote, 0, items.length, (i: number) => i);
    expect(split.promotionByLine).toBeNull();
    const result = svc.retaxPosOrderItemsAfterDiscount(items, 21910, split);

    expect(result).toEqual(legacy);
    expect(items.map((i: any) => i.discount_amount)).toEqual(today.map((i: any) => i.discount_amount));
    expect(items[0].order_item_taxes.create[0].tax_amount).toBe(
      today[0].order_item_taxes.create[0].tax_amount,
    );
  });

  it('promo de producto + cupón: la promo queda en A y el cupón se reparte sobre el bruto remanente', () => {
    const items = [lineA(), lineB()];
    const quote = productQuote([[0, 11900], [1, 0]]);
    // Cupón 10 % sobre el remanente 207.100 = 20.710.
    const split = svc.buildPosDiscountSplit(quote, 20710, items.length, (i: number) => i);
    const result = svc.retaxPosOrderItemsAfterDiscount(items, 32610, split);

    // A: 11.900 + 10.710 = 22.610 bruto ⇒ base 81.000, IVA 15.390.
    // B: 10.000 bruto ⇒ base 90.000.
    expect(items[0].discount_amount).toBe(19000);
    expect(items[0].order_item_taxes.create[0].tax_amount).toBe(15390);
    expect(items[1].discount_amount).toBe(10000);
    expect(200000 + result.tax_amount - result.discount_amount_base).toBe(186390);
  });

  it('el line_id que recibe el motor es el índice ORIGINAL de dto.items (los ítems custom no corren los índices)', async () => {
    const quoteDiscounts = jest.fn().mockResolvedValue({ total_discount: 0, items: [] });
    svc.promotionEngine = {
      quoteDiscounts,
      resolveDiscountCode: jest.fn().mockResolvedValue({ kind: 'none' }),
    };
    await svc.calculatePosPromotionQuote({
      items: [
        { item_type: 'custom', product_name: 'Bolsa', quantity: 1, unit_price: 100 },
        { product_id: 1, product_name: 'A', quantity: 1, unit_price: 100000, final_unit_price: 119000 },
        { product_id: 2, product_name: 'B', quantity: 1, unit_price: 100000, final_unit_price: 100000 },
      ],
    });
    const input = quoteDiscounts.mock.calls[0][0];
    expect(input.items.map((i: any) => [i.line_id, i.product_id])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('con un ítem custom intercalado la promo cae en su línea, no en la del ítem custom', () => {
    const custom = {
      quantity: 1,
      total_price: 5000,
      tax_amount_item: 0,
      order_item_taxes: { create: [] as any[] },
    };
    const items = [custom, lineA(), lineB()];
    const quote = productQuote([[1, 11900], [2, 0]]);
    const split = svc.buildPosDiscountSplit(quote, 0, items.length, (i: number) => i);
    svc.retaxPosOrderItemsAfterDiscount(items, 11900, split);
    expect(items.map((i: any) => i.discount_amount)).toEqual([0, 10000, 0]);
  });

  it('cierre de mesa: la promo de las líneas nuevas va a ellas (índice tras las persistidas)', async () => {
    const tx = {
      order_items: { update: jest.fn().mockResolvedValue({}) },
      order_item_taxes: { update: jest.fn().mockResolvedValue({}) },
    };
    const existing = [
      {
        id: 50,
        quantity: 1,
        total_price: 100000,
        tax_amount_item: 0,
        discount_amount: 0,
        order_item_taxes: [] as any[],
      },
    ];
    const fresh = [lineA()];
    const quote = productQuote([[0, 11900]]);
    const split = svc.buildPosDiscountSplit(quote, 0, 2, (i: number) =>
      i < fresh.length ? existing.length + i : null,
    );
    const result = await svc.retaxMergedPosOrderItemsForTableClose(
      tx,
      existing,
      fresh,
      11900,
      split,
    );
    expect(result).toEqual({ tax_amount: 17100, discount_amount_base: 10000 });
    expect(tx.order_items.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: expect.objectContaining({ discount_amount: 0 }),
    });
    expect((fresh[0] as any).discount_amount).toBe(10000);
  });

  it('orden adoptada: empareja el dto con las líneas persistidas por producto/variante/cantidad', () => {
    const map = svc.matchDtoItemsToPersistedLines(
      [
        { product_id: 2, quantity: 1 },
        { product_id: 1, quantity: 1 },
        { product_id: 3, quantity: 4 },
      ],
      [
        { id: 7, product_id: 1, product_variant_id: null, quantity: 1 },
        { id: 8, product_id: 2, product_variant_id: null, quantity: 1 },
      ],
    );
    expect(map).toEqual([1, 0, null]);

    // Si una línea con descuento no se ubica ⇒ reparto histórico por bruto.
    const split = svc.buildPosDiscountSplit(
      productQuote([[2, 500]]),
      0,
      2,
      (i: number) => map[i] ?? null,
    );
    expect(split.promotionByLine).toBeNull();
  });
});
