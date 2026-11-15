import { DispatchNoteFlowService } from './dispatch-note-flow.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * QUI-893 B3 — invoicing an off-route contra entrega remisión with a balance
 * demands the invoicer's open drawer before the remisión changes state, and
 * the `dispatch_note.invoiced` payload carries who invoiced.
 */
describe('DispatchNoteFlowService.invoice — cash gate of an off-route contra entrega (QUI-893 B3)', () => {
  const NOTE = {
    id: 900,
    status: 'delivered',
    direction: 'outbound',
    store_id: 100,
    order_id: 7777,
    sales_order_id: null as number | null,
    dispatch_number: 'REM-1',
  };

  const build = (note: Partial<typeof NOTE> = {}) => {
    const current = { ...NOTE, ...note };
    const prisma = {
      dispatch_notes: {
        findFirst: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({ ...current, status: 'invoiced' }),
      },
    };
    const eventEmitter = { emit: jest.fn() };
    const orderFlow = {
      assertStandaloneCodInvoiceCashSession: jest.fn().mockResolvedValue(true),
    };
    const service = new DispatchNoteFlowService(
      prisma as never,
      eventEmitter as never,
      {} as never,
      {} as never,
      orderFlow as never,
    );
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(9 as never);
    return { service, prisma, eventEmitter, orderFlow };
  };

  afterEach(() => jest.restoreAllMocks());

  it('without an open drawer the remisión stays delivered and nothing is emitted', async () => {
    const { service, prisma, eventEmitter, orderFlow } = build();
    orderFlow.assertStandaloneCodInvoiceCashSession.mockRejectedValue(
      new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001),
    );
    await expect(service.invoice(900)).rejects.toMatchObject({
      errorCode: 'CASH_SESSION_REQUIRED_001',
    });
    expect(orderFlow.assertStandaloneCodInvoiceCashSession).toHaveBeenCalledWith({
      storeId: 100,
      dispatchNoteId: 900,
      userId: 9,
    });
    expect(prisma.dispatch_notes.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('with the drawer open the invoiced event carries the invoicer and the collection flag', async () => {
    const { service, eventEmitter } = build();
    await service.invoice(900);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'dispatch_note.invoiced',
      expect.objectContaining({
        dispatch_note_id: 900,
        order_id: 7777,
        user_id: 9,
        cod_cash_collection: true,
      }),
    );
  });

  it('route or non-collectable remisión: invoiced as before, flag false', async () => {
    const { service, eventEmitter, orderFlow } = build();
    orderFlow.assertStandaloneCodInvoiceCashSession.mockResolvedValue(false);
    await service.invoice(900);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'dispatch_note.invoiced',
      expect.objectContaining({ cod_cash_collection: false }),
    );
  });

  it('legacy sales-order remisión: no gate (it never collects an order balance)', async () => {
    const { service, orderFlow, eventEmitter } = build({ order_id: null as never, sales_order_id: 55 });
    await service.invoice(900);
    expect(orderFlow.assertStandaloneCodInvoiceCashSession).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'dispatch_note.invoiced',
      expect.objectContaining({ cod_cash_collection: false }),
    );
  });
});
