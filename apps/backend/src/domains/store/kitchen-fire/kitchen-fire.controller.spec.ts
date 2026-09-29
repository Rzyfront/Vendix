import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { ResponseService } from '../../../common/responses/response.service';
import { NotificationsSseService } from '../notifications/notifications-sse.service';
import { KitchenFireController } from './kitchen-fire.controller';
import { KitchenFireService } from './kitchen-fire.service';

describe('KitchenFireController — typed errors leave the HTTP handler', () => {
  it('does not convert ticket mutation or read rejections into a 2xx error body', async () => {
    const failure = new VendixHttpException(
      ErrorCodes.KITCHEN_TICKET_NOT_TAKEAWAY,
    );
    const reject = jest.fn().mockRejectedValue(failure);
    const service = {
      startPreparation: reject,
      markReady: reject,
      markDelivered: reject,
      cancelTicket: reject,
      revertTicket: reject,
      findTickets: reject,
      getActiveTicketsSnapshot: reject,
    } as unknown as KitchenFireService;
    const responses = new ResponseService();
    const errorEnvelope = jest.spyOn(responses, 'error');
    const controller = new KitchenFireController(
      service,
      {} as NotificationsSseService,
      responses,
    );

    for (const call of [
      controller.startTicket(1),
      controller.readyTicket(1),
      controller.deliverTicket(1),
      controller.cancelTicket(1),
      controller.revertTicket(1),
      controller.listTickets({ limit: 10 }),
      controller.snapshot({ windowMinutes: 120 }),
    ]) {
      await expect(call).rejects.toBe(failure);
    }
    expect(errorEnvelope).not.toHaveBeenCalled();
  });
});
