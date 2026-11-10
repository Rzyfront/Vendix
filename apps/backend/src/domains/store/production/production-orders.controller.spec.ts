import { ForbiddenException } from '@nestjs/common';
import { Subject } from 'rxjs';
import { ProductionOrdersController } from './production-orders.controller';
import { ProductionSseService } from './production-sse.service';
import { RequestContextService } from '../../../common/context/request-context.service';

describe('ProductionOrdersController — card per sale and live stream (QUI-1002)', () => {
  let service: { startSale: jest.Mock; completeSale: jest.Mock };
  let responses: { success: jest.Mock };
  let sse: ProductionSseService;
  let controller: ProductionOrdersController;

  beforeEach(() => {
    service = { startSale: jest.fn(), completeSale: jest.fn() };
    responses = { success: jest.fn((data, message) => ({ success: true, data, message })) };
    sse = new ProductionSseService();
    controller = new ProductionOrdersController(service as any, responses as any, sse);
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 1 } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('POST sale/:orderId/start returns the moved / skipped / failed lists', async () => {
    const summary = { moved: [1], skipped: [2], failed: [{ id: 3, message: 'x' }] };
    service.startSale.mockResolvedValue(summary);
    const res = await controller.startSale(77);
    expect(service.startSale).toHaveBeenCalledWith(77);
    expect(res.data).toEqual(summary);
  });

  it('POST sale/:orderId/complete returns the summary', async () => {
    const summary = { moved: [2], skipped: [], failed: [] };
    service.completeSale.mockResolvedValue(summary);
    const res = await controller.completeSale(77);
    expect(service.completeSale).toHaveBeenCalledWith(77);
    expect(res.data).toEqual(summary);
  });

  describe('GET stream', () => {
    const req = () => {
      const handlers: Record<string, () => void> = {};
      return { on: jest.fn((e: string, h: () => void) => (handlers[e] = h)), handlers } as any;
    };

    it('forwards the store events as JSON data and isolates other stores', () => {
      const r = req();
      const received: any[] = [];
      controller.stream(r).subscribe((e) => received.push(e));

      sse.onProductionOrderUpdated({ type: 'production_order.updated', store_id: 1, id: 5 } as any);
      sse.onProductionOrderUpdated({ type: 'production_order.updated', store_id: 2, id: 6 } as any);

      expect(received).toEqual([
        { data: JSON.stringify({ type: 'production_order.updated', store_id: 1, id: 5 }) },
      ]);
    });

    it('sends a 30 s heartbeat and unsubscribes the store when the request closes', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-10T15:00:00Z'));
      const r = req();
      const received: any[] = [];
      const sub = controller.stream(r).subscribe((e) => received.push(e));
      jest.advanceTimersByTime(30_000);
      expect(received).toHaveLength(1);
      expect(received[0].data).toMatch(/^: heartbeat \d+$/);

      const spy = jest.spyOn(sse, 'unsubscribe');
      r.handlers.close();
      expect(spy).toHaveBeenCalledWith(1);
      sub.unsubscribe();
    });

    it('requires a store context', () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({} as any);
      expect(() => controller.stream(req())).toThrow(ForbiddenException);
    });
  });
});
