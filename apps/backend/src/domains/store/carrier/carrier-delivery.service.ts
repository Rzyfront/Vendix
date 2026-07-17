import { Injectable, Logger } from '@nestjs/common';
import { Prisma, dispatch_route_status_enum } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { DispatchNotesService } from '../dispatch-notes/dispatch-notes.service';
import { RouteNumberGenerator } from '../dispatch-routes/utils/route-number-generator';
import { CreateFromOrderDto } from '../dispatch-notes/dto/create-from-order.dto';
import { PoolQueryDto } from './dto/pool-query.dto';

/**
 * A single order sitting in the carrier pool (published by the admin, not yet
 * claimed). Money is a Decimal string, dates are ISO strings.
 */
export interface PoolItem {
  order_id: number;
  order_number: string;
  customer_name: string | null;
  total_to_collect: string;
  address: string | null;
  pooled_at: string;
  delivery_type: string;
}

/**
 * Informative payout for a carrier route. B6 returns a placeholder; Fase B8
 * refines it (per-stop vs per-route tariff resolution from user/store config).
 */
export interface CarrierPayout {
  mode: 'per_stop' | 'per_route';
  amount: string;
  currency: string;
  estimated?: string;
  earned?: string;
}

/**
 * Carrier namespace service (Repartos Fase B6).
 *
 * Corazón del sistema de repartos: resuelve "mi ruta" desde el JWT
 * (driver_user_id = ctx.user_id, SIN route-id en la URL), lista el pool y
 * ejecuta el claim atómico primero-gana con compensación (saga).
 *
 * Reuso, no duplicación: el claim delega en
 * `DispatchNotesService.createFromOrder` (motor de despacho) para crear la
 * remisión + la parada; este servicio sólo orquesta el pool y la resolución
 * de ruta.
 *
 * Scoping: `orders` es AUTO-scoped por StorePrismaService; `dispatch_routes` y
 * `dispatch_route_stops` NO lo son → se filtra `store_id` manualmente.
 */
@Injectable()
export class CarrierDeliveryService {
  private readonly logger = new Logger(CarrierDeliveryService.name);

