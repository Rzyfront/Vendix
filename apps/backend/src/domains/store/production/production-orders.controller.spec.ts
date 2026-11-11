import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { Subject } from 'rxjs';
import { ProductionOrdersController } from './production-orders.controller';
import { ProductionSseService } from './production-sse.service';
import { RequestContextService } from '../../../common/context/request-context.service';

describe('ProductionOrdersController — card per sale and live stream (QUI-1002)', () => {
  let service: { startSale: jest.Mock; completeSale: jest.Mock; restart: jest.Mock; findDaySupplies: jest.Mock };
  let responses: { success: jest.Mock };
  let sse: ProductionSseService;
  let controller: ProductionOrdersController;

  beforeEach(() => {
    service = { startSale: jest.fn(), completeSale: jest.fn(), restart: jest.fn(), findDaySupplies: jest.fn() };
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

  it('S21: POST :id/restart delegates to the service and returns the restarted order', async () => {
    service.restart.mockResolvedValue({ id: 5, status: 'draft' });
    const res = await controller.restart(5);
    expect(service.restart).toHaveBeenCalledWith(5);
    expect(res.data).toEqual({ id: 5, status: 'draft' });
  });

  it('S4: GET day/supplies delegates to the service with the day permissions (restaurant or Planta read), declared before :id', async () => {
    const supplies = { date: '2026-11-10', orders_total: 0, supplies: [] };
    service.findDaySupplies.mockResolvedValue(supplies);
    const res: any = await controller.findDaySupplies({ date: '2026-11-10' });

    expect(service.findDaySupplies).toHaveBeenCalledWith({ date: '2026-11-10' });
    expect(res.data).toEqual(supplies);
    const proto = ProductionOrdersController.prototype;
    expect(Reflect.getMetadata('path', proto.findDaySupplies)).toBe('day/supplies');
    expect(Reflect.getMetadata('method', proto.findDaySupplies)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.findDaySupplies)).toEqual(
      Reflect.getMetadata(PERMISSIONS_KEY, proto.findDay),
    );
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.findDaySupplies)).toEqual([
      'store:production_orders:read',
      'store:manufacturing:orders:read',
    ]);
    const names = Object.getOwnPropertyNames(proto);
    expect(names.indexOf('findDaySupplies')).toBeLessThan(names.indexOf('findOne'));
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
