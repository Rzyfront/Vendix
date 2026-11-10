import { ProductionSseService } from './production-sse.service';

describe('ProductionSseService (QUI-1002)', () => {
  const payload = (store_id: number, id = 1) =>
    ({
      type: 'production_order.updated',
      store_id,
      id,
      order_id: null,
      status: 'draft',
      started_at: null,
      produced_at: null,
      estimated_minutes: null,
    }) as any;

  it('pushes the event of a store only to that store subscribers', () => {
    const service = new ProductionSseService();
    const a: unknown[] = [];
    const b: unknown[] = [];
    service.getOrCreate(1).subscribe((e) => a.push(e));
    service.getOrCreate(2).subscribe((e) => b.push(e));

    service.onProductionOrderUpdated(payload(1, 10));

    expect(a).toEqual([payload(1, 10)]);
    expect(b).toEqual([]);
  });

  it('ignores events when nobody listens to that store', () => {
    const service = new ProductionSseService();
    expect(() => service.onProductionOrderUpdated(payload(9))).not.toThrow();
  });

  it('keeps the shared subject alive until the last subscriber unsubscribes', () => {
    const service = new ProductionSseService();
    const seen: unknown[] = [];
    service.getOrCreate(1).subscribe((e) => seen.push(e));
    service.getOrCreate(1);
    service.unsubscribe(1);
    service.onProductionOrderUpdated(payload(1, 3));
    expect(seen).toHaveLength(1);

    service.unsubscribe(1);
    service.onProductionOrderUpdated(payload(1, 4));
    expect(seen).toHaveLength(1);
  });
});
