import { RequestContextService } from '@common/context/request-context.service';
import { WorkflowVendixActionName } from '@common/workflows/contract';
import { WorkflowOperationsActions } from './operations.actions';
import {
  WorkflowActionContext,
  WorkflowActionInputError,
} from './workflow-action.types';
import { WorkflowInstanceRow } from '../workflow-engine.types';

const STORE_ID = 5;
const ORG_ID = 2;
const ACTING_USER = 9;

/** Records the request context the service saw (proves asPublisher wrapped it). */
let seen: { store_id?: number; user_id?: number } | undefined;
const observe = <T>(value: T) =>
  jest.fn(async (..._args: unknown[]) => {
    const c = RequestContextService.getContext();
    seen = { store_id: c?.store_id, user_id: c?.user_id };
    return value;
  });

function build() {
  const prisma = { invoices: { findFirst: jest.fn() } };
  const adjustments = { createAdjustment: observe({ id: 11 }) };
  const transfers = { create: observe({ id: 12 }) };
  const invoicing = { createFromOrder: observe({ id: 13 }) };
  const creditNotes = { createCreditNote: observe({ id: 14 }) };
  const invoiceDelivery = {
    deliver: observe({ invoice_id: 77, recipient: 'x@y.co' }),
  };
  const orderFlow = {
    payOrder: observe({ order: { id: 40 }, payment: {} }),
    shipOrder: observe({ id: 41 }),
    deliverOrder: observe({ id: 42 }),
    cancelOrder: observe({ id: 43 }),
  };
  const actions = new WorkflowOperationsActions(
    prisma as never,
    adjustments as never,
    transfers as never,
    invoicing as never,
    creditNotes as never,
    invoiceDelivery as never,
    orderFlow as never,
  );
  return {
    actions,
    prisma,
    adjustments,
    transfers,
    invoicing,
    creditNotes,
    invoiceDelivery,
    orderFlow,
  };
}

function ctx(map: Record<string, unknown>): WorkflowActionContext {
  return {
    instance: { store_id: STORE_ID, organization_id: ORG_ID } as WorkflowInstanceRow,
    map,
    actingUserId: ACTING_USER,
    permissions: [],
    asPublisher: (fn) =>
      RequestContextService.runIsolated(
        {
          store_id: STORE_ID,
          organization_id: ORG_ID,
          user_id: ACTING_USER,
          is_super_admin: false,
          is_owner: false,
          permissions: [],
        },
        fn,
      ),
  };
}

const run = (
  b: ReturnType<typeof build>,
  action: WorkflowVendixActionName,
  map: Record<string, unknown>,
) => b.actions.handlers[action]!(ctx(map));

const allServiceCalls = (b: ReturnType<typeof build>) =>
  [
    b.adjustments.createAdjustment,
    b.transfers.create,
    b.invoicing.createFromOrder,
    b.creditNotes.createCreditNote,
    b.invoiceDelivery.deliver,
    b.orderFlow.payOrder,
    b.orderFlow.shipOrder,
    b.orderFlow.deliverOrder,
    b.orderFlow.cancelOrder,
  ].reduce((n, f) => n + f.mock.calls.length, 0);

const expectActsAsPublisher = () =>
  expect(seen).toEqual({ store_id: STORE_ID, user_id: ACTING_USER });

