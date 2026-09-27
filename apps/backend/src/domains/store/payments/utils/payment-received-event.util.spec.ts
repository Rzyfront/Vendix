import {
  buildPaymentReceivedEvents,
  type PaymentReceivedEventOrder,
} from './payment-received-event.util';
import type { WithholdingLine } from '@common/interfaces/withholding-breakdown.interface';

describe('buildPaymentReceivedEvents', () => {
  const ORDER: PaymentReceivedEventOrder = {
    id: 501,
    order_number: 'ORD-501',
    store_id: 10,
    organization_id: 1,
    customer_id: 42,
    subtotal_amount: 84033.61,
    tip_amount: 0,
  };
  const SALE_TAX = {
    tax_amount: 15966.39,
    shipping_amount: 0,
    tax_breakdown: [{ tax_type: 'iva' as const, tax_amount: 15966.39 }],
    discount_amount: 0,
  };
  const WH_LINES: WithholdingLine[] = [
    {
      withholding_type: 'reteiva',
      concept_code: 'RETEIVA_GENERAL',
      concept_id: 7,
      rate: 0.15,
      base: 15966.39,
      amount: 2395,
      role: 'suffered',
      account_role: 'withholding.suffered.reteiva_receivable',
    },
  ];

  it('2 tramos con sale_share: cada payload lleva su propia porción y su propio método de pago', () => {
    const legs = [
      {
        id: 1001,
        amount: 20000,
        display_name: 'Efectivo',
        sale_share: {
          subtotal_amount: 16806.72,
          tax_amount: 3193.28,
          shipping_amount: 0,
          discount_amount: 0,
          tip_amount: 0,
        },
      },
      {
        id: 1002,
        amount: 80000,
        display_name: 'Transferencia',
        sale_share: {
          subtotal_amount: 67226.89,
          tax_amount: 12773.11,
          shipping_amount: 0,
          discount_amount: 0,
          tip_amount: 0,
        },
      },
    ];

    const payloads = buildPaymentReceivedEvents({
      order: ORDER,
      sale_tax: SALE_TAX,
      payments: legs,
      withholding_lines: WH_LINES,
      currency: 'COP',
      user_id: 7,
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      payment_id: 1001,
      amount: 20000,
      payment_method: 'Efectivo',
      subtotal_amount: 16806.72,
      tax_amount: 3193.28,
    });
    expect(payloads[1]).toMatchObject({
      payment_id: 1002,
      amount: 80000,
      payment_method: 'Transferencia',
      subtotal_amount: 67226.89,
      tax_amount: 12773.11,
    });

    // Σ porciones de venta (subtotal + impuesto) = totales de la orden.
    const sum = (key: 'subtotal_amount' | 'tax_amount') =>
      payloads.reduce((acc, p) => acc + (p as any)[key], 0);
    expect(sum('subtotal_amount')).toBeCloseTo(84033.61, 2);
    expect(sum('tax_amount')).toBeCloseTo(15966.39, 2);

    // La retención se reconoce UNA vez por orden: Σ de los repartos = línea original.
    const whSum = payloads.reduce(
      (acc, p) =>
        acc + p.withholding_breakdown.reduce((a, l) => a + l.amount, 0),
      0,
    );
    expect(whSum).toBeCloseTo(2395, 2);
    // Ningún tramo duplica la línea completa.
    payloads.forEach((p) => {
      p.withholding_breakdown.forEach((line) => {
        expect(line.amount).toBeLessThanOrEqual(2395);
      });
    });
  });

  it('customer/organization/store se toman de la orden, no del pago', () => {
    const payloads = buildPaymentReceivedEvents({
      order: ORDER,
      sale_tax: SALE_TAX,
      payments: [{ id: 2001, amount: 100000, display_name: 'Efectivo' }],
      currency: 'COP',
    });
    expect(payloads[0]).toMatchObject({
      store_id: 10,
      organization_id: 1,
      order_id: 501,
      order_number: 'ORD-501',
      customer: { id: 42 },
    });
  });

  it('1 pago sin sale_share (escalar): cae íntegro a los totales/impuesto de la orden', () => {
    const payloads = buildPaymentReceivedEvents({
      order: ORDER,
      sale_tax: SALE_TAX,
      payments: [{ id: 3001, amount: 100000, display_name: 'Efectivo' }],
      withholding_lines: WH_LINES,
      currency: 'COP',
      user_id: 9,
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      payment_id: 3001,
      store_id: 10,
      organization_id: 1,
      order_id: 501,
      order_number: 'ORD-501',
      amount: 100000,
      subtotal_amount: 84033.61,
      tax_amount: 15966.39,
      shipping_amount: 0,
      tax_breakdown: SALE_TAX.tax_breakdown,
      withholding_breakdown: WH_LINES,
      discount_amount: 0,
      tip_amount: 0,
      currency: 'COP',
      payment_method: 'Efectivo',
      user_id: 9,
      customer: { id: 42 },
    });
  });

  it('sin display_name cae a "Unknown", igual que el POS', () => {
    const payloads = buildPaymentReceivedEvents({
      order: ORDER,
      sale_tax: SALE_TAX,
      payments: [{ id: 4001, amount: 50000 }],
      currency: 'COP',
    });
    expect(payloads[0].payment_method).toBe('Unknown');
  });

  it('sin withholding_lines: cada tramo emite un arreglo vacío (no undefined)', () => {
    const payloads = buildPaymentReceivedEvents({
      order: ORDER,
      sale_tax: SALE_TAX,
      payments: [
        { id: 5001, amount: 20000 },
        { id: 5002, amount: 80000 },
      ],
      currency: 'COP',
    });
    payloads.forEach((p) => expect(p.withholding_breakdown).toEqual([]));
  });
});
