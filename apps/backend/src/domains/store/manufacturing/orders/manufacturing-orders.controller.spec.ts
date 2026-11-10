import { ForbiddenException } from '@nestjs/common';
import { ManufacturingOrdersController } from './manufacturing-orders.controller';
import { ProductionSseService } from '../../production/production-sse.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { INDUSTRY_MODULE_KEY } from '../../../../common/decorators/industry-module.decorator';

/**
 * QUI-996 / QUI-1002 — Planta reads the shared production day and live stream
 * through its OWN controller, so a manufacturing-only store passes the
 * `manufacturing_orders` industry guard instead of the restaurant one.
 */
describe('ManufacturingOrdersController — shared production day and stream', () => {
  let production: { findDay: jest.Mock };
  let responses: { success: jest.Mock };
  let sse: ProductionSseService;
  let controller: ManufacturingOrdersController;

  const req = () => {
    const handlers: Record<string, () => void> = {};
    return {
      on: (event: string, cb: () => void) => {
        handlers[event] = cb;
      },
      close: () => handlers['close']?.(),
    };
  };

  beforeEach(() => {
    production = { findDay: jest.fn().mockResolvedValue({ date: '2026-11-10', cards: [] }) };
    responses = { success: jest.fn((data, message) => ({ success: true, data, message })) };
    sse = new ProductionSseService();
    controller = new ManufacturingOrdersController(
      {} as any,
      responses as any,
      production as any,
      sse,
    );
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('GET day delegates to the shared production day with the query', async () => {
    const result = await controller.findDay({ date: '2026-11-10' });

    expect(production.findDay).toHaveBeenCalledWith({ date: '2026-11-10' });
    expect(result).toEqual({
      success: true,
      data: { date: '2026-11-10', cards: [] },
      message: 'Lista de producción del día obtenida',
    });
  });

  it('GET stream forwards the store production events as JSON data', () => {
    const r = req();
    const received: MessageEvent[] = [];
    const sub = controller.stream(r as any).subscribe((e) => received.push(e));

    sse.onProductionOrderUpdated({ type: 'production_order.updated', store_id: 3, id: 9 } as any);
    sse.onProductionOrderUpdated({ type: 'production_order.updated', store_id: 4, id: 10 } as any);

    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].data as string)).toMatchObject({ store_id: 3, id: 9 });
    const spy = jest.spyOn(sse, 'unsubscribe');
    r.close();
    expect(spy).toHaveBeenCalledWith(3);
    sub.unsubscribe();
  });

  it('GET stream requires a store context', () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(undefined as any);
    expect(() => controller.stream(req() as any)).toThrow(ForbiddenException);
  });

  it('day and stream use the Planta read permission under the manufacturing industry guard', () => {
    const proto = ManufacturingOrdersController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.findDay)).toEqual([
      'store:manufacturing:orders:read',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.stream)).toEqual([
      'store:manufacturing:orders:read',
    ]);
    expect(Reflect.getMetadata(INDUSTRY_MODULE_KEY, ManufacturingOrdersController)).toBe(
      'manufacturing_orders',
    );
  });
});
