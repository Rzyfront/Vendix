import { Logger } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { OpenOrderPromotionService } from '../promotions/open-order-promotion.service';

/**
 * Promoción de PRODUCTO en una cuenta de mesa (hotfix promos-mesa).
 *
 * Caso real: Pollo Árabe (store 105), promo 61 «-30 % en pincho pollo»
 * (percentage, scope product, auto) sobre el producto 4273, 30.000 con INC
 * 8 % incluido. Orden de mesa 22748: Pollo Entero 59.000, Pinchos 2 × 30.000
 * y Gaseosa 10.800 ⇒ 129.800 sin promo, 111.800 con promo.
 *
 * Antes: `addItems` dejaba `discount = 0` y el cobro cotizaba sólo
 * `dto.items` (vacío al cobrar desde la mesa) ⇒ la promo nunca aplicaba.
 */
describe('Cuenta de mesa con promoción de producto', () => {
  const ORDER_ID = 22748;
  const PINCHOS = 4273;

  /** Línea persistida INC 8 % incluido (base + filas, como `addItems`). */
  const line = (
    id: number,
    productId: number,
    quantity: number,
    gross: number,
  ): any => {
    const unitBase = Math.round((gross / 1.08) * 100) / 100;
    const total = Math.round(((gross * quantity) / 1.08) * 100) / 100;
    const tax = Math.round((gross * quantity - total) * 100) / 100;
    return {
      id,
      order_id: ORDER_ID,
      product_id: productId,
      product_variant_id: null,
      quantity,
      unit_price: unitBase,
      total_price: total,
      tax_rate: 0.08,
      tax_amount_item: Math.round((tax / quantity) * 100) / 100,
      final_unit_price: gross,
      discount_amount: null,
      weight: null,
      price_unit_quantity: null,
      cancelled_at: null,
      order_item_taxes: [
        {
          id: id * 10,
          tax_rate: 0.08,
          tax_amount: tax,
          tax_type: 'inc',
          tax_rate_id: 8,
          tax_name: 'INC 8%',
        },
      ],
    };
  };

  let lines: any[];
  let tx: any;
  let engine: { quoteDiscounts: jest.Mock; resolveDiscountCode: jest.Mock; applyPromotion: jest.Mock };
  let ordersUpdate: jest.Mock;

  beforeEach(() => {
    lines = [
      line(1, 4001, 1, 59000), // Pollo Entero
      line(2, PINCHOS, 2, 30000), // Pinchos de pollo
      line(3, 4002, 1, 10800), // Gaseosa
    ];
    ordersUpdate = jest.fn(async (args: any) => ({
      id: ORDER_ID,
      ...args.data,
      order_items: [],
    }));
    const model = (methods: Record<string, jest.Mock>) =>
      new Proxy(methods, {
        get: (t, m: string) =>
          t[m] ?? jest.fn().mockResolvedValue(m === 'findMany' ? [] : null),
      });
    tx = new Proxy(
      {
        table_sessions: model({
          findUnique: jest.fn().mockResolvedValue({
            id: 5,
            store_id: 105,
            closed_at: null,
            order_id: ORDER_ID,
            order: { id: ORDER_ID, store_id: 105, customer_id: null },
          }),
        }),
        orders: model({
          findFirst: jest.fn().mockResolvedValue({ customer_id: null }),
          update: ordersUpdate,
        }),
        order_items: model({
          findMany: jest.fn(async (args: any) =>
            args?.where?.products ? [] : lines.filter((l) => !l.cancelled_at),
          ),
          update: jest.fn(async ({ where, data }: any) => {
            Object.assign(lines.find((l) => l.id === where.id), data);
            return {};
          }),
        }),
        order_item_taxes: model({
          update: jest.fn(async ({ where, data }: any) => {
            for (const l of lines) {
              const row = l.order_item_taxes.find((r: any) => r.id === where.id);
              if (row) Object.assign(row, data);
            }
            return {};
          }),
        }),
        order_promotions: model({
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
        }),
      },
      { get: (t: any, m: string) => t[m] ?? model({}) },
    );

    // Motor: -30 % de producto sobre PINCHOS, calculado de lo que RECIBE
    // (precio bruto pre-descuento × cantidad), como el motor real.
    engine = {
      resolveDiscountCode: jest.fn().mockResolvedValue({ kind: 'none' }),
      applyPromotion: jest.fn(),
      quoteDiscounts: jest.fn(async (input: any) => {
        const items = input.items.map((item: any) => ({
          line_id: item.line_id,
          product_id: item.product_id,
          promotion_discount:
            item.product_id === PINCHOS
              ? Math.round(item.unit_price * item.quantity * 0.3 * 100) / 100
              : 0,
        }));
        const total = items.reduce(
          (s: number, i: any) => s + i.promotion_discount,
          0,
        );
        return {
          total_discount: total,
          applied_promotions:
            total > 0
              ? [{ promotion_id: 61, scope: 'product', discount_amount: total }]
              : [],
          items,
          order_promotions_snapshot:
            total > 0 ? [{ promotion_id: 61, discount_amount: total }] : [],
        };
      }),
    };
  });

  const openAccount = () => new OpenOrderPromotionService(engine as any);

  const payments = (): any => {
    const svc: any = Object.create(PaymentsService.prototype);
    svc.logger = new Logger('spec');
    svc.promotionEngine = engine;
    svc.prisma = { order_promotions: { findMany: jest.fn().mockResolvedValue([]) } };
    jest.spyOn(svc, 'assertPosTipPolicy').mockResolvedValue(undefined);
    jest.spyOn(svc, 'orderHasSerializedItems').mockResolvedValue(false);
    return svc;
  };
  const charge = (svc: any) =>
    svc.applyPosPaymentToTableSession(
      tx,
      { store_id: 105, table_session_id: 5, items: [] },
      { id: 1 },
      105,
    );

  const snapshot = () =>
    lines.map((l) => ({
      id: l.id,
      discount_amount: l.discount_amount,
      tax_amount_item: l.tax_amount_item,
      tax: l.order_item_taxes[0].tax_amount,
    }));

  it('la cuenta abierta muestra la promo: Pinchos −30 % (descuento base 16.666,67; 42.000 por los 2) y las demás líneas intactas', async () => {
    const result = await openAccount().repriceInTx(tx, ORDER_ID);

    const input = engine.quoteDiscounts.mock.calls[0][0];
    expect(input.exclude_order_id).toBe(ORDER_ID);
    expect(input.items.map((i: any) => [i.line_id, i.unit_price, i.quantity])).toEqual([
      [0, 59000, 1],
      [1, 30000, 2],
      [2, 10800, 1],
    ]);

    const pinchos = lines[1];
    expect(pinchos.discount_amount).toBe(16666.67);
    expect(pinchos.order_item_taxes[0].tax_amount).toBe(3111.11);
    // 21.000 c/u con impuesto: base 19.444,44 + INC 1.555,56.
    expect(pinchos.tax_amount_item).toBe(1555.56);
    expect(pinchos.total_price).toBe(55555.56); // la base nunca se muta
    expect(
      Math.round(
        (pinchos.total_price - pinchos.discount_amount + pinchos.order_item_taxes[0].tax_amount) * 100,
      ) / 100,
    ).toBe(42000);

    expect(lines[0].discount_amount).toBe(0);
    expect(lines[0].order_item_taxes[0].tax_amount).toBe(4370.37);
    expect(lines[2].discount_amount).toBe(0);
    expect(lines[2].order_item_taxes[0].tax_amount).toBe(800);

    expect(result.discount_amount).toBe(16666.67);
    expect(result.items_total).toBe(111800);
    // Al agregar NO se registra la promo ni se consume cupo.
    expect(engine.applyPromotion).not.toHaveBeenCalled();
    expect(tx.order_promotions.create).not.toHaveBeenCalled();
  });

  it('recotizar la cuenta dos veces no compone el descuento', async () => {
    const first = await openAccount().repriceInTx(tx, ORDER_ID);
    const afterFirst = snapshot();
    const second = await openAccount().repriceInTx(tx, ORDER_ID);
    expect(second).toEqual(first);
    expect(snapshot()).toEqual(afterFirst);
  });

  it('si el motor falla la cuenta queda sin descuento y restituye el impuesto', async () => {
    await openAccount().repriceInTx(tx, ORDER_ID);
    engine.quoteDiscounts.mockRejectedValueOnce(new Error('boom'));
    const result = await openAccount().repriceInTx(tx, ORDER_ID);
    expect(result.discount_amount).toBe(0);
    expect(result.items_total).toBe(129800);
    expect(lines[1].discount_amount).toBe(0);
    expect(lines[1].order_item_taxes[0].tax_amount).toBe(4444.44);
    expect(lines[1].tax_amount_item).toBe(2222.22);
  });

  it('un ítem cancelado sale de la cotización y un ítem custom no se cotiza', async () => {
    lines[1].cancelled_at = new Date();
    lines.push({ ...line(4, 0, 1, 5000), product_id: null, order_item_taxes: [] });
    const result = await openAccount().repriceInTx(tx, ORDER_ID);
    expect(
      engine.quoteDiscounts.mock.calls[0][0].items.map((i: any) => i.product_id),
    ).toEqual([4001, 4002]);
    expect(result.discount_amount).toBe(0);
  });

  it('cobro desde la mesa (dto.items vacío): la promo llega a la línea persistida y el total es 111.800', async () => {
    // Estado de producción: orden 22748 con `discount_amount = 0`.
    const result = await charge(payments());

    const data = ordersUpdate.mock.calls[0][0].data;
    expect(data.subtotal_amount).toBe(120185.19);
    expect(data.discount_amount).toBe(16666.67);
    expect(data.tax_amount).toBe(8281.48);
    expect(data.grand_total).toBe(111800);
    expect(lines[1].discount_amount).toBe(16666.67);
    expect(lines[1].order_item_taxes[0].tax_amount).toBe(3111.11);
    expect(lines[0].discount_amount).toBe(0);
    expect(lines[2].discount_amount).toBe(0);
    // El snapshot para `order_promotions` sale del cobro.
    expect(result.promotionsSnapshot).toEqual([
      { promotion_id: 61, discount_amount: 18000 },
    ]);
  });

  it('el cobro posterior da exactamente lo que la cuenta abierta mostró', async () => {
    const shown = await openAccount().repriceInTx(tx, ORDER_ID);
    const shownLines = snapshot();

    await charge(payments());

    const data = ordersUpdate.mock.calls[0][0].data;
    expect(data.grand_total).toBe(shown.items_total);
    expect(data.discount_amount).toBe(shown.discount_amount);
    expect(data.tax_amount).toBe(shown.tax_amount);
    expect(snapshot()).toEqual(shownLines);
  });

  it('líneas nuevas del cobro: su line_id sigue a las persistidas en el arreglo combinado', async () => {
    const svc = payments();
    await svc.calculatePosPromotionQuote(
      {
        items: [
          { item_type: 'custom', product_name: 'Bolsa', quantity: 1, unit_price: 100 },
          { product_id: PINCHOS, quantity: 1, unit_price: 27777.78, final_unit_price: 30000 },
        ],
      },
      ORDER_ID,
      {
        items: [{ line_id: 0, product_id: 4001, unit_price: 59000, quantity: 1 }],
        lineOffset: 3,
      },
    );
    const input = engine.quoteDiscounts.mock.calls[0][0];
    expect(input.items.map((i: any) => [i.line_id, i.product_id])).toEqual([
      [0, 4001],
      [4, PINCHOS],
    ]);
  });
});
