import { NotFoundException } from '@nestjs/common';
import { RouteTrackingService } from './route-tracking.service';
import { RouteTrackingSseService } from './route-tracking-sse.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';

describe('RouteTrackingService', () => {
  let service: RouteTrackingService;
  let sse: RouteTrackingSseService;
  let positionsMock: any;
  let prismaMock: any;
  const STORE_ID = 100;
  const ROUTE_ID = 7;
  const USER_ID = 11;

  const route = (o: any = {}) => ({
    id: ROUTE_ID,
    store_id: STORE_ID,
    status: 'in_transit',
    driver_user_id: USER_ID,
    is_primary_driver_external: false,
    dispatch_started_at: new Date(Date.now() - 3600_000),
    driver_user: { id: USER_ID, first_name: 'Ana', last_name: 'Gómez' },
    ...o,
  });
  const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
  const pos = (offsetMs: number) => ({ lat: 4.6, lng: -74.1, recorded_at: iso(offsetMs) });

  beforeEach(() => {
    positionsMock = {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    prismaMock = {
      dispatch_routes: { findFirst: jest.fn().mockResolvedValue(route()) },
      withoutScope: () => ({ dispatch_route_positions: positionsMock }),
    };
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: STORE_ID,
      organization_id: 1,
      user_id: USER_ID,
      is_super_admin: false,
    } as any);
    sse = new RouteTrackingSseService();
    service = new RouteTrackingService(prismaMock, sse);
  });
  afterEach(() => jest.restoreAllMocks());

  it('404 when route belongs to another store', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(null);
    await expect(
      service.publishPositions(ROUTE_ID, { positions: [pos(-1000)] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prismaMock.dispatch_routes.findFirst.mock.calls[0][0].where).toEqual({
      id: ROUTE_ID,
      store_id: STORE_ID,
    });
  });

  it('403 when caller is not the responsible', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(route({ driver_user_id: 999 }));
    await expect(
      service.publishPositions(ROUTE_ID, { positions: [pos(-1000)] }),
    ).rejects.toMatchObject({ response: { error_code: 'DISPATCH_ROUTE_TRACKING_FORBIDDEN' } });
  });

  it('403 when responsible is external', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(
      route({ is_primary_driver_external: true }),
    );
    const p = service.publishPositions(ROUTE_ID, { positions: [pos(-1000)] });
    await expect(p).rejects.toBeInstanceOf(VendixHttpException);
    await expect(p).rejects.toMatchObject({ status: 403 });
  });

  it.each(['draft', 'closed'])('409 when route is %s', async (status) => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(route({ status }));
    const p = service.publishPositions(ROUTE_ID, { positions: [pos(-1000)] });
    await expect(p).rejects.toBeInstanceOf(VendixHttpException);
    await expect(p).rejects.toMatchObject({ status: 409 });
  });

  it('accepts a batch, drops future/old/burst points and emits the last', async () => {
    const emitted: any[] = [];
    sse.stream(ROUTE_ID).subscribe((p) => emitted.push(p));
    const res = await service.publishPositions(ROUTE_ID, {
      positions: [
        pos(10 * 60_000), // future
        pos(-2 * 3600_000), // before dispatch_started_at
        pos(-20_000),
        pos(-18_000), // <3s of previous accepted
        pos(-10_000),
      ],
    });
    expect(res).toEqual({ accepted: 2 });
    const data = positionsMock.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ store_id: STORE_ID, route_id: ROUTE_ID, user_id: USER_ID });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].recorded_at).toBe(data[1].recorded_at.toISOString());
  });

  it('drops points within 3s of the last persisted one', async () => {
    positionsMock.findFirst.mockResolvedValue({ recorded_at: new Date(Date.now() - 10_000) });
    const res = await service.publishPositions(ROUTE_ID, {
      positions: [pos(-9_000), pos(-5_000)],
    });
    expect(res).toEqual({ accepted: 1 });
  });

  it('getTracking with external responsible disables tracking', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(
      route({ is_primary_driver_external: true }),
    );
    const res = await service.getTracking(ROUTE_ID);
    expect(res).toMatchObject({
      tracking_enabled: false,
      is_external_responsible: true,
      last_position: null,
      trail: [],
    });
    expect(positionsMock.findMany).not.toHaveBeenCalled();
  });

  it('getTracking subsamples to 500 keeping first and last', async () => {
    const base = Date.now() - 3000_000;
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      lat: 4 + i / 10000,
      lng: -74,
      accuracy: null,
      heading: null,
      speed: null,
      recorded_at: new Date(base + i * 1000),
    }));
    positionsMock.findMany.mockResolvedValue(rows);
    const res: any = await service.getTracking(ROUTE_ID);
    expect(res.tracking_enabled).toBe(true);
    expect(res.is_viewer_responsible).toBe(true);
    expect(res.trail).toHaveLength(500);
    expect(res.trail[0].recorded_at).toBe(rows[0].recorded_at.toISOString());
    expect(res.trail[499].recorded_at).toBe(rows[1199].recorded_at.toISOString());
    expect(res.last_position.recorded_at).toBe(rows[1199].recorded_at.toISOString());
  });

  it('getTracking: responsible linked when they dispatched the route themselves', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(
      route({ dispatched_by_user_id: USER_ID }),
    );
    const res: any = await service.getTracking(ROUTE_ID);
    expect(res.is_responsible_linked).toBe(true);
  });

  it('getTracking: responsible not linked when another user dispatched and no position was reported', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(
      route({ dispatched_by_user_id: 99 }),
    );
    const res: any = await service.getTracking(ROUTE_ID);
    expect(res.tracking_enabled).toBe(true);
    expect(res.is_responsible_linked).toBe(false);
  });

  it('getTracking: responsible linked once they reported a position (synced)', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(
      route({ dispatched_by_user_id: 99 }),
    );
    positionsMock.findMany.mockResolvedValue([
      { lat: 4.6, lng: -74.1, accuracy: null, heading: null, speed: null, recorded_at: new Date() },
    ]);
    const res: any = await service.getTracking(ROUTE_ID);
    expect(res.is_responsible_linked).toBe(true);
  });

  it('getTracking: external responsible is never linked', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(
      route({ is_primary_driver_external: true, dispatched_by_user_id: USER_ID }),
    );
    const res: any = await service.getTracking(ROUTE_ID);
    expect(res.is_responsible_linked).toBe(false);
  });

  it('SSE service cleans the Subject when no subscribers remain', () => {
    const s = sse.stream(ROUTE_ID).subscribe();
    expect((sse as any).subjects.size).toBe(1);
    s.unsubscribe();
    expect((sse as any).subjects.size).toBe(0);
  });
});