describe('WorkflowOperationsActions', () => {
  beforeEach(() => {
    seen = undefined;
  });

  describe('vendix.inventory.adjust', () => {
    const map = {
      product_id: '4',
      location_id: '3',
      quantity_after: '25',
      adjustment_type: 'count_variance',
      reason: 'Conteo de cierre',
    };

    it('sends the absolute target quantity as the UI form does', async () => {
      const b = build();
      await expect(run(b, 'vendix.inventory.adjust', map)).resolves.toEqual({
        record_id: 11,
      });
      expect(b.adjustments.createAdjustment).toHaveBeenCalledWith({
        product_id: 4,
        location_id: 3,
        quantity_after: 25,
        type: 'count_variance',
        description: 'Conteo de cierre',
      });
      expectActsAsPublisher();
    });

    it.each([
      ['negative quantity', { ...map, quantity_after: '-1' }],
      ['unknown type', { ...map, adjustment_type: 'initial_load' }],
      ['missing product', { ...map, product_id: '' }],
    ])('rejects %s without calling the service', async (_n, bad) => {
      const b = build();
      await expect(run(b, 'vendix.inventory.adjust', bad)).rejects.toBeInstanceOf(
        WorkflowActionInputError,
      );
      expect(allServiceCalls(b)).toBe(0);
    });
  });

  describe('vendix.inventory.transfer', () => {
    const map = {
      from_location_id: '1',
      to_location_id: '2',
      product_id: '4',
      quantity: '6',
      notes: 'Reposición',
    };

    it('creates a transfer with one line and never completes it', async () => {
      const b = build();
      await expect(run(b, 'vendix.inventory.transfer', map)).resolves.toEqual({
        record_id: 12,
      });
      expect(b.transfers.create).toHaveBeenCalledWith({
        from_location_id: 1,
        to_location_id: 2,
        notes: 'Reposición',
        items: [{ product_id: 4, quantity: 6 }],
      });
      expectActsAsPublisher();
    });

    it.each([
      ['zero quantity', { ...map, quantity: '0' }],
      ['missing destination', { ...map, to_location_id: '' }],
    ])('rejects %s without calling the service', async (_n, bad) => {
      const b = build();
      await expect(run(b, 'vendix.inventory.transfer', bad)).rejects.toBeInstanceOf(
        WorkflowActionInputError,
      );
      expect(allServiceCalls(b)).toBe(0);
    });
  });

  describe('vendix.invoice.create_from_order', () => {
    it('invoices the order', async () => {
      const b = build();
      await expect(
        run(b, 'vendix.invoice.create_from_order', { order_id: '30' }),
      ).resolves.toEqual({ record_id: 13 });
      expect(b.invoicing.createFromOrder).toHaveBeenCalledWith(30);
      expectActsAsPublisher();
    });

    it('rejects a bad order id without calling the service', async () => {
      const b = build();
      await expect(
        run(b, 'vendix.invoice.create_from_order', { order_id: 'abc' }),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(allServiceCalls(b)).toBe(0);
    });
  });

  describe('vendix.credit_note.create', () => {
    it('requests a total note (no items) with the reason', async () => {
      const b = build();
      await expect(
        run(b, 'vendix.credit_note.create', { invoice_id: '8', reason: 'Anulación' }),
      ).resolves.toEqual({ record_id: 14 });
      expect(b.creditNotes.createCreditNote).toHaveBeenCalledWith({
        related_invoice_id: 8,
        reason: 'Anulación',
      });
      expectActsAsPublisher();
    });

    it('rejects a missing reason without calling the service', async () => {
      const b = build();
      await expect(
        run(b, 'vendix.credit_note.create', { invoice_id: '8', reason: '' }),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(allServiceCalls(b)).toBe(0);
    });
  });

  describe('vendix.invoice.send_email', () => {
    it('sends to the given email', async () => {
      const b = build();
      await expect(
        run(b, 'vendix.invoice.send_email', { invoice_id: '7', email: 'a@b.co' }),
      ).resolves.toEqual({ record_id: 77 });
      expect(b.invoiceDelivery.deliver).toHaveBeenCalledWith(7, { email: 'a@b.co' });
      expect(b.prisma.invoices.findFirst).not.toHaveBeenCalled();
      expectActsAsPublisher();
    });

    it('falls back to the invoice customer email', async () => {
      const b = build();
      b.prisma.invoices.findFirst.mockResolvedValue({ customer_email: 'c@d.co' });
      await run(b, 'vendix.invoice.send_email', { invoice_id: '7', email: '' });
      expect(b.invoiceDelivery.deliver).toHaveBeenCalledWith(7, { email: 'c@d.co' });
    });

    it('fails without sending when the invoice is not in the store', async () => {
      const b = build();
      b.prisma.invoices.findFirst.mockResolvedValue(null);
      await expect(
        run(b, 'vendix.invoice.send_email', { invoice_id: '7', email: '' }),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(b.invoiceDelivery.deliver).not.toHaveBeenCalled();
    });

    it('fails without sending when there is no email at all', async () => {
      const b = build();
      b.prisma.invoices.findFirst.mockResolvedValue({ customer_email: null });
      await expect(
        run(b, 'vendix.invoice.send_email', { invoice_id: '7', email: '' }),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(b.invoiceDelivery.deliver).not.toHaveBeenCalled();
    });

    it('rejects a bad invoice id without calling anything', async () => {
      const b = build();
      await expect(
        run(b, 'vendix.invoice.send_email', { invoice_id: '' }),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(allServiceCalls(b)).toBe(0);
    });
  });

  describe('vendix.order.register_payment', () => {
    const map = {
      order_id: '40',
      store_payment_method_id: '6',
      amount: '150000.5',
      reference: 'REF-1',
    };

    it('registers a direct payment through payOrder', async () => {
      const b = build();
      await expect(run(b, 'vendix.order.register_payment', map)).resolves.toEqual({
        record_id: 40,
      });
      expect(b.orderFlow.payOrder).toHaveBeenCalledWith(40, {
        store_payment_method_id: 6,
        payment_type: 'direct',
        amount: 150000.5,
        payment_reference: 'REF-1',
      });
      expectActsAsPublisher();
    });

    it('rejects a missing amount without calling the service', async () => {
      const b = build();
      await expect(
        run(b, 'vendix.order.register_payment', { ...map, amount: '' }),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(allServiceCalls(b)).toBe(0);
    });
  });

  describe('vendix.order.change_status', () => {
    it('shipped calls shipOrder', async () => {
      const b = build();
      await expect(
        run(b, 'vendix.order.change_status', { order_id: '41', to_state: 'shipped' }),
      ).resolves.toEqual({ record_id: 41 });
      expect(b.orderFlow.shipOrder).toHaveBeenCalledWith(41, {});
      expectActsAsPublisher();
    });

    it('delivered calls deliverOrder', async () => {
      const b = build();
      await expect(
        run(b, 'vendix.order.change_status', { order_id: '42', to_state: 'delivered' }),
      ).resolves.toEqual({ record_id: 42 });
      expect(b.orderFlow.deliverOrder).toHaveBeenCalledWith(42, {});
    });

    it('cancelled calls cancelOrder with the reason', async () => {
      const b = build();
      await expect(
        run(b, 'vendix.order.change_status', {
          order_id: '43',
          to_state: 'cancelled',
          reason: 'Cliente desistió',
        }),
      ).resolves.toEqual({ record_id: 43 });
      expect(b.orderFlow.cancelOrder).toHaveBeenCalledWith(43, {
        reason: 'Cliente desistió',
      });
    });

    it.each([
      ['cancel without reason', { order_id: '43', to_state: 'cancelled' }],
      ['cancel with a too short reason', { order_id: '43', to_state: 'cancelled', reason: 'no' }],
      ['unknown state', { order_id: '43', to_state: 'refunded' }],
      ['missing order', { order_id: '', to_state: 'shipped' }],
    ])('rejects %s without calling the service', async (_n, bad) => {
      const b = build();
      await expect(
        run(b, 'vendix.order.change_status', bad),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(allServiceCalls(b)).toBe(0);
    });
  });

  it('never reports success when the service returns no id', async () => {
    const b = build();
    b.invoicing.createFromOrder.mockResolvedValue(undefined as never);
    await expect(
      run(b, 'vendix.invoice.create_from_order', { order_id: '30' }),
    ).rejects.toThrow('returned no id');
  });
});
