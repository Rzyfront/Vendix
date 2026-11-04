import { OrderTicketService } from './order-ticket.service';
import type { Order, OrderItem } from '../interfaces/order.interface';

/**
 * QUI-979 — sección Crédito del tiquete cliente (`toTicketData`).
 *
 * La venta a crédito publica `credit` (total/abonado/saldo + Cuotas X de Y +
 * historial + calendario); el contado y la cancelada salen sin la llave
 * (payload byte-idéntico). Espejo de `attachCreditSection` del backend: el
 * historial acá solo trae abonos POS (el `findOne` no trae `ar_payments`).
 */
describe('OrderTicketService — sección Crédito (QUI-979)', () => {
  const service = new OrderTicketService();

  const baseOrder = (over: Partial<Order> = {}): Order =>
    ({
      id: 7,
      order_number: 'POS-0007',
      state: 'created',
      payment_form: '2',
      credit_type: 'installments',
      subtotal_amount: 100000,
      tax_amount: 0,
      discount_amount: 0,
      grand_total: 100000,
      total_paid: 20000,
      remaining_balance: 80000,
      total_with_interest: 100000,
      currency: 'COP',
      created_at: '2026-08-27T14:15:00.000Z',
      order_items: [],
      payments: [],
      order_installments: [],
      ...over,
    }) as Order;

  const installment = (over: any = {}) => ({
    id: 1,
    order_id: 7,
    installment_number: 1,
    amount: 20000,
    capital_amount: 20000,
    interest_amount: 0,
    due_date: '2026-09-15',
    state: 'pending',
    amount_paid: 0,
    remaining_balance: 20000,
    created_at: '2026-08-27T14:15:00.000Z',
    updated_at: '2026-08-27T14:15:00.000Z',
    ...over,
  });

  const payment = (over: any = {}) => ({
    id: 11,
    order_id: 7,
    amount: 20000,
    currency: 'COP',
    state: 'succeeded',
    gateway_response: { metadata: { is_initial_credit_payment: true } },
    created_at: '2026-08-27T14:15:00.000Z',
    updated_at: '2026-08-27T14:15:00.000Z',
    store_payment_method: {
      id: 3,
      display_name: null,
      system_payment_method: {
        type: 'cash',
        name: 'cash',
        display_name: 'Efectivo',
      },
    },
    ...over,
  });

  it('contado: sin llave credit (payload byte-idéntico)', () => {
    const ticket = service.toTicketData(baseOrder({ payment_form: '1' }));

    expect('credit' in ticket).toBe(false);
    expect(JSON.stringify(ticket)).not.toContain('credit');
  });

  it('orden cancelada: sin sección aunque haya sido crédito', () => {
    const ticket = service.toTicketData(
      baseOrder({ state: 'cancelled' as any }),
    );

    expect('credit' in ticket).toBe(false);
  });

  it('crédito con inicial: totales derivados, X de Y, historial y calendario', () => {
    const ticket = service.toTicketData(
      baseOrder({
        payments: [payment()] as any,
        order_installments: [
          installment({ id: 1, installment_number: 1 }),
          installment({ id: 2, installment_number: 2, due_date: '2026-10-15' }),
          installment({ id: 3, installment_number: 3, due_date: '2026-11-15' }),
          installment({ id: 4, installment_number: 4, due_date: '2026-12-15' }),
        ] as any,
      }),
    );

    const credit = ticket.credit;
    expect(credit).toBeDefined();
    expect(credit!.total).toBe(100000);
    expect(credit!.paid_total).toBe(20000);
    expect(credit!.balance).toBe(80000);
    expect(credit!.installments_paid).toBe(0);
    expect(credit!.installments_total).toBe(4);
    expect(credit!.last_payment).toEqual({
      amount: 20000,
      date_formatted: '27/08/2026',
    });
    expect(credit!.payments).toEqual([
      {
        date_formatted: '27/08/2026',
        amount: 20000,
        method: 'Efectivo',
        is_initial: true,
      },
    ]);
    expect(credit!.pending_installments).toEqual([
      {
        number: 1,
        state: 'pending',
        due_date_formatted: '15/09/2026',
        balance: 20000,
      },
      {
        number: 2,
        state: 'pending',
        due_date_formatted: '15/10/2026',
        balance: 20000,
      },
      {
        number: 3,
        state: 'pending',
        due_date_formatted: '15/11/2026',
        balance: 20000,
      },
      {
        number: 4,
        state: 'pending',
        due_date_formatted: '15/12/2026',
        balance: 20000,
      },
    ]);
    // El total de la venta queda intacto.
    expect(ticket.total).toBe(100000);
  });

  it('abono posterior: X de Y e historial en orden cronológico', () => {
    const ticket = service.toTicketData(
      baseOrder({
        total_paid: 40000,
        remaining_balance: 60000,
        payments: [
          payment(),
          payment({
            id: 12,
            amount: 20000,
            gateway_response: { metadata: { is_credit_payment: true } },
            created_at: '2026-09-10T15:00:00.000Z',
            updated_at: '2026-09-10T15:00:00.000Z',
          }),
        ] as any,
        order_installments: [
          installment({
            id: 1,
            installment_number: 1,
            state: 'paid',
            amount_paid: 20000,
            remaining_balance: 0,
          }),
          installment({ id: 2, installment_number: 2, due_date: '2026-10-15' }),
        ] as any,
      }),
    );

    const credit = ticket.credit!;
    expect(credit.paid_total).toBe(40000);
    expect(credit.balance).toBe(60000);
    expect(credit.installments_paid).toBe(1);
    expect(credit.installments_total).toBe(2);
    expect(credit.payments.map((p) => p.amount)).toEqual([20000, 20000]);
    expect(credit.last_payment).toEqual({
      amount: 20000,
      date_formatted: '10/09/2026',
    });
    expect(credit.pending_installments.map((p) => p.number)).toEqual([2]);
  });

  it('crédito libre: totales + historial, sin calendario ni nota de cuotas', () => {
    const ticket = service.toTicketData(
      baseOrder({
        credit_type: 'free',
        total_with_interest: undefined,
        total_paid: 30000,
        remaining_balance: 70000,
        payments: [payment({ amount: 30000 })] as any,
        order_installments: [],
      }),
    );

    const credit = ticket.credit!;
    expect(credit.is_installments).toBe(false);
    expect(credit.total).toBe(100000);
    expect(credit.installments_total).toBe(0);
    expect(credit.pending_installments).toEqual([]);
    expect(credit.payments).toHaveSize(1);
  });

  it('ignora pagos no succeeded en el historial', () => {
    const ticket = service.toTicketData(
      baseOrder({
        payments: [
          payment(),
          payment({ id: 13, amount: 50000, state: 'pending' }),
        ] as any,
      }),
    );

    expect(ticket.credit!.payments).toHaveSize(1);
  });
});

describe('OrderTicketService — línea de PESO no se imprime como empaque', () => {
  const service = new OrderTicketService();
  const line = (overrides: Partial<OrderItem>): OrderItem =>
    ({
      id: 1,
      product_name: 'Queso costeño',
      quantity: 1,
      unit_price: 20000,
      total_price: 3600,
      ...overrides,
    }) as OrderItem;

  it('pesada de 0,180 kg con 180 g descontados: sin "×180" ni presentación', () => {
    const item = line({ weight: '0.180', weight_unit: 'kg', stock_units_consumed: 180 });
    expect(service.hasPackageStockConsumption(item)).toBe(false);
    expect(service.packageMultiplier(item)).toBeNull();

    const ticket = service.toTicketData({ order_items: [item] } as unknown as Order);
    expect(ticket.items[0].isPackageUnit).toBe(false);
    expect(ticket.items[0].unitsPerPackage).toBeNull();
  });

  it('presentación real (1 bulto de 50) sigue mostrando ×50', () => {
    const item = line({ stock_units_consumed: 50 });
    expect(service.hasPackageStockConsumption(item)).toBe(true);
    expect(service.packageMultiplier(item)).toBe(50);
  });
});
