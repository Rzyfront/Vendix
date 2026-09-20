import { SplitAccountPaymentService } from './split-account-payment.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

/** Orchestration tests: real service, mocked infrastructure, no external charge. */
describe('SplitAccountPaymentService', () => {
  let service: SplitAccountPaymentService;
  let db: any;
  let gateway: any;
  let events: any;
  let settings: any;
  let sessions: any;
  let tableSessions: any;
  let redis: any;
  let source: any;
  let accounts: any[];
  let payments: any[];
  let movements: any[];
  let methods: any[];
  let transactionOpen: boolean;
  const context = { store_id: 10, organization_id: 6, user_id: 15, is_super_admin: false, is_owner: true };
  const makeRequest = (extra = {}) => ({ amount: 100, store_payment_method_id: 1, idempotency_key: 'payment-key-001', ...extra });
  const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === 'orders') return row.order_id === source.id && value.store_id === source.store_id;
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return (row[key] ?? null) !== value.not;
    }
    return (row[key] ?? null) === value;
  });
  beforeEach(() => {
    transactionOpen = false; movements = [];
    source = { id: 100, store_id: 10, order_number: 'QA-F006', active_financial_split_id: 7,
      grand_total: '300.00', total_paid: '100.00', remaining_balance: '200.00', currency: 'COP', state: 'processing' };
    accounts = [11, 12].map((id) => ({ id, store_id: 10, split_id: 7, role: 'payable', state: 'active',
      grand_total: '100.00', paid_snapshot: '0.00', customer_id: 8,
      subtotal_amount: '80.00', discount_amount: '0.00', tax_amount: '15.20', shipping_cost: '2.00', tip_amount: '2.80',
      split: { source_order_id: 100, state: 'active' },
      customer: { id: 8, first_name: 'QA', last_name: 'Payer', document_number: 'QA' },
      lines: [{ taxes: [{ tax_type: 'iva', tax_rate: '0.19', tax_amount: '15.20' }] }],
    }));
    methods = ['cash', 'card', 'bank_transfer', 'wompi', 'wallet', 'cash_on_delivery'].map((type, index) => ({
      id: index + 1, store_id: 10, state: 'enabled', system_payment_method: {
        type, is_active: true, processing_mode: index < 3 ? 'DIRECT' : index === 5 ? 'ON_DELIVERY' : 'ONLINE',
      },
    }));
    payments = [{ id: 1, order_id: 100, financial_account_id: null, amount: '100.00', state: 'succeeded' }];
    db = {
      $queryRaw: jest.fn(async () => [{ id: 100 }]),
      $transaction: jest.fn(async (callback) => { transactionOpen = true; try { return await callback(db); } finally { transactionOpen = false; } }),
      orders: {
        findFirst: jest.fn(async ({ where }) => matches(source, where) ? source : null),
        updateMany: jest.fn(async ({ data }) => { Object.assign(source, data); return { count: 1 }; }),
      },
      order_financial_accounts: { findFirst: jest.fn(async ({ where }) => accounts.find((a) => matches(a, where))) },
      store_payment_methods: { findFirst: jest.fn(async ({ where }) => methods.find((m) => matches(m, where))) },
      payments: {
        findFirst: jest.fn(async ({ where, include }) => {
          const p = payments.find((p) => matches(p, where));
          return p && (include ? { ...p, store_payment_method: methods.find((m) => m.id === p.store_payment_method_id) } : p);
        }),
        findMany: jest.fn(async ({ where }) => payments.filter((p) => matches(p, where))),
        create: jest.fn(async ({ data }) => { const p = { id: payments.length + 1, ...data, financial_effects_recorded_at: null }; payments.push(p); return p; }),
        updateMany: jest.fn(async ({ where, data }) => { const selected = payments.filter((p) => matches(p, where)); selected.forEach((p) => Object.assign(p, data)); return { count: selected.length }; }),
      },
      users: { findFirst: jest.fn(async () => ({ id: 15 })) },
      cash_register_sessions: { findFirst: jest.fn(async ({ where }) => ({ id: where.id })) },
      cash_register_movements: {
        findFirst: jest.fn(async ({ where }) => movements.find((m) => matches(m, where))),
        create: jest.fn(async ({ data }) => { const m = { id: movements.length + 1, ...data }; movements.push(m); return m; }),
      },
      table_sessions: { findFirst: jest.fn(async () => null) },
    };
    gateway = { processReservedPayment: jest.fn(async (id) => {
      expect(transactionOpen).toBe(false);
      const payment = payments.find((p) => p.id === id);
      expect(payment.state).toBe('pending');
      payment.gateway_reference = `financial_10_${id}`;
      payment.gateway_response = { ...payment.gateway_response, nextAction: { type: 'redirect', url: 'https://example.test/pay' } };
      return { status: 'pending', success: false };
    }), resolveAndValidateBankAccount: jest.fn(async () => ({ id: 7 })) };
    events = { emitAsync: jest.fn(async () => { expect(transactionOpen).toBe(false); }) };
    settings = { getSettings: jest.fn(async () => ({ pos: { cash_register: { enabled: false } } })) };
    sessions = { getActiveSession: jest.fn(async () => null) };
    tableSessions = { markSessionPaid: jest.fn(async () => ({ id: 3, order_id: 100 })), emitSessionPaid: jest.fn() };
    redis = { set: jest.fn(async () => 'OK'), eval: jest.fn(async () => 1) };
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(context);
    service = new SplitAccountPaymentService(db, gateway, { getSplit: jest.fn(async () => ({ source_order_id: 100 })) } as any,
      events, settings, sessions, tableSessions, redis);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([1, 2, 3])('collects manual method %s with canonical event and no gateway/stock/order status change', async (store_payment_method_id) => {
    const result = await service.pay(100, 11, makeRequest({ store_payment_method_id }));
    expect(result.payment.state).toBe('succeeded');
    expect(payments[1]).toMatchObject({ order_id: 100, financial_account_id: 11, customer_id: 8 });
    expect(source.state).toBe('processing');
    expect(String(source.total_paid)).toBe('200');
    expect(String(source.remaining_balance)).toBe('100');
    expect(gateway.processReservedPayment).not.toHaveBeenCalled();
    expect(events.emitAsync).toHaveBeenCalledWith('payment.received', expect.objectContaining({ payment_id: 2, financial_account_id: 11,
      amount: 100, order_id: 100, customer: { id: 8, name: 'QA Payer', tax_id: 'QA' } }));
    expect(tableSessions.markSessionPaid).not.toHaveBeenCalled();
  });

  it('reserves Wompi before provider and cannot manually confirm pending online payment', async () => {
    const result = await service.pay(100, 11, makeRequest({ store_payment_method_id: 4,
      wompi_payment_method: { type: 'NEQUI', phone_number: '3000000000' } }));
    expect(result.payment).toMatchObject({ state: 'pending', nextAction: { type: 'redirect' } });
    expect(gateway.processReservedPayment).toHaveBeenCalledTimes(1);
    expect(events.emitAsync).not.toHaveBeenCalled();
    await expect(service.confirm(100, 11, 2, {})).rejects.toThrow('proveedor');
    expect(payments[1].state).toBe('pending');
  });

  it('replay returns same payment, never another charge or duplicate cash/event', async () => {
    settings.getSettings.mockResolvedValue({ pos: { cash_register: { enabled: true, require_session_for_sales: true } } });
    sessions.getActiveSession.mockResolvedValue({ id: 50 });
    const first = await service.pay(100, 11, makeRequest());
    sessions.getActiveSession.mockResolvedValue({ id: 90 });
    const replay = await service.pay(100, 11, makeRequest());
    expect(replay.payment.id).toBe(first.payment.id);
    expect(db.payments.create).toHaveBeenCalledTimes(1);
    expect(events.emitAsync).toHaveBeenCalledTimes(1);
    expect(movements).toHaveLength(1);
    expect(movements[0].session_id).toBe(50);
    expect(movements[0].payment_id).toBe(2);
  });

  it('rejects same idempotency key with changed amount or reference', async () => {
    await service.pay(100, 11, makeRequest({ amount: 50 }));
    await expect(service.pay(100, 11, makeRequest({ amount: 40 }))).rejects.toThrow('clave');
    await expect(service.pay(100, 11, makeRequest({ amount: 50, payment_reference: 'other' }))).rejects.toThrow('clave');
    expect(payments).toHaveLength(2);
  });

  it('budgets pending and authorized reservations; never reallocates another account capacity', async () => {
    payments.push({ id: 2, order_id: 100, financial_account_id: 11, amount: '80.00', state: 'authorized' });
    await expect(service.pay(100, 11, makeRequest({ amount: 20.01 }))).rejects.toThrow('saldo');
    await expect(service.pay(100, 12, makeRequest({ amount: 100.01 }))).rejects.toThrow('saldo');
    expect(db.payments.create).not.toHaveBeenCalled();
  });

  it('also enforces root budget against money collected elsewhere', async () => {
    payments.push({ id: 2, order_id: 100, financial_account_id: null, amount: '180.00', state: 'captured' });
    await expect(service.pay(100, 11, makeRequest({ amount: 21 }))).rejects.toThrow('saldo');
  });

  it.each([0, -1, 0.001, NaN, Infinity])('rejects invalid amount %s before reserving', async (amount) => {
    await expect(service.pay(100, 11, makeRequest({ amount }))).rejects.toBeInstanceOf(VendixHttpException);
    expect(db.payments.create).not.toHaveBeenCalled();
  });

  it('rejects foreign/retained account, insufficient cash, unsupported methods and required closed register', async () => {
    await expect(service.pay(100, 999, makeRequest())).rejects.toBeInstanceOf(VendixHttpException);
    accounts[0].role = 'paid_original';
    await expect(service.pay(100, 11, makeRequest())).rejects.toThrow('abonos');
    accounts[0].role = 'payable';
    await expect(service.pay(100, 11, makeRequest({ amount_received: 90 }))).rejects.toThrow('efectivo');
    await expect(service.pay(100, 11, makeRequest({ store_payment_method_id: 5 }))).rejects.toThrow('integrado');
    await expect(service.pay(100, 11, makeRequest({ store_payment_method_id: 6 }))).rejects.toThrow('integrado');
    settings.getSettings.mockResolvedValue({ pos: { cash_register: { enabled: true, require_session_for_sales: true } } });
    await expect(service.pay(100, 11, makeRequest())).rejects.toThrow('caja');
    expect(db.payments.create).not.toHaveBeenCalled();
  });

  it('validates bank ownership before creating a payment', async () => {
    gateway.resolveAndValidateBankAccount.mockRejectedValue(new Error('foreign bank'));
    await expect(service.pay(100, 11, makeRequest({ store_payment_method_id: 3, bank_account_id: 999 }))).rejects.toThrow('foreign bank');
    expect(db.payments.create).not.toHaveBeenCalled();
  });

  it('leaves uncertain provider result pending and replay does not repeat external request', async () => {
    gateway.processReservedPayment.mockImplementation(async (id) => { payments.find((p) => p.id === id).gateway_reference = `financial_10_${id}`; throw new Error('provider timeout'); });
    const request = makeRequest({ store_payment_method_id: 4, wompi_payment_method: { type: 'NEQUI', phone_number: '3000000000' } });
    await expect(service.pay(100, 11, request)).rejects.toThrow('provider timeout');
    expect(payments[1].state).toBe('pending');
    await service.pay(100, 11, request);
    expect(gateway.processReservedPayment).toHaveBeenCalledTimes(1);
    expect(events.emitAsync).not.toHaveBeenCalled();
  });

  it('resumes an undispatched pending reservation without duplicating its row', async () => {
    const request = makeRequest({ store_payment_method_id: 4, wompi_payment_method: { type: 'NEQUI', phone_number: '3000000000' } });
    redis.set.mockResolvedValueOnce(null);
    await service.pay(100, 11, request);
    expect(gateway.processReservedPayment).not.toHaveBeenCalled();
    await service.pay(100, 11, request);
    expect(gateway.processReservedPayment).toHaveBeenCalledTimes(1);
    expect(payments).toHaveLength(2);
  });

  it('keeps effects marker pending on event failure, retries post-commit without a new payment', async () => {
    events.emitAsync.mockRejectedValueOnce(new Error('accounting down'));
    await expect(service.pay(100, 11, makeRequest())).rejects.toThrow('accounting down');
    expect(payments[1].state).toBe('succeeded');
    expect(payments[1].financial_effects_recorded_at).toBeNull();
    await service.reconcileReceivedForOrder(100);
    expect(payments[1].financial_effects_recorded_at).toBeInstanceOf(Date);
    expect(payments).toHaveLength(2);
    expect(gateway.processReservedPayment).not.toHaveBeenCalled();
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it('webhook reconciliation works without request user, preserving original actor', async () => {
    events.emitAsync.mockRejectedValueOnce(new Error('interrupted'));
    await expect(service.pay(100, 11, makeRequest())).rejects.toThrow('interrupted');
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ ...context, user_id: undefined });
    await service.reconcilePayment(2);
    expect(events.emitAsync).toHaveBeenLastCalledWith('payment.received', expect.objectContaining({ user_id: 15 }));
  });

  it('never attributes replay to a different organization actor', async () => {
    events.emitAsync.mockRejectedValueOnce(new Error('interrupted'));
    await expect(service.pay(100, 11, makeRequest())).rejects.toThrow('interrupted');
    db.users.findFirst.mockResolvedValue(null);
    await expect(service.reconcilePayment(2)).rejects.toThrow('autorización');
    expect(payments[1].financial_effects_recorded_at).toBeNull();
  });

  it('marks table paid only when aggregate source is paid, without closing or stock', async () => {
    await service.pay(100, 11, makeRequest());
    db.table_sessions.findFirst.mockResolvedValue({ id: 3 });
    await service.pay(100, 12, makeRequest({ idempotency_key: 'payment-key-002' }));
    expect(tableSessions.markSessionPaid).toHaveBeenCalledTimes(1);
    expect(tableSessions.markSessionPaid).toHaveBeenCalledWith(3, 3, db);
    expect(tableSessions.emitSessionPaid).toHaveBeenCalledWith(10, 3, 100, 3);
    expect(String(source.remaining_balance)).toBe('0');
    expect(source.state).toBe('processing');
  });

  it('skips concurrent effects claim and never calls provider in reconciliation', async () => {
    redis.set.mockResolvedValue(null);
    await service.reconcileReceivedForOrder(100);
    await service.reconcilePayment(1);
    expect(events.emitAsync).not.toHaveBeenCalled();
    expect(gateway.processReservedPayment).not.toHaveBeenCalled();
  });
});
