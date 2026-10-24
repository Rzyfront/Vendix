import { Injectable, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { PublishPositionsDto } from './dto/publish-positions.dto';
import {
  RouteTrackingSseService,
  TrackingPosition,
} from './route-tracking-sse.service';

const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
const MIN_GAP_MS = 3000;
const MAX_TRAIL_POINTS = 500;
const ACTIVE_STATUSES = ['dispatched', 'in_transit'];

@Injectable()
export class RouteTrackingService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly sse: RouteTrackingSseService,
  ) {}

  private getContext() {
    const ctx = RequestContextService.getContext();
    if (!ctx?.store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return ctx;
  }

  // dispatch_routes is not auto-scoped: always filter by store_id.
  private async getRoute(id: number, store_id: number) {
    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id },
      include: {
        driver_user: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    if (!route) throw new NotFoundException(`Ruta #${id} no encontrada`);
    return route as any;
  }

  // dispatch_route_positions has no scoped getter: manual store_id filter.
  private get positions(): any {
    return (this.prisma.withoutScope() as any).dispatch_route_positions;
  }

  private toPos(row: any): TrackingPosition {
    const num = (v: any) => (v === null || v === undefined ? null : Number(v));
    return {
      lat: Number(row.lat),
      lng: Number(row.lng),
      accuracy: num(row.accuracy),
      heading: num(row.heading),
      speed: num(row.speed),
      recorded_at: new Date(row.recorded_at).toISOString(),
    };
  }

  /** Validates route/store at SSE connect time (404 otherwise). */
  async assertRouteAccessible(id: number): Promise<void> {
    const ctx = this.getContext();
    await this.getRoute(id, ctx.store_id as number);
  }

  async publishPositions(id: number, dto: PublishPositionsDto) {
    const ctx = this.getContext();
    const store_id = ctx.store_id as number;
    const route = await this.getRoute(id, store_id);

    if (!ACTIVE_STATUSES.includes(route.status)) {
      throw new VendixHttpException(ErrorCodes.DISPATCH_ROUTE_TRACKING_NOT_ACTIVE);
    }
    if (
      route.is_primary_driver_external ||
      !route.driver_user_id ||
      route.driver_user_id !== ctx.user_id
    ) {
      throw new VendixHttpException(ErrorCodes.DISPATCH_ROUTE_TRACKING_FORBIDDEN);
    }

    const now = Date.now();
    const started = route.dispatch_started_at
      ? new Date(route.dispatch_started_at).getTime()
      : null;

    const candidates = dto.positions
      .map((p) => ({ ...p, ts: new Date(p.recorded_at).getTime() }))
      .filter(
        (p) =>
          !Number.isNaN(p.ts) &&
          p.ts <= now + MAX_FUTURE_SKEW_MS &&
          (started === null || p.ts >= started),
      )
      .sort((a, b) => a.ts - b.ts);

    const last = await this.positions.findFirst({
      where: { route_id: id, store_id },
      orderBy: { recorded_at: 'desc' },
      select: { recorded_at: true },
    });
    let lastTs: number | null = last ? new Date(last.recorded_at).getTime() : null;

    const accepted: typeof candidates = [];
    for (const p of candidates) {
      if (lastTs !== null && p.ts - lastTs < MIN_GAP_MS) continue;
      accepted.push(p);
      lastTs = p.ts;
    }

    if (accepted.length > 0) {
      await this.positions.createMany({
        data: accepted.map((p) => ({
          store_id,
          route_id: id,
          user_id: ctx.user_id,
          lat: p.lat,
          lng: p.lng,
          accuracy: p.accuracy ?? null,
          heading: p.heading ?? null,
          speed: p.speed ?? null,
          recorded_at: new Date(p.ts),
        })),
      });
      const tail = accepted[accepted.length - 1];
      this.sse.publish(id, {
        lat: tail.lat,
        lng: tail.lng,
        accuracy: tail.accuracy ?? null,
        heading: tail.heading ?? null,
        speed: tail.speed ?? null,
        recorded_at: new Date(tail.ts).toISOString(),
      });
    }

    return { accepted: accepted.length };
  }

  async getTracking(id: number) {
    const ctx = this.getContext();
    const store_id = ctx.store_id as number;
    const route = await this.getRoute(id, store_id);

    const is_external = !!route.is_primary_driver_external;
    const has_driver = !!route.driver_user_id;
    const tracking_enabled = has_driver && !is_external;
    const responsible = route.driver_user
      ? {
          user_id: route.driver_user.id,
          name: `${route.driver_user.first_name ?? ''} ${route.driver_user.last_name ?? ''}`.trim(),
        }
      : null;

    const base = {
      tracking_enabled,
      responsible,
      is_external_responsible: is_external,
      is_viewer_responsible: has_driver && route.driver_user_id === ctx.user_id,
      route_status: route.status,
    };

    if (!tracking_enabled) {
      return { ...base, last_position: null, trail: [] as TrackingPosition[] };
    }

    const rows: any[] = await this.positions.findMany({
      where: { route_id: id, store_id },
      orderBy: { recorded_at: 'asc' },
    });
    const all = rows.map((r) => this.toPos(r));
    const last_position = all.length ? all[all.length - 1] : null;

    let trail = all;
    if (all.length > MAX_TRAIL_POINTS) {
      trail = [];
      for (let i = 0; i < MAX_TRAIL_POINTS; i++) {
        trail.push(
          all[Math.round((i * (all.length - 1)) / (MAX_TRAIL_POINTS - 1))],
        );
      }
    }

    return { ...base, last_position, trail };
  }
}
