import { OrderFlowService } from './order-flow.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { mockRequestContext } from '../../../../testing/prisma-mock';

/**
 * B02 — `cancelLegPayments` debe dejar el neto de caja de la orden en 0: cada
 * tramo anulado (o devuelto a `pending` en sitio) con `sale` recibe su
 * contramovimiento `refund` (`payment_compensated:<id>`) en la MISMA tx.
 */
describe('OrderFlowService.cancelLegPayments — compensación de caja (B02)', () => {
  type Mov = {
    id: number;
    type: 'sale' | 'refund';
    payment_id: number | null;
    order_id: number;
    store_id: number;
    amount: number;
    payment_method: string;
    user_id: number;
    reference?: string;
    notes?: string;
  };

  let ledger: Mov[];
  let service: OrderFlowService;
  let tx: any;
  let durable: jest.Mock;

  const net = () =>
    ledger.reduce((acc, m) => acc + (m.type === 'sale' ? m.amount : -m.amount), 0);

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7 });
    ledger = [
      { id: 1, type: 'sale', payment_id: 501, order_id: 9, store_id: 100, amount: 23500, payment_method: 'cash', user_id: 3 },
      { id: 2, type: 'sale', payment_id: 502, order_id: 9, store_id: 100, amount: 18500, payment_method: 'card', user_id: 3 },
    ];
    durable = jest.fn(async (input: any) => {
      const row: Mov = {
        id: ledger.length + 1,
        type: 'refund',
        payment_id: input.payment_id,
        order_id: input.order_id,
        store_id: input.store_id,
        amount: input.amount,
        payment_method: input.payment_method,
        user_id: input.user_id,
        reference: input.reference,
        notes: input.notes,
      };
      ledger.push(row);
      return { status: 'recorded', movement_id: row.id };
    });
    tx = {
      payments: { update: jest.fn(async () => ({})) },
      cash_register_movements: {
        findMany: jest.fn(async ({ where }: any) =>
          ledger.filter(
            (m) =>
              m.type === where.type &&
              (where.payment_id?.in ? where.payment_id.in.includes(m.payment_id) : true),
          ),
        ),
      },
    };
    const prisma: any = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
    service = new OrderFlowService(
      prisma as unknown as StorePrismaService,
      { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } as any,
      {} as any,
      {} as any,
      { recordCompensationCashMovementDurable: durable } as any,
      {} as any, {} as any, {} as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined,
    );
  });

  const legs = () => [
    { payment: { id: 501, gateway_response: {} }, leg: {} },
    { payment: { id: 502, gateway_response: {} }, leg: {} },
  ];

  it.each([
    'partial_balance_blocked',
    'finish_blocked',
    'kitchen_items_pending',
    'finish_blocked_insufficient_stock',
  ])('motivo %s: neto de caja 0, refund por tramo con reference y notes', async (reason) => {
    expect(net()).toBe(42000);

    await (service as any).cancelLegPayments(legs(), reason);

    expect(net()).toBe(0);
    const refunds = ledger.filter((m) => m.type === 'refund');
    expect(refunds.map((r) => [r.payment_id, r.amount, r.payment_method, r.reference])).toEqual([
      [501, 23500, 'cash', 'payment_compensated:501'],
      [502, 18500, 'card', 'payment_compensated:502'],
    ]);
    expect(refunds[0].notes).toContain(reason);
    // Misma tx que el cancel de los pagos.
    expect(durable.mock.calls.every(([, passedTx]) => passedTx === tx)).toBe(true);
    expect(tx.payments.update).toHaveBeenCalledTimes(2);
  });

  it('tramo diferido (sin sale): no crea contramovimiento', async () => {
    ledger = [];
    await (service as any).cancelLegPayments(legs(), 'finish_blocked');
    expect(durable).not.toHaveBeenCalled();
    expect(net()).toBe(0);
  });

  it('confirmado en sitio: vuelve a pending y su sale también se compensa', async () => {
    const original = {
      store_payment_method_id: 1,
      bank_account_id: null,
      amount: 23500,
      transaction_id: 'T',
      gateway_reference: null,
      paid_at: null,
      gateway_response: {},
    };
    await (service as any).cancelLegPayments(
      [{ payment: { id: 501, gateway_response: {} }, leg: {}, confirmedInPlaceOriginal: original }],
      'finish_blocked',
    );
    expect(tx.payments.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'pending' }) }),
    );
    expect(ledger.filter((m) => m.type === 'refund')).toHaveLength(1);
    expect(net()).toBe(18500);
  });
});
