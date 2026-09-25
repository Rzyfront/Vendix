import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../../../common/errors';
import { ResponseService } from '../../../../common/responses/response.service';
import { OrderFlowController } from './order-flow.controller';
import { ResolveRefundDto, RefundPayoutChannel, RefundResolvableState } from './dto/resolve-refund.dto';
import { validate } from 'class-validator';

describe('OrderFlowController.payOrder — fully-paid preflight', () => {
  const setup = (state: 'created' | 'shipped' | 'processing', paid: string) => {
    const service = {
      getAvailableActions: jest.fn().mockResolvedValue([]),
      getOrder: jest.fn().mockResolvedValue({
        id: 700,
        state,
        grand_total: new Prisma.Decimal('100.00'),
        payments: [{ state: 'succeeded', amount: new Prisma.Decimal(paid) }],
      }),
      payOrder: jest.fn(),
    };
    const audit = { logCustom: jest.fn() };
    const controller = new OrderFlowController(
      service as any,
      {} as any,
      {} as any,
      {} as any,
      new ResponseService(),
      audit as any,
      { orders: { findFirst: jest.fn() } } as any,
    );
    return { controller, service, audit };
  };

  for (const state of ['created', 'shipped', 'processing'] as const) {
    it(`returns ORD_PAY_ALREADY_PAID_001 for settled ${state} before audit/write`, async () => {
      const { controller, service, audit } = setup(state, '100.00');

      await expect(controller.payOrder(700, {} as any, { user: { id: 1 } } as any))
        .rejects.toMatchObject({
          errorCode: ErrorCodes.ORD_PAY_ALREADY_PAID_001.code,
        });
      expect(service.payOrder).not.toHaveBeenCalled();
      expect(audit.logCustom).not.toHaveBeenCalled();
    });
  }

  it('keeps unavailable-action rejection distinct for an unpaid order', async () => {
    const { controller, service } = setup('processing', '50.00');

    await expect(controller.payOrder(700, {} as any, { user: { id: 1 } } as any))
      .rejects.toMatchObject({
        errorCode: ErrorCodes.ORD_FLOW_PAYMENT_FAILED_001.code,
      });
    expect(service.payOrder).not.toHaveBeenCalled();
  });
});

describe('OrderFlowController.resolveRefund — payout contract', () => {
  const refundFlow = { manuallyResolveRefund: jest.fn() };
  const controller = new OrderFlowController(
    {} as any,
    refundFlow as any,
    {} as any,
    {} as any,
    new ResponseService(),
    {} as any,
    {} as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('forwards verified payout fields for completed resolution', async () => {
    refundFlow.manuallyResolveRefund.mockResolvedValue({ id: 999, state: 'completed' });
    const dto = Object.assign(new ResolveRefundDto(), {
      target_state: RefundResolvableState.COMPLETED,
      resolution_notes: 'Banco confirmó el egreso',
      payout_reference: 'BANK-999',
      payout_channel: RefundPayoutChannel.BANK_TRANSFER,
    });
    await controller.resolveRefund(3830, 999, dto, { user: { id: 7 } } as any);
    expect(refundFlow.manuallyResolveRefund).toHaveBeenCalledWith(
      3830, 999, 'completed', 'Banco confirmó el egreso', 7,
      'BANK-999', RefundPayoutChannel.BANK_TRANSFER,
    );
  });

  it('requires reference and channel only for completed, not failed with notes', async () => {
    const completed = Object.assign(new ResolveRefundDto(), {
      target_state: RefundResolvableState.COMPLETED,
      resolution_notes: 'Egreso confirmado',
    });
    const failed = Object.assign(new ResolveRefundDto(), {
      target_state: RefundResolvableState.FAILED,
      resolution_notes: 'El procesador rechazó la reversión',
    });
    expect((await validate(completed)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['payout_reference', 'payout_channel']),
    );
    expect(await validate(failed)).toEqual([]);
  });
});
