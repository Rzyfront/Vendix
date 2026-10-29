import { ErrorCodes } from 'src/common/errors';
import { OrderLeaseService } from 'src/common/locks/order-lease.service';
import { RequestContextService } from 'src/common/context/request-context.service';
import { OneShotEmissionService } from '../one-shot-emission.service';
import { CREDIT_FINAL_CONSUMER_MESSAGE } from '../one-shot-emission.service';
import { OrdersBulkInvoicingService } from './orders-bulk-invoicing.service';

const customer = (over: Record<string, unknown> = {}) => ({
  document_type: 'CC',
  document_number: '1020304050',
  legal_name: null,
  first_name: 'Juan',
  last_name: 'Pérez',
  verification_digit: null,
  ...over,
});

const paidPayment = [{ state: 'succeeded', amount: 100 }];

const order = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  order_number: `ORD-${id}`,
  state: 'processing',
  customer_id: 5,
  payment_form: null,
  grand_total: 100,
  active_financial_split_id: null,
  payments: paidPayment,
  users: customer(),
  invoice_data_requests: [],
  ...over,
});

function build(opts: {
  orders: any[];
  invoices?: Array<{ order_id: number; status: string }>;
  eligible?: boolean;
}) {
  const prisma: any = {
    orders: { findMany: jest.fn(async () => opts.orders) },
    invoices: { findMany: jest.fn(async () => opts.invoices ?? []) },
  };
  const invoicing: any = {
    getElectronicEmissionEligibility: jest.fn().mockResolvedValue(
      opts.eligible === false
        ? { eligible: false, reason: 'Falta la resolución DIAN.' }
        : { eligible: true, reason: null },
    ),
  };
  const one_shot: any = new OneShotEmissionService(
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
  one_shot.emitOrder = jest.fn(async () => ({
    state: 'issued',
    invoice_id: 1,
    invoice_number: 'FE-1',
    dian_status: 'accepted',
    message: null,
  }));
  const keys = new Map<string, string>();
  const lease = new OrderLeaseService({
    set: jest.fn(async (k: string, v: string) => {
      if (keys.has(k)) return null;
      keys.set(k, v);
      return 'OK';
    }),
    get: jest.fn(async (k: string) => keys.get(k) ?? null),
    eval: jest.fn(async (_s: string, _n: number, k: string, t: string) => {
      if (keys.get(k) === t) keys.delete(k);
      return 1;
    }),
  } as any);
  const service = new OrdersBulkInvoicingService(prisma, one_shot, invoicing, lease);
  return { service, prisma, invoicing, one_shot, keys };
}

describe('OrdersBulkInvoicingService', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(1);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('preview', () => {
    it('classifies paid / credit_existing / to_credit / blocked and counts them', async () => {
      const { service } = build({
        orders: [
          order(1),
          order(2, { payment_form: '2', payments: [] }),
          order(3, { payments: [] }),
          order(4, { payments: [{ state: 'succeeded', amount: 40 }] }),
          order(5, { payments: [], customer_id: null, users: null }),
          order(6, { state: 'cancelled' }),
        ],
      });
      const r = await service.preview({ ids: [1, 2, 3, 4, 5, 6, 99] });
      const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
      expect(by[1]).toMatchObject({ payment: 'paid', will_emit: true, blocked_code: null, grand_total: '100.00' });
      expect(by[2]).toMatchObject({ payment: 'credit_existing', will_emit: true });
      expect(by[3]).toMatchObject({ payment: 'to_credit', will_emit: true });
      expect(by[4]).toMatchObject({ payment: 'blocked', blocked_code: 'partial_payment', will_emit: false });
      expect(by[4].skip_reason).toBeTruthy();
      expect(by[5]).toMatchObject({ payment: 'blocked', blocked_code: 'customer_required', will_emit: false });
      expect(by[6]).toMatchObject({ payment: 'blocked', blocked_code: 'order_state' });
      expect(by[99]).toMatchObject({ payment: 'blocked', blocked_code: 'not_found', will_emit: false });
      expect(r.store_eligible).toBe(true);
      expect(r.store_blocker).toBeNull();
      expect(r.summary).toMatchObject({ total: 7, paid: 1, credit_existing: 1, to_credit: 1, blocked: 4, will_emit: 3 });
    });

    it('order with a complete customer shows the customer as nominative holder', async () => {
      const { service } = build({ orders: [order(1)] });
      const [row] = (await service.preview({ ids: [1] })).results;
      expect(row.holder).toEqual({
        rail: 'nominative',
        source: 'customer',
        name: 'Juan Pérez',
        document_type: 'CC',
        document_number: '1020304050',
        verification_digit: null,
      });
      expect(row.holder_issue).toBeNull();
      expect(row.cf_overridable).toBe(false);
    });

    it('paid order without customer goes out as Consumidor final (source none) and counts as final_consumer', async () => {
      const { service } = build({ orders: [order(1, { customer_id: null, users: null })] });
      const r = await service.preview({ ids: [1] });
      expect(r.results[0]).toMatchObject({
        will_emit: true,
        holder_issue: null,
        cf_overridable: false,
        holder: { rail: 'final_consumer', source: 'none', document_number: '222222222222' },
      });
      expect(r.summary.final_consumer).toBe(1);
    });

    it('customer that would silently fall to CF: holder_issue, will_emit false, cf_overridable true', async () => {
      const { service } = build({ orders: [order(1, { users: customer({ last_name: '' }) })] });
      const r = await service.preview({ ids: [1] });
      expect(r.results[0]).toMatchObject({
        will_emit: false,
        cf_overridable: true,
        holder: { rail: 'final_consumer', source: 'customer', document_number: '222222222222' },
        holder_issue: { code: 'missing_name', missing_fields: ['last_name'] },
      });
      expect(r.results[0].holder_issue!.message).toContain('Juan');
      expect(r.summary.cf_overridable).toBe(1);
      expect(r.summary.final_consumer).toBe(0);
    });

    it.each([
      ['guest with only a reference name', { customer_id: null, users: null, invoice_data_requests: [{ document_type: null, document_number: null, first_name: 'Andrea león', last_name: null }] }],
      ['customer registered only with a name', { users: customer({ document_type: null, document_number: null, last_name: null }) }],
      ['the Consumidor final customer (sentinel)', { users: customer({ document_number: '222222222222' }) }],
    ])('paid order of an unidentified buyer (%s): emits as Consumidor final without opt-in', async (_label, over) => {
      const { service } = build({ orders: [order(1, over)] });
      const r = await service.preview({ ids: [1] });
      expect(r.results[0]).toMatchObject({
        payment: 'paid',
        will_emit: true,
        holder_issue: null,
        cf_overridable: false,
        skip_reason: null,
        holder: { rail: 'final_consumer', document_number: '222222222222' },
      });
      expect(r.summary.final_consumer).toBe(1);
    });

    it('unpaid order of the Consumidor final customer is blocked for credit (customer_required)', async () => {
      const { service } = build({
        orders: [order(1, { users: customer({ document_number: '222222222222' }), payments: [], state: 'created' })],
      });
      const r = await service.preview({ ids: [1] });
      expect(r.results[0]).toMatchObject({ payment: 'blocked', blocked_code: 'customer_required' });
    });

    it('document_type_required: not overridable, nominative with empty type', async () => {
      const { service } = build({
        orders: [
          order(1, {
            users: customer({ document_type: null, document_number: '900123456', legal_name: 'ACME SAS', first_name: null, last_name: null }),
          }),
        ],
      });
      const [row] = (await service.preview({ ids: [1] })).results;
      expect(row).toMatchObject({
        will_emit: false,
        cf_overridable: false,
        holder: { rail: 'nominative', document_type: '' },
        holder_issue: { code: 'document_type_required' },
      });
    });

    it('already invoiced orders are blocked; a rejected document is retryable', async () => {
      const { service } = build({
        orders: [order(1), order(2)],
        invoices: [
          { order_id: 1, status: 'accepted' },
          { order_id: 2, status: 'rejected' },
        ],
      });
      const by = Object.fromEntries((await service.preview({ ids: [1, 2] })).results.map((x) => [x.id, x]));
      expect(by[1]).toMatchObject({ payment: 'blocked', blocked_code: 'already_invoiced', will_emit: false });
      expect(by[2]).toMatchObject({ will_emit: true, blocked_code: null });
    });

    it('active split is blocked as split_active', async () => {
      const { service } = build({ orders: [order(1, { active_financial_split_id: 3 })] });
      expect((await service.preview({ ids: [1] })).results[0]).toMatchObject({ blocked_code: 'split_active' });
    });

    it('orders held by another operation are blocked as in_process', async () => {
      const { service, keys } = build({ orders: [order(1), order(2)] });
      keys.set('lease:order:1:2', 'other');
      const by = Object.fromEntries((await service.preview({ ids: [1, 2] })).results.map((x) => [x.id, x]));
      expect(by[1].will_emit).toBe(true);
      expect(by[2]).toMatchObject({ payment: 'blocked', blocked_code: 'in_process', will_emit: false });
    });

    it('store not eligible: store_eligible false, blocker text, every will_emit false', async () => {
      const { service } = build({ orders: [order(1), order(2)], eligible: false });
      const r = await service.preview({ ids: [1, 2] });
      expect(r.store_eligible).toBe(false);
      expect(r.store_blocker).toBe('Falta la resolución DIAN.');
      expect(r.results.every((x) => x.will_emit === false)).toBe(true);
      expect(r.summary.will_emit).toBe(0);
    });

    it('is read-only: never emits and holds no lease afterwards', async () => {
      const { service, one_shot, keys } = build({ orders: [order(1)] });
      await service.preview({ ids: [1] });
      expect(one_shot.emitOrder).not.toHaveBeenCalled();
      expect(keys.size).toBe(0);
    });
  });

  describe('execute', () => {
    const item = (order_id: number, expected = '1020304050', extra: Record<string, unknown> = {}) => ({
      order_id,
      expected_holder_document: expected,
      ...extra,
    });

    it('emits a paid order without credit and reports invoice number and status', async () => {
      const { service, one_shot } = build({ orders: [order(1)] });
      const r = await service.execute({ items: [item(1)] });
      expect(one_shot.emitOrder).toHaveBeenCalledWith(1, undefined, undefined);
      expect(r).toEqual({
        total: 1,
        successful: 1,
        failed: 0,
        results: [{ id: 1, status: 'ok', invoice_number: 'FE-1', invoice_status: 'accepted' }],
      });
    });

    it('paid order of a guest with only a name: emits to Consumidor final without the opt-in', async () => {
      const { service, one_shot } = build({
        orders: [order(1, { customer_id: null, users: null, invoice_data_requests: [{ document_type: null, document_number: null, first_name: 'Andrea', last_name: null }] })],
      });
      const r = await service.execute({ items: [item(1, '222222222222')] });
      expect(one_shot.emitOrder).toHaveBeenCalledWith(1, undefined, undefined);
      expect(r.results[0].status).toBe('ok');
    });

    it('holder changed since the preview: INVOICING_BULK_HOLDER_CHANGED_001 and nothing is emitted', async () => {
      const { service, one_shot } = build({ orders: [order(1)] });
      const r = await service.execute({ items: [item(1, '999')] });
      expect(one_shot.emitOrder).not.toHaveBeenCalled();
      expect(r.results[0]).toMatchObject({
        id: 1,
        status: 'error',
        code: ErrorCodes.INVOICING_BULK_HOLDER_CHANGED_001.code,
        message: 'El titular cambió desde la vista previa; vuelve a revisar.',
      });
    });

    it('holder with an issue and no override: error, nothing emitted', async () => {
      const { service, one_shot } = build({
        orders: [order(1, { users: customer({ last_name: '' }) })],
      });
      const r = await service.execute({ items: [item(1, '222222222222')] });
      expect(one_shot.emitOrder).not.toHaveBeenCalled();
      expect(r.results[0]).toMatchObject({ status: 'error', code: ErrorCodes.INVOICING_BULK_HOLDER_INCOMPLETE_001.code });
      expect(r.results[0].message).toContain('Juan');
    });

    it.each([
      ['credit_existing', { payment_form: '2', payments: [] }],
    ])('A5: %s order with an incomplete holder is never CF: not overridable, reason says so, nothing emitted', async (_label, over) => {
      const { service, one_shot } = build({
        orders: [order(1, { users: customer({ last_name: '' }), ...over })],
      });
      const p = await service.preview({ ids: [1] });
      expect(p.results[0]).toMatchObject({ cf_overridable: false, will_emit: false });
      expect(p.results[0].skip_reason).toBe(CREDIT_FINAL_CONSUMER_MESSAGE);
      const r = await service.execute({
        items: [item(1, '222222222222', { allow_final_consumer: true })],
        credit: { due_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) },
      } as any);
      expect(r.results[0]).toMatchObject({ status: 'error', message: CREDIT_FINAL_CONSUMER_MESSAGE });
      expect(one_shot.emitOrder).not.toHaveBeenCalled();
    });

    it('A5: unpaid (to_credit) order with an incomplete holder can go out as CF cash: overridable, no credit passed', async () => {
      const { service, one_shot } = build({
        orders: [order(1, { users: customer({ last_name: '' }), payments: [], state: 'created' })],
      });
      const p = await service.preview({ ids: [1] });
      expect(p.results[0]).toMatchObject({ payment: 'to_credit', cf_overridable: true, will_emit: false });
      const r = await service.execute({
        items: [item(1, '222222222222', { allow_final_consumer: true })],
      });
      expect(one_shot.emitOrder).toHaveBeenCalledWith(1, undefined, { force_final_consumer: true });
      expect(r.results[0].status).toBe('ok');
    });

    it('A5: unpaid (to_credit) order with an incomplete holder and no CF opt-in still errors (credit needs the holder)', async () => {
      const { service, one_shot } = build({
        orders: [order(1, { users: customer({ last_name: '' }), payments: [], state: 'created' })],
      });
      const r = await service.execute({
        items: [item(1, '1020304050')],
        credit: { due_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) },
      } as any);
      expect(r.results[0].status).toBe('error');
      expect(one_shot.emitOrder).not.toHaveBeenCalled();
    });

    it('CF override: expected holder is 222222222222 and the emission is forced to final consumer', async () => {
      const { service, one_shot } = build({
        orders: [order(1, { users: customer({ last_name: '' }) })],
      });
      const r = await service.execute({
        items: [item(1, '222222222222', { allow_final_consumer: true })],
      });
      expect(one_shot.emitOrder).toHaveBeenCalledWith(1, undefined, { force_final_consumer: true });
      expect(r.results[0].status).toBe('ok');
    });

    it('CF override with a wrong expected holder: HOLDER_CHANGED', async () => {
      const { service, one_shot } = build({
        orders: [order(1, { users: customer({ last_name: '' }) })],
      });
      const r = await service.execute({
        items: [item(1, '1020304050', { allow_final_consumer: true })],
      });
      expect(one_shot.emitOrder).not.toHaveBeenCalled();
      expect(r.results[0].code).toBe(ErrorCodes.INVOICING_BULK_HOLDER_CHANGED_001.code);
    });

    it('CF override never applies to document_type_required', async () => {
      const { service, one_shot } = build({
        orders: [
          order(1, {
            users: customer({ document_type: null, document_number: '900123456', legal_name: 'ACME SAS', first_name: null, last_name: null }),
          }),
        ],
      });
      const r = await service.execute({
        items: [item(1, '222222222222', { allow_final_consumer: true })],
      });
      expect(one_shot.emitOrder).not.toHaveBeenCalled();
      expect(r.results[0].code).toBe(ErrorCodes.INVOICING_ACQUIRER_DOCUMENT_TYPE_REQUIRED.code);
    });

    it('to_credit without credit: INVOICING_CREDIT_DUE_DATE_001', async () => {
      const { service, one_shot } = build({ orders: [order(1, { payments: [] })] });
      const r = await service.execute({ items: [item(1)] });
      expect(one_shot.emitOrder).not.toHaveBeenCalled();
      expect(r.results[0]).toMatchObject({ status: 'error', code: ErrorCodes.INVOICING_CREDIT_DUE_DATE_001.code });
    });

    it('passes credit only to to_credit orders', async () => {
      const credit = { due_date: '2099-01-01', payment_means_code: '42' };
      const { service, one_shot } = build({
        orders: [order(1), order(2, { payments: [] }), order(3, { payment_form: '2', payments: [] })],
      });
      await service.execute({ items: [item(1), item(2), item(3)], credit });
      const calls = (one_shot.emitOrder as jest.Mock).mock.calls;
      expect(calls.find((c) => c[0] === 1)[1]).toBeUndefined();
      expect(calls.find((c) => c[0] === 2)[1]).toEqual(credit);
      expect(calls.find((c) => c[0] === 3)[1]).toBeUndefined();
    });

    it('blocked orders error with a code and the others keep going', async () => {
      const { service, one_shot } = build({
        orders: [order(1, { state: 'cancelled' }), order(2)],
        invoices: [],
      });
      const r = await service.execute({ items: [item(1), item(2)] });
      expect(r.results[0]).toMatchObject({ id: 1, status: 'error', code: ErrorCodes.INVOICING_CREDIT_ORDER_STATE_001.code });
      expect(r.results[1]).toMatchObject({ id: 2, status: 'ok' });
      expect(one_shot.emitOrder).toHaveBeenCalledTimes(1);
      expect(r).toMatchObject({ total: 2, successful: 1, failed: 1 });
    });

    it.each([
      ['pending', 'sent'],
      ['issued', 'validated'],
      ['issued', 'rejected'],
    ])('S10: state %s with invoice status %s is NOT success (only accepted counts)', async (state, dian_status) => {
      const { service, one_shot } = build({ orders: [order(1)] });
      (one_shot.emitOrder as jest.Mock).mockResolvedValueOnce({
        state,
        invoice_id: 9,
        invoice_number: 'FE-9',
        dian_status,
        message: 'en proceso',
      });
      const r = await service.execute({ items: [item(1)] });
      expect(r).toMatchObject({ successful: 0, failed: 1 });
      expect(r.results[0]).toMatchObject({
        status: 'error',
        code: ErrorCodes.INVOICING_BULK_EMISSION_FAILED_001.code,
      });
      expect(r.results[0].message).toContain(dian_status);
    });

    it('one emission throwing does not stop the rest; failed result state is an error with its reason', async () => {
      const { service, one_shot } = build({ orders: [order(1), order(2), order(3)] });
      (one_shot.emitOrder as jest.Mock)
        .mockRejectedValueOnce(Object.assign(new Error('boom'), {}))
        .mockResolvedValueOnce({ state: 'failed', invoice_id: null, invoice_number: null, dian_status: null, message: 'DIAN rechazó el XML' })
        .mockResolvedValueOnce({ state: 'issued', invoice_id: 3, invoice_number: 'FE-3', dian_status: 'accepted', message: null });
      const r = await service.execute({ items: [item(1), item(2), item(3)] });
      expect(r.results.map((x) => x.status)).toEqual(['error', 'error', 'ok']);
      expect(r.results[1]).toMatchObject({
        code: ErrorCodes.INVOICING_BULK_EMISSION_FAILED_001.code,
        message: 'DIAN rechazó el XML',
      });
      expect(r.results[2].invoice_number).toBe('FE-3');
    });

    it('lease held by another operation: that order errors ORDERS_BULK_LOCKED_001, others proceed', async () => {
      const { service, one_shot, keys } = build({ orders: [order(1), order(2)] });
      keys.set('lease:order:1:1', 'other');
      const r = await service.execute({ items: [item(1), item(2)] });
      expect(r.results[0]).toMatchObject({
        id: 1,
        status: 'error',
        code: ErrorCodes.ORDERS_BULK_LOCKED_001.code,
        message: 'Esta orden se está procesando en otra operación; inténtalo cuando termine.',
      });
      expect(r.results[1].status).toBe('ok');
      expect(one_shot.emitOrder).toHaveBeenCalledTimes(1);
      expect(keys.get('lease:order:1:1')).toBe('other');
    });

    it('releases the lease after success and after failure', async () => {
      const { service, one_shot, keys } = build({ orders: [order(1), order(2)] });
      (one_shot.emitOrder as jest.Mock).mockRejectedValueOnce(new Error('boom'));
      await service.execute({ items: [item(1), item(2)] });
      expect(keys.size).toBe(0);
    });

    it('order not found: error INVOICING_FIND_003', async () => {
      const { service } = build({ orders: [] });
      const r = await service.execute({ items: [item(7)] });
      expect(r.results[0]).toMatchObject({ id: 7, status: 'error', code: ErrorCodes.INVOICING_FIND_003.code });
    });
  });
});