  /** Estados de una ruta carrier "activa" (dentro del índice único parcial). */
  private static readonly ACTIVE_ROUTE_STATES: dispatch_route_status_enum[] = [
    'draft',
    'dispatched',
    'in_transit',
  ];

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly dispatchNotesService: DispatchNotesService,
    private readonly routeNumberGenerator: RouteNumberGenerator,
  ) {}

  // ── Context helper ──────────────────────────────────────────────────────

  private requireContext(): { store_id: number; user_id: number } {
    const ctx = RequestContextService.getContext();
    const store_id = ctx?.store_id;
    const user_id = ctx?.user_id;
    // JwtAuthGuard is global, so user_id is normally present; guard defensively.
    if (!store_id || !user_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return { store_id, user_id };
  }

  // ── Mi ruta activa ──────────────────────────────────────────────────────

  /**
   * Resolve the caller's active carrier route from the JWT (no route-id in the
   * URL). Returns null when the carrier has no active route.
   *
   * `dispatch_routes` is NOT auto-scoped → filter `store_id` manually.
   */
  async getMyActiveRoute() {
    const { store_id, user_id } = this.requireContext();
    return this.prisma.dispatch_routes.findFirst({
      where: {
        store_id,
        driver_user_id: user_id,
        is_carrier_route: true,
        status: { in: CarrierDeliveryService.ACTIVE_ROUTE_STATES },
      },
      include: {
        stops: { orderBy: { stop_sequence: 'asc' } },
      },
    });
  }

  /**
   * `GET /store/carrier/route` — active route + stops + informative payout.
   * Payout is a B6 placeholder that Fase B8 refines.
   */
  async getActiveRouteWithPayout() {
    const route = await this.getMyActiveRoute();
    // B8 refina: resuelve tarifa (per_stop|per_route) desde
    // user_settings.config.carrier_tariff → store default → {per_stop,'0'}.
    const payout: CarrierPayout = {
      mode: 'per_stop',
      amount: '0',
      currency: route?.currency ?? 'COP',
      estimated: '0',
    };
    return {
      route,
      stops: route?.stops ?? [],
      payout,
    };
  }

  // ── Pool ────────────────────────────────────────────────────────────────

  /**
   * `GET /store/carrier/pool` — orders published by the admin and not yet
   * claimed. `orders` is auto-scoped; the pool predicate is derived:
   * `dispatch_pool_at IS NOT NULL AND claimed_by_carrier_user_id IS NULL AND
   *  dispatch_fulfillment != 'full'`.
   */
  async listPool(query: PoolQueryDto): Promise<{
    data: PoolItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where: Prisma.ordersWhereInput = {
      dispatch_pool_at: { not: null },
      claimed_by_carrier_user_id: null,
      dispatch_fulfillment: { not: 'full' },
      ...(search && {
        OR: [
          {
            order_number: { contains: search, mode: 'insensitive' as any },
          },
          {
            users: {
              first_name: { contains: search, mode: 'insensitive' as any },
            },
          },
          {
            users: {
              last_name: { contains: search, mode: 'insensitive' as any },
            },
          },
        ],
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.orders.findMany({
        where,
        skip,
        take: limit,
        // FIFO: la orden que lleva más tiempo en el pool aparece primero.
        orderBy: { dispatch_pool_at: 'asc' },
        select: {
          id: true,
          order_number: true,
          delivery_type: true,
          remaining_balance: true,
          dispatch_pool_at: true,
          shipping_address_snapshot: true,
          users: { select: { first_name: true, last_name: true } },
          addresses_orders_shipping_address_idToaddresses: {
            select: {
              address_line1: true,
              address_line2: true,
              city: true,
              state_province: true,
            },
          },
        },
      }),
      this.prisma.orders.count({ where }),
    ]);

    const data: PoolItem[] = rows.map((o) => ({
      order_id: o.id,
      order_number: o.order_number,
      customer_name: this.buildCustomerName(o.users),
      // Lo que el repartidor cobra al entregar (COD). Prepago → '0'.
      total_to_collect: o.remaining_balance.toString(),
      address: this.buildAddressLine(
        o.shipping_address_snapshot,
        o.addresses_orders_shipping_address_idToaddresses,
      ),
      pooled_at: o.dispatch_pool_at ? o.dispatch_pool_at.toISOString() : '',
      delivery_type: o.delivery_type,
    }));

    return { data, total, page, limit };
  }

  // ── Claim (atómico primero-gana + saga con compensación) ─────────────────

  /**
   * `POST /store/carrier/pool/:orderId/claim`
   *
   * Saga:
   *  1. Claim atómico: `updateMany` con guard `claimed_by_carrier_user_id IS
   *     NULL` — ÚNICO punto de verdad de la carrera (affected=1 gana, resto
   *     409 CARRIER_CLAIM_TAKEN).
   *  2. Resolver mi ruta activa (tomar-en-recorrido) o crear una nueva ruta
   *     carrier `draft` (índice único parcial impide 2 rutas carrier activas).
   *  3. Reuso: `createFromOrder` crea la remisión + la parada en mi ruta.
   *  4. Si (3) lanza → compensar: soltar el claim y anular la ruta si quedó
   *     vacía (status='voided' → terminal, FUERA del índice parcial, libera el
   *     slot). Re-lanzar el error de dominio.
   */
  async claim(order_id: number): Promise<{
    route_id: number;
    stop_id: number;
    order_id: number;
  }> {
    const { store_id, user_id } = this.requireContext();

    // STEP 1 — Claim atómico primero-gana.
    const claimed = await this.prisma.orders.updateMany({
      where: {
        id: order_id,
        store_id,
        dispatch_pool_at: { not: null },
        claimed_by_carrier_user_id: null,
        dispatch_fulfillment: { not: 'full' },
      },
      data: { claimed_by_carrier_user_id: user_id },
    });
    if (claimed.count === 0) {
      throw new VendixHttpException(ErrorCodes.CARRIER_CLAIM_TAKEN, undefined, {
        order_id,
      });
    }

    // STEP 2 — Resolver ruta: existente (tomar-en-recorrido) o crear nueva.
    let route_id: number;
    let routeCreatedNow = false;
    const existing = await this.getMyActiveRoute();
    if (existing) {
      route_id = existing.id;
    } else {
      try {
        route_id = await this.createCarrierRoute(store_id, user_id);
        routeCreatedNow = true;
      } catch (err) {
        // Doble-claim concurrente del MISMO repartidor sin ruta previa: el
        // índice único parcial (dispatch_routes_active_carrier_driver_idx)
        // rechazó la 2ª ruta. Re-resolver: la ruta hermana ya existe → usarla.
        if (this.isActiveCarrierRouteConflict(err)) {
          const retry = await this.getMyActiveRoute();
          if (retry) {
            route_id = retry.id;
          } else {
            await this.releaseClaim(order_id, store_id);
            throw err;
          }
        } else {
          await this.releaseClaim(order_id, store_id);
          throw err;
        }
      }
    }

    // STEP 3 — Reuso del motor: crear remisión + parada en mi ruta.
    let dispatchNoteId: number;
    try {
      const items = await this.buildDispatchItems(order_id);
      const dto: CreateFromOrderDto = {
        target_status: 'confirmed',
        items,
        route_assignment: { mode: 'existing', route_id },
      };
      const note = await this.dispatchNotesService.createFromOrder(
        order_id,
        dto,
      );
      dispatchNoteId = note.id;
    } catch (err) {
      // STEP 4 — Compensación.
      await this.releaseClaim(order_id, store_id);
      if (routeCreatedNow) {
        await this.voidRouteIfEmpty(route_id, store_id);
      }
      throw err;
    }

    // STEP 5 — Resolver la parada creada (partial unique WHERE status !=
    // 'released' garantiza una única parada activa por remisión).
    const stop = await this.prisma.dispatch_route_stops.findFirst({
      where: { dispatch_note_id: dispatchNoteId, route_id },
      orderBy: { id: 'desc' },
      select: { id: true },
    });

    return { route_id, stop_id: stop?.id ?? 0, order_id };
  }

  // ── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Build the full-order dispatch items (COD shortcut): dispatch every ordered
   * line at its full quantity. `createFromOrder` requires `items` and validates
   * stock; the pool predicate already excludes fully-dispatched orders.
   */
  private async buildDispatchItems(order_id: number): Promise<
    CreateFromOrderDto['items']
  > {
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      select: { order_items: { select: { id: true, quantity: true } } },
    });
    return (order?.order_items ?? []).map((oi) => ({
      order_item_id: oi.id,
      dispatched_quantity: oi.quantity,
    }));
  }

  /**
   * Create a brand-new carrier route (`is_carrier_route=true`, `draft`) owned by
   * the caller. Retries on route_number collision; lets the active-carrier-driver
   * partial-unique conflict propagate (handled by the caller's saga).
   *
   * `dispatch_routes` is NOT auto-scoped → `store_id` is set explicitly.
   */
  private async createCarrierRoute(
    store_id: number,
    user_id: number,
  ): Promise<number> {
    let attempts = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const route_number =
          await this.routeNumberGenerator.generateNextNumber(store_id);
        const route = await this.prisma.dispatch_routes.create({
          data: {
            store_id,
            route_number,
            status: 'draft',
            is_carrier_route: true,
            driver_user_id: user_id,
            planned_date: new Date(),
            currency: 'COP',
            created_by_user_id: user_id,
            updated_at: new Date(),
          },
          select: { id: true },
        });
        return route.id;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          this.p2002TargetIncludes(error, 'route_number')
        ) {
          if (++attempts < 3) continue;
        }
        // Incluye el conflicto del índice único parcial de ruta carrier activa.
        throw error;
      }
    }
  }

  /** Compensación: soltar el claim (no debe lanzar — swallow + log). */
  private async releaseClaim(order_id: number, store_id: number): Promise<void> {
    try {
      await this.prisma.orders.updateMany({
        where: { id: order_id, store_id },
        data: { claimed_by_carrier_user_id: null },
      });
    } catch (e) {
      this.logger.error(
        `[carrier.claim] compensation failed to release claim on order #${order_id}: ${String(
          e,
        )}`,
      );
    }
  }

  /**
   * Compensación: anular la ruta si quedó vacía (0 paradas). 'voided' es
   * terminal y queda FUERA del índice único parcial → libera el slot del
   * conductor. NO se borra la fila. No debe lanzar.
   */
  private async voidRouteIfEmpty(
    route_id: number,
    store_id: number,
  ): Promise<void> {
    try {
      const stopCount = await this.prisma.dispatch_route_stops.count({
        where: { route_id },
      });
      if (stopCount === 0) {
        await this.prisma.dispatch_routes.updateMany({
          where: { id: route_id, store_id },
          data: {
            status: 'voided',
            voided_at: new Date(),
            void_reason: 'Carrier claim rollback (empty route)',
            updated_at: new Date(),
          },
        });
      }
    } catch (e) {
      this.logger.error(
        `[carrier.claim] compensation failed to void empty route #${route_id}: ${String(
          e,
        )}`,
      );
    }
  }

  /** True when the P2002 comes from the active-carrier-driver partial unique index. */
  private isActiveCarrierRouteConflict(err: unknown): boolean {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const target = err.meta?.target;
      const asText = Array.isArray(target)
        ? target.join(',')
        : String(target ?? '');
      return (
        asText.includes('active_carrier') || asText.includes('driver_user_id')
      );
    }
    return false;
  }

  private p2002TargetIncludes(
    err: Prisma.PrismaClientKnownRequestError,
    needle: string,
  ): boolean {
    const target = err.meta?.target;
    if (Array.isArray(target)) return target.includes(needle);
    return String(target ?? '').includes(needle);
  }

  private buildCustomerName(
    user: { first_name: string | null; last_name: string | null } | null,
  ): string | null {
    if (!user) return null;
    const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    return name.length > 0 ? name : null;
  }

  /**
   * Build a human-readable address line from the order's shipping snapshot JSON
   * (preferred, immutable at order time) with a fallback to the live relation.
   */
  private buildAddressLine(
    snapshot: Prisma.JsonValue | null | undefined,
    relation:
      | {
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          state_province: string | null;
        }
      | null,
  ): string | null {
    const fromSnapshot = this.addressFromSnapshot(snapshot);
    if (fromSnapshot) return fromSnapshot;
    if (relation) {
      const parts = [
        relation.address_line1,
        relation.address_line2,
        relation.city,
        relation.state_province,
      ].filter((p): p is string => !!p && p.trim().length > 0);
      if (parts.length > 0) return parts.join(', ');
    }
    return null;
  }

  private addressFromSnapshot(
    snapshot: Prisma.JsonValue | null | undefined,
  ): string | null {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return null;
    }
    const obj = snapshot as Record<string, unknown>;
    const pick = (key: string): string | null => {
      const v = obj[key];
      return typeof v === 'string' && v.trim().length > 0 ? v : null;
    };
    const parts = [
      pick('address_line1'),
      pick('address_line2'),
      pick('city'),
      pick('state_province'),
    ].filter((p): p is string => p !== null);
    return parts.length > 0 ? parts.join(', ') : null;
  }
}
