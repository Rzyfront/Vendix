import {
  computePaymentSaleShare,
  resolvePaymentReceivedSaleFields,
} from './payment-sale-share.util';

/**
 * Cuenta dividida: la porción de venta de cada pago debe cuadrar el asiento de
 * `payment.received` (rama sin factura):
 *   DR caja (amount) + DR descuento = CR ingreso bruto + impuesto + flete + propina
 * y Σ porciones = totales de la orden.
 */
describe('computePaymentSaleShare', () => {
  // subtotal 10.000, descuento 1.000, IVA 1.710, flete neto 5.000, propina 900
  // ⇒ grand_total 16.610.
  const ORDER = {
    subtotal_amount: 10000,
    discount_amount: 1000,
    tax_amount: 1710,
    shipping_amount: 5000,
    tip_amount: 900,
    grand_total: 16610,
  };
  const cents = (n: number) => Math.round(n * 100);
  const balances = (amount: number, s: any) =>
    cents(amount) + cents(s.discount_amount) ===
    cents(s.subtotal_amount) +
      cents(s.tax_amount) +
      cents(s.shipping_amount) +
      cents(s.tip_amount);

  it('pago único por el total ⇒ totales de la orden intactos', () => {
    const share = computePaymentSaleShare({
      ...ORDER,
      amount: ORDER.grand_total,
      prior_amounts: [],
    });
    expect(share).toEqual({
      subtotal_amount: 10000,
      discount_amount: 1000,
      tax_amount: 1710,
      shipping_amount: 5000,
      tip_amount: 900,
    });
    expect(balances(ORDER.grand_total, share)).toBe(true);
  });

  it('tres pagos desiguales: cada asiento cuadra (D=C) y el último toma el remanente exacto', () => {
    const amounts = [3333.33, 7000.01, 6276.66];
    const shares = amounts.map((amount, i) =>
      computePaymentSaleShare({
        ...ORDER,
        amount,
        prior_amounts: amounts.slice(0, i),
      }),
    );
    shares.forEach((share, i) => {
      expect(share).not.toBeNull();
      expect(balances(amounts[i], share)).toBe(true);
    });
    const total = (key: string) =>
      shares.reduce((acc, s: any) => acc + cents(s[key]), 0) / 100;
    expect(total('subtotal_amount')).toBe(10000);
    expect(total('discount_amount')).toBe(1000);
    expect(total('tax_amount')).toBe(1710);
    expect(total('shipping_amount')).toBe(5000);
    expect(total('tip_amount')).toBe(900);
  });

  it('pago que excede lo que queda por reconocer ⇒ null (payload histórico)', () => {
    expect(
      computePaymentSaleShare({
        ...ORDER,
        amount: 10000,
        prior_amounts: [10000],
      }),
    ).toBeNull();
  });

  it('componentes que no suman el total de la orden ⇒ null', () => {
    expect(
      computePaymentSaleShare({
        ...ORDER,
        grand_total: 99999,
        amount: 100,
        prior_amounts: [],
      }),
    ).toBeNull();
  });
});

