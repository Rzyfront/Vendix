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
});
