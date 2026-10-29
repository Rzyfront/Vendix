import { OrderFlowService } from './order-flow.service';
import { mockRequestContext } from 'src/testing/prisma-mock';

jest.mock('../../invoicing/credit-notes/credit-notes.service', () => ({
  CreditNotesService: class CreditNotesServiceToken {},
}));

/**
 * cod-auto-invoicing S5 — "En el caso de que se canceló una orden, también que
 * se cancele y se emita una nota crédito total." Cancelling an order whose
 * e-invoice the DIAN already accepted emits a TOTAL credit note first, only
 * when the operator confirmed it (`issueCreditNote: true`); without that
 * confirmation the existing ORD_CANCEL_CREDIT_NOTE_REQUIRED_001 guard stays.
 */
describe('OrderFlowService — nota crédito total al cancelar (S5)', () => {
  const ORDER_ID = 60;
  const STORE_ID = 4;
  const ORDER = { id: ORDER_ID, store_id: STORE_ID, order_number: 'ORD-60' };

  let service: any;
  let prismaMock: any;
  let creditNotes: { createCreditNote: jest.Mock; issueNote: jest.Mock };
  let invoices: any[];
  let notes: any[];

  beforeEach(() => {
    mockRequestContext({ store_id: STORE_ID, organization_id: 77, user_id: 9 });
    invoices = [{ id: 900, invoice_number: 'FE-12', accounting_entity_id: 3 }];
    notes = [];
    prismaMock = {
      invoices: {
        findMany: jest.fn(async ({ where }: any) =>
          where.invoice_type === 'sales_invoice' ? invoices : notes,
        ),
      },
    };
    const lockTx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]) };
    prismaMock.$transaction = jest.fn(async (work: any) => work(lockTx));
    creditNotes = {
      createCreditNote: jest.fn().mockResolvedValue({ id: 950 }),
      issueNote: jest.fn().mockResolvedValue({ invoice: { id: 950, status: 'accepted' } }),
    };
    service = Object.create(OrderFlowService.prototype);
    Object.assign(service, {
      prisma: prismaMock,
      moduleRef: { get: jest.fn(() => creditNotes) },
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  it('creates and issues a total credit note for each accepted invoice', async () => {
    await service.issueCancellationCreditNotes(ORDER, 'Cliente desistió');

    expect(prismaMock.invoices.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order_id: ORDER_ID,
          store_id: STORE_ID,
          invoice_type: 'sales_invoice',
          status: 'accepted',
        }),
      }),
    );
    // Total note: only the related invoice, no items, no refund.
    expect(creditNotes.createCreditNote).toHaveBeenCalledWith({
      related_invoice_id: 900,
      reason: 'Anulación de la orden ORD-60: Cliente desistió',
    });
    expect(creditNotes.issueNote).toHaveBeenCalledWith(950);
  });

  it('does nothing when the invoice already has an accepted credit note', async () => {
    notes = [{ id: 951, status: 'accepted' }];
    await service.issueCancellationCreditNotes(ORDER, 'x');
    expect(creditNotes.createCreditNote).not.toHaveBeenCalled();
    expect(creditNotes.issueNote).not.toHaveBeenCalled();
  });

  it('issues a pending draft credit note instead of creating a second one', async () => {
    notes = [{ id: 952, status: 'draft' }];
    await service.issueCancellationCreditNotes(ORDER, 'x');
    expect(creditNotes.createCreditNote).not.toHaveBeenCalled();
    expect(creditNotes.issueNote).toHaveBeenCalledWith(952);
  });

  it('does not duplicate a note already sent and awaiting the DIAN', async () => {
    notes = [{ id: 953, status: 'sent' }];
    await service.issueCancellationCreditNotes(ORDER, 'x');
    expect(creditNotes.createCreditNote).not.toHaveBeenCalled();
    expect(creditNotes.issueNote).not.toHaveBeenCalled();
  });

  it('leaves a validated note to the DIAN retry queue instead of re-validating it', async () => {
    notes = [{ id: 955, status: 'validated' }];
    await service.issueCancellationCreditNotes(ORDER, 'x');
    expect(creditNotes.createCreditNote).not.toHaveBeenCalled();
    expect(creditNotes.issueNote).not.toHaveBeenCalled();
  });

  it('creates a new note when the previous one was rejected', async () => {
    notes = [{ id: 954, status: 'rejected' }];
    await service.issueCancellationCreditNotes(ORDER, 'x');
    expect(creditNotes.createCreditNote).toHaveBeenCalledTimes(1);
    expect(creditNotes.issueNote).toHaveBeenCalledWith(950);
  });

  it('touches nothing when the order has no accepted e-invoice', async () => {
    invoices = [];
    await service.issueCancellationCreditNotes(ORDER, 'x');
    expect(creditNotes.createCreditNote).not.toHaveBeenCalled();
  });

  describe('concurrent cancellations (release review #989, finding 3)', () => {
    let tx: { $queryRaw: jest.Mock };

    beforeEach(() => {
      tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]) };
      prismaMock.$transaction = jest.fn(async (work: any) => work(tx));
    });

    it('holds an order-scoped lock while it creates and issues the note', async () => {
      await service.issueCancellationCreditNotes(ORDER, 'x');
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        creditNotes.createCreditNote.mock.invocationCallOrder[0],
      );
      expect(creditNotes.issueNote).toHaveBeenCalledWith(950);
    });

    it('a second cancellation while the first is emitting gets a typed 409 and creates no note', async () => {
      tx.$queryRaw.mockResolvedValue([{ locked: false }]);
      await expect(service.issueCancellationCreditNotes(ORDER, 'x')).rejects.toMatchObject({
        errorCode: 'ORD_FISCAL_NOTE_IN_PROGRESS_001',
      });
      expect(creditNotes.createCreditNote).not.toHaveBeenCalled();
      expect(creditNotes.issueNote).not.toHaveBeenCalled();
    });
  });

  describe('cancelOrder wiring', () => {
    const SENTINEL = new Error('tx-reached');

    const arrange = () => {
      const order = {
        ...ORDER,
        state: 'created',
        payments: [],
        order_items: [],
        internal_notes: null,
        delivered_at: null,
        active_financial_split_id: null,
      };
      Object.assign(service, {
        getOrder: jest.fn().mockResolvedValue(order),
        assertNoOpenTableForDraft: jest.fn().mockResolvedValue(undefined),
        validateTransition: jest.fn(),
        issueCancellationCreditNotes: jest.fn().mockResolvedValue(undefined),
      });
      prismaMock.order_items = { findMany: jest.fn().mockResolvedValue([]) };
      prismaMock.$transaction = jest.fn().mockRejectedValue(SENTINEL);
    };

    it('emits the credit note before the cancel transaction when confirmed', async () => {
      arrange();
      await expect(
        service.cancelOrder(ORDER_ID, { reason: 'Cliente desistió', issueCreditNote: true }),
      ).rejects.toBe(SENTINEL);
      expect(service.issueCancellationCreditNotes).toHaveBeenCalledWith(
        expect.objectContaining({ id: ORDER_ID }),
        'Cliente desistió',
      );
      expect(service.issueCancellationCreditNotes.mock.invocationCallOrder[0]).toBeLessThan(
        prismaMock.$transaction.mock.invocationCallOrder[0],
      );
    });

    it('keeps today\'s behaviour (no note) without the confirmation', async () => {
      arrange();
      await expect(service.cancelOrder(ORDER_ID, { reason: 'abc' })).rejects.toBe(SENTINEL);
      expect(service.issueCancellationCreditNotes).not.toHaveBeenCalled();
    });

    it('never emits a note when a partially refunded payment will block the cancellation (finding 2)', async () => {
      arrange();
      service.getOrder.mockResolvedValue({
        ...ORDER, state: 'created', internal_notes: null,
        delivered_at: null, active_financial_split_id: null, order_items: [],
        payments: [{ id: 71, state: 'partially_refunded', amount: 1000 }],
      });
      await expect(
        service.cancelOrder(ORDER_ID, { reason: 'abc', issueCreditNote: true }),
      ).rejects.toMatchObject({ errorCode: 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001' });
      expect(service.issueCancellationCreditNotes).not.toHaveBeenCalled();
    });

    it('never emits a note when the order belongs to an open table (finding 2)', async () => {
      arrange();
      service.assertNoOpenTableForDraft.mockRejectedValueOnce(Object.assign(new Error('open table'), { errorCode: 'ORD_CANCEL_OPEN_TABLE_001' }));
      await expect(
        service.cancelOrder(ORDER_ID, { reason: 'abc', issueCreditNote: true }),
      ).rejects.toMatchObject({ errorCode: 'ORD_CANCEL_OPEN_TABLE_001' });
      expect(service.issueCancellationCreditNotes).not.toHaveBeenCalled();
    });

    it('never emits a note when the order cannot be cancelled anyway', async () => {
      arrange();
      service.getOrder.mockResolvedValue({
        ...ORDER, state: 'created', payments: [], internal_notes: null,
        delivered_at: null, active_financial_split_id: null,
        order_items: [{ inventory_committed: true, inventory_consumed_at_fire: false }],
      });
      await expect(
        service.cancelOrder(ORDER_ID, { reason: 'abc', issueCreditNote: true }),
      ).rejects.toBe(SENTINEL);
      expect(service.issueCancellationCreditNotes).not.toHaveBeenCalled();
    });
  });
});