describe('resolvePaymentReceivedSaleFields', () => {
  it('suma el impuesto del envío al impuesto y deja el flete NETO', async () => {
    const tx = {
      orders: {
        findUnique: jest.fn().mockResolvedValue({
          subtotal_amount: 10000,
          discount_amount: 0,
          tax_amount: 1900,
          shipping_cost: 1190,
          shipping_tax_amount: 190,
          tip_amount: 0,
          grand_total: 13090,
        }),
      },
      payments: {
        findMany: jest.fn().mockResolvedValue([{ amount: 6545 }]),
      },
    };

    const fields = await resolvePaymentReceivedSaleFields(tx, {
      order_id: 70,
      payment_id: 902,
      amount: 6545,
    });

    // Segundo (último) pago: remanente exacto de cada componente.
    expect(fields).toEqual({
      subtotal_amount: 5000,
      discount_amount: 0,
      tax_amount: 1045,
      shipping_amount: 500,
      tip_amount: 0,
    });
    expect(tx.payments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          order_id: 70,
          state: { in: ['succeeded', 'captured'] },
          id: { not: 902 },
        },
      }),
    );
  });

  it('sin orden ⇒ payload histórico en cero', async () => {
    const tx = {
      orders: { findUnique: jest.fn().mockResolvedValue(null) },
      payments: { findMany: jest.fn() },
    };
    await expect(
      resolvePaymentReceivedSaleFields(tx, {
        order_id: 1,
        payment_id: 1,
        amount: 10,
      }),
    ).resolves.toEqual({
      subtotal_amount: 0,
      tax_amount: 0,
      discount_amount: 0,
      tip_amount: 0,
    });
  });

  it('descuento de orden en cuenta dividida: el impuesto de cada porción sale de la proyección de la factura y cada asiento cuadra', async () => {
    // Caso de invoicing.service.order-discount.spec.ts (IVA 19 % + INC 8 % +
    // exento + envío con IVA, descuento 10.000 ⇒ 242.000), pagado 142.000 + 100.000.
    const order = {
      subtotal_amount: 220000,
      discount_amount: 10000,
      tax_amount: 27000,
      shipping_cost: 5000,
      shipping_tax_type: 'iva',
      shipping_tax_rate: 0.19,
      shipping_tax_amount: 798.31,
      tip_amount: 0,
      grand_total: 242000,
      order_items: [
        {
          quantity: 2,
          total_price: 100000,
          tax_amount_item: 9500,
          order_item_taxes: [{ tax_type: 'iva', tax_rate: 0.19, tax_amount: 19000 }],
        },
        {
          quantity: 1,
          total_price: 100000,
          tax_amount_item: 8000,
          order_item_taxes: [{ tax_type: 'inc', tax_rate: 0.08, tax_amount: 8000 }],
        },
        { quantity: 1, total_price: 20000, tax_amount_item: 0, order_item_taxes: [] },
      ],
    };
    const c = (n: number) => Math.round(n * 100);
    const run = async (payment_id: number, amount: number, prior: number[]) =>
      resolvePaymentReceivedSaleFields(
        {
          orders: { findUnique: jest.fn().mockResolvedValue(order) },
          payments: {
            findMany: jest
              .fn()
              .mockResolvedValue(prior.map((value) => ({ amount: value }))),
          },
        },
        { order_id: 70, payment_id, amount },
      );
    const first = await run(1, 142000, []);
    const last = await run(2, 100000, [142000]);

    for (const [fields, amount] of [
      [first, 142000],
      [last, 100000],
    ] as const) {
      const taxes = (fields.tax_breakdown ?? []).reduce(
        (sum, row) => sum + c(row.tax_amount),
        0,
      );
      expect(taxes).toBe(c(fields.tax_amount));
      // DR caja + DR 4175 = CR ingreso + impuestos + flete + propina.
      expect(c(amount) + c(fields.discount_amount)).toBe(
        c(fields.subtotal_amount) +
          taxes +
          c(fields.shipping_amount ?? 0) +
          c(fields.tip_amount),
      );
    }
    const typed = (type: string) =>
      [first, last]
        .flatMap((f) => f.tax_breakdown ?? [])
        .filter((row) => row.tax_type === type)
        .reduce((sum, row) => sum + c(row.tax_amount), 0);
    // Σ porciones = factura: IVA 18.230,76 + 798,31 del envío · INC 7.676,11.
    expect(typed('iva')).toBe(c(18230.76) + c(798.31));
    expect(typed('inc')).toBe(c(7676.11));
    expect(c(first.discount_amount) + c(last.discount_amount)).toBe(c(8906.87));
    expect(c(first.subtotal_amount) + c(last.subtotal_amount)).toBe(c(220000));
  });
  it('M6 · sin descuento: la porción de mesa lleva el desglose tipado sin cambiar montos', async () => {
    // IVA 19 % 1.900 + INC 8 % 800 + envío con IVA 190 ⇒ 23.890, pagado 10.000 + 13.890.
    const base_order = {
      subtotal_amount: 20000,
      discount_amount: 0,
      tax_amount: 2700,
      shipping_cost: 1190,
      shipping_tax_type: 'iva',
      shipping_tax_rate: 0.19,
      shipping_tax_amount: 190,
      tip_amount: 0,
      grand_total: 23890,
    };
    const order = {
      ...base_order,
      order_items: [
        {
          quantity: 1,
          total_price: 10000,
          tax_amount_item: 1900,
          order_item_taxes: [{ tax_type: 'iva', tax_rate: 0.19, tax_amount: 1900 }],
        },
        {
          quantity: 1,
          total_price: 10000,
          tax_amount_item: 800,
          order_item_taxes: [{ tax_type: 'inc', tax_rate: 0.08, tax_amount: 800 }],
        },
      ],
    };
    const c = (n: number) => Math.round(n * 100);
    const run = async (source: any, payment_id: number, amount: number, prior: number[]) =>
      resolvePaymentReceivedSaleFields(
        {
          orders: { findUnique: jest.fn().mockResolvedValue(source) },
          payments: {
            findMany: jest
              .fn()
              .mockResolvedValue(prior.map((value) => ({ amount: value }))),
          },
        },
        { order_id: 71, payment_id, amount },
      );
    const first = await run(order, 1, 10000, []);
    const last = await run(order, 2, 13890, [10000]);
    const first_legacy = await run(base_order, 1, 10000, []);
    const last_legacy = await run(base_order, 2, 13890, [10000]);

    // Montos idénticos al reparto histórico; sólo se añade el desglose.
    const { tax_breakdown: first_rows, ...first_amounts } = first;
    const { tax_breakdown: last_rows, ...last_amounts } = last;
    expect(first_amounts).toEqual(first_legacy);
    expect(last_amounts).toEqual(last_legacy);
    expect(first_legacy.tax_breakdown).toBeUndefined();

    for (const fields of [first, last]) {
      const taxes = (fields.tax_breakdown ?? []).reduce(
        (sum, row) => sum + c(row.tax_amount),
        0,
      );
      expect(taxes).toBe(c(fields.tax_amount));
    }
    const typed = (type: string) =>
      [...(first_rows ?? []), ...(last_rows ?? [])]
        .filter((row) => row.tax_type === type)
        .reduce((sum, row) => sum + c(row.tax_amount), 0);
    expect(typed('iva')).toBe(c(1900 + 190));
    expect(typed('inc')).toBe(c(800));
  });
});
