import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, dispatch_route_status_enum } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { DispatchNotesService } from '../dispatch-notes/dispatch-notes.service';
import { RouteFlowService } from '../dispatch-routes/route-flow/route-flow.service';
import { RouteNumberGenerator } from '../dispatch-routes/utils/route-number-generator';
import { CreateFromOrderDto } from '../dispatch-notes/dto/create-from-order.dto';
import { UpdateDispatchNoteAddressDto } from '../dispatch-notes/dto';
import {
  SettleStopDto,
  ReleaseStopDto,
  CloseDispatchRouteDto,
  ReorderStopsDto,
} from '../dispatch-routes/dto';
import { PoolQueryDto } from './dto/pool-query.dto';
import { RouteHistoryQueryDto } from './dto/route-history-query.dto';

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
 * Configurable carrier tariff (Fase B8). Money is always a Decimal string,
 * never a float. Resolved via cascade: user_settings → store default → zero.
 */
export interface CarrierTariff {
  mode: 'per_stop' | 'per_route';
  amount: string;
  currency: string;
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
    private readonly routeFlowService: RouteFlowService,
    private readonly eventEmitter: EventEmitter2,
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
        // La UI de Mi Ruta (F4) lee cliente/dirección/remisión/total de la
        // remisión asociada a cada parada; sin este include las celdas quedan
        // vacías y el gate de "parada sin dirección" da falso positivo.
        stops: {
          orderBy: { stop_sequence: 'asc' },
          include: { dispatch_note: true },
        },
      },
    });
  }

  /**
   * `GET /store/carrier/route` — active route + stops + informative payout.
   *
   * Fase B8: `estimated` se calcula con la tarifa resuelta (cascada
   * user_settings → store default → cero). `per_stop` → amount × nº de paradas
   * planificadas; `per_route` → amount. Meramente informativo (no persiste ni
   * emite eventos contables).
   */
  async getActiveRouteWithPayout() {
    const { store_id, user_id } = this.requireContext();
    const route = await this.getMyActiveRoute();
    const tariff = await this.resolveTariff(user_id, store_id);
    const plannedStops = route?.stops?.length ?? 0;
    const estimated =
      tariff.mode === 'per_route'
        ? tariff.amount
        : this.multiplyMoney(tariff.amount, plannedStops);
    const payout: CarrierPayout = {
      mode: tariff.mode,
      amount: tariff.amount,
      currency: tariff.currency,
      estimated,
    };
    return {
      route,
      stops: route?.stops ?? [],
      payout,
    };
  }

  // ── Ejecución de ruta (Fase B7) — delegan en RouteFlowService ─────────────

  /**
   * Despachar MI ruta activa (draft → dispatched). Reuso: delega en el motor
   * `RouteFlowService.dispatch` tras resolver la ruta desde el JWT.
   */
  async dispatch() {
    const route = await this.requireMyActiveRoute();
    return this.routeFlowService.dispatch(route.id);
  }

  /** Iniciar una parada de MI ruta (pending → in_progress). */
  async startStop(stopId: number) {
    const route = await this.requireMyActiveRoute();
    this.assertStopBelongsToRoute(route, stopId);
    return this.routeFlowService.startStop(route.id, stopId);
  }

  /**
   * Liquidar una parada de MI ruta. El motor emite los eventos contables
   * (payment/credit/refund/withholding) vía CashSettlementService — aquí NO se
   * duplica contabilidad, sólo se delega.
   */
  async settleStop(stopId: number, dto: SettleStopDto) {
    const route = await this.requireMyActiveRoute();
    this.assertStopBelongsToRoute(route, stopId);
    return this.routeFlowService.settleStop(route.id, stopId, dto);
  }

  /**
   * Liberar una parada de MI ruta y, si la orden estaba en el pool,
   * reexponerla: suelta el claim (CONSERVA `dispatch_pool_at`) para que la
   * orden REAPAREZCA en el pool y re-emite `order.awaiting_carrier` para
   * re-notificar a los carriers (mismo shape que B5).
   */
  async releaseStop(stopId: number, dto: ReleaseStopDto) {
    const { store_id } = this.requireContext();
    const route = await this.requireMyActiveRoute();
    this.assertStopBelongsToRoute(route, stopId);

    const result = await this.routeFlowService.releaseStop(route.id, stopId, dto);

    // Efecto de facade (NO en el motor): reexponer la orden al pool.
    await this.reexposeReleasedPoolOrder(route.id, stopId, store_id);

    return result;
  }

  /**
   * Reordenar las paradas de MI ruta ("Aplicar orden óptimo" del mapa del
   * repartidor). Valida que TODAS las paradas del payload pertenezcan a mi ruta
   * antes de delegar en el motor.
   */
  async reorderStops(dto: ReorderStopsDto) {
    const route = await this.requireMyActiveRoute();
    const stopIds = dto.order.map((o) => o.stopId);
    const routeStopIds = new Set(route.stops.map((s) => s.id));
    const foreign = stopIds.filter((sid) => !routeStopIds.has(sid));
    if (foreign.length > 0) {
      throw new ForbiddenException(
        `Las paradas ${foreign.join(', ')} no pertenecen a tu ruta activa`,
      );
    }
    return this.routeFlowService.reorderStops(route.id, dto);
  }

  /**
   * Cerrar MI ruta (cuadre de caja) + payout informativo DEVENGADO.
   *
   * Fase B8: `earned` = `per_stop` → amount × paradas delivered; `per_route` →
   * amount si la ruta cerró con ≥1 entrega, si no '0'. `variance` se toma del
   * `cash_variance` que calcula el motor. El payout NO se persiste ni emite
   * eventos contables (sólo informativo).
   */
  async close(dto: CloseDispatchRouteDto) {
    const { store_id, user_id } = this.requireContext();
    const route = await this.requireMyActiveRoute();

    const closed = await this.routeFlowService.close(route.id, dto);

    const tariff = await this.resolveTariff(user_id, store_id);
    const deliveredCount = (closed.stops ?? []).filter(
      (s) => s.result === 'delivered',
    ).length;
    const earned =
      tariff.mode === 'per_route'
        ? deliveredCount >= 1
          ? tariff.amount
          : '0'
        : this.multiplyMoney(tariff.amount, deliveredCount);

    const variance =
      closed.cash_variance == null ? null : closed.cash_variance.toString();

    return {
      route: closed,
      variance,
      payout: {
        mode: tariff.mode,
        amount: tariff.amount,
        currency: tariff.currency,
        earned,
      } as CarrierPayout,
    };
  }

  // ── Detalle de parada + editar dirección ──────────────────────────────────

  /**
   * Detalle de una parada de MI ruta activa: resuelve el `dispatch_note_id` de
   * la parada y REUSA `DispatchNotesService.findOne` para devolver la remisión
   * completa (ítems + producto + …), el MISMO shape que el admin
   * `GET /store/dispatch-notes/:id`. Aislamiento por construcción:
   * `assertStopBelongsToRoute` garantiza que la parada es de mi ruta.
   */
  async getStopDetail(stopId: number) {
    const route = await this.requireMyActiveRoute();
    this.assertStopBelongsToRoute(route, stopId);
    const noteId = this.resolveStopNoteId(route, stopId);
    return this.dispatchNotesService.findOne(noteId);
  }

  /**
   * Editar la dirección de entrega de una parada de MI ruta activa. Delega en
   * `DispatchNotesService.updateCustomerAddressSnapshot`, que sólo re-snapshotea
   * la dirección (display + mapa) — NO toca inventario ni contabilidad.
   */
  async updateStopAddress(stopId: number, dto: UpdateDispatchNoteAddressDto) {
    const route = await this.requireMyActiveRoute();
    this.assertStopBelongsToRoute(route, stopId);
    const noteId = this.resolveStopNoteId(route, stopId);
    return this.dispatchNotesService.updateCustomerAddressSnapshot(noteId, dto);
  }

  /** Resolver el `dispatch_note_id` de una parada YA validada como mía. */
  private resolveStopNoteId(
    route: { stops: Array<{ id: number; dispatch_note_id: number }> },
    stopId: number,
  ): number {
    const stop = route.stops.find((s) => s.id === stopId);
    const noteId = stop?.dispatch_note_id;
    if (!noteId) {
      throw new NotFoundException(
        `La parada #${stopId} no tiene remisión asociada`,
      );
    }
    return noteId;
  }

  // ── Historial de rutas del carrier ────────────────────────────────────────

  /**
   * Historial paginado de MIS planillas (TODOS los estados, incl. closed/voided).
   * `dispatch_routes` NO es auto-scoped → se filtra `store_id` manualmente,
   * junto con `driver_user_id` (mías) e `is_carrier_route`.
   */
  async listMyRoutes(query: RouteHistoryQueryDto): Promise<{
    data: unknown[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { store_id, user_id } = this.requireContext();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.dispatch_routesWhereInput = {
      store_id,
      driver_user_id: user_id,
      is_carrier_route: true,
      ...(query.status
        ? { status: query.status as dispatch_route_status_enum }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.dispatch_routes.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          vehicle: true,
          _count: { select: { stops: true } },
        },
      }),
      this.prisma.dispatch_routes.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Detalle de UNA de mis planillas del historial (por id, cualquier estado).
   * Aislamiento: el `findFirst` filtra `store_id` + `driver_user_id` +
   * `is_carrier_route`, así una planilla ajena devuelve null → 404.
   */
  async getMyRouteById(id: number) {
    const { store_id, user_id } = this.requireContext();
    const route = await this.prisma.dispatch_routes.findFirst({
      where: {
        id,
        store_id,
        driver_user_id: user_id,
        is_carrier_route: true,
      },
      include: {
        stops: {
          orderBy: { stop_sequence: 'asc' },
          include: { dispatch_note: true },
        },
        vehicle: true,
      },
    });
    if (!route) {
      throw new NotFoundException(`Planilla #${id} no encontrada`);
    }
    return route;
  }

  // ── Helpers de ejecución (Fase B7) ────────────────────────────────────────

  /** Resolver MI ruta activa o lanzar CARRIER_NO_ACTIVE_ROUTE (404). */
  private async requireMyActiveRoute() {
    const route = await this.getMyActiveRoute();
    if (!route) {
      throw new VendixHttpException(ErrorCodes.CARRIER_NO_ACTIVE_ROUTE);
    }
    return route;
  }

  /** Validar que la parada pertenece a MI ruta (aislamiento por construcción). */
  private assertStopBelongsToRoute(
    route: { stops: Array<{ id: number }> },
    stopId: number,
  ): void {
    if (!route.stops.some((s) => s.id === stopId)) {
      throw new ForbiddenException(
        `La parada #${stopId} no pertenece a tu ruta activa`,
      );
    }
  }

  /**
   * Tras liberar una parada, si su orden estaba publicada en el pool
   * (`dispatch_pool_at != null`), suelta el claim CONSERVANDO
   * `dispatch_pool_at` (reaparece en el pool) y re-emite
   * `order.awaiting_carrier`. Best-effort: un fallo aquí NO revierte la
   * liberación ya efectuada por el motor.
   */
  private async reexposeReleasedPoolOrder(
    route_id: number,
    stopId: number,
    store_id: number,
  ): Promise<void> {
    try {
      const stop = await this.prisma.dispatch_route_stops.findFirst({
        where: { id: stopId, route_id },
        select: { dispatch_note: { select: { order_id: true } } },
      });
      const order_id = stop?.dispatch_note?.order_id ?? null;
      if (!order_id) return;

      // Sólo reexponer si la orden vino del pool de repartidores.
      const order = await this.prisma.orders.findFirst({
        where: { id: order_id },
        select: { dispatch_pool_at: true },
      });
      if (!order?.dispatch_pool_at) return;

      await this.prisma.orders.updateMany({
        where: { id: order_id, store_id },
        data: { claimed_by_carrier_user_id: null },
      });

      // Re-notificar a los carriers (mismo shape que B5).
      this.eventEmitter.emit('order.awaiting_carrier', { order_id, store_id });
    } catch (e) {
      this.logger.error(
        `[carrier.releaseStop] no se pudo reexponer la orden de la parada #${stopId} al pool: ${String(
          e,
        )}`,
      );
    }
  }

  // ── Tarifa configurable + payout (Fase B8) ────────────────────────────────

  /**
   * Resolver la tarifa del repartidor por cascada:
   *   1. `user_settings.config.carrier_tariff` (por user_id — user_settings NO
   *      es store-scoped).
   *   2. `store_settings.settings.carrier.default_tariff` (por store_id).
   *   3. `{ mode:'per_stop', amount:'0', currency:'COP' }`.
   * `amount` ausente/malformado se trata como '0' (nunca lanza). Dinero SIEMPRE
   * string, nunca float.
   */
  private async resolveTariff(
    user_id: number,
    store_id: number,
  ): Promise<CarrierTariff> {
    const fromUser = await this.readUserTariff(user_id);
    if (fromUser) return fromUser;
    const fromStore = await this.readStoreTariff(store_id);
    if (fromStore) return fromStore;
    return { mode: 'per_stop', amount: '0', currency: 'COP' };
  }

  /** Lee `user_settings.config.carrier_tariff` por user_id (no store-scoped). */
  private async readUserTariff(user_id: number): Promise<CarrierTariff | null> {
    try {
      const row = await this.prisma.user_settings.findFirst({
        where: { user_id },
        select: { config: true },
      });
      const config = this.asObject(row?.config);
      return this.parseTariff(config['carrier_tariff']);
    } catch {
      return null;
    }
  }

  /** Lee `store_settings.settings.carrier.default_tariff` por store_id. */
  private async readStoreTariff(store_id: number): Promise<CarrierTariff | null> {
    try {
      const row = await this.prisma.store_settings.findFirst({
        where: { store_id },
        select: { settings: true },
      });
      const settings = this.asObject(row?.settings);
      const carrier = this.asObject(settings['carrier']);
      return this.parseTariff(carrier['default_tariff']);
    } catch {
      return null;
    }
  }

  /**
   * Parse un blob JSON como CarrierTariff. Devuelve null cuando NO hay un `mode`
   * válido (⇒ el nivel de la cascada se considera "ausente"). Un `mode` válido
   * con `amount` ausente/malformado produce una tarifa con `amount:'0'`.
   */
  private parseTariff(raw: unknown): CarrierTariff | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    const mode =
      obj.mode === 'per_route'
        ? 'per_route'
        : obj.mode === 'per_stop'
          ? 'per_stop'
          : null;
    if (!mode) return null;
    const currency =
      typeof obj.currency === 'string' && obj.currency.trim().length > 0
        ? obj.currency
        : 'COP';
    return { mode, amount: this.normalizeAmount(obj.amount), currency };
  }

  /** Dinero como string; ausente/malformado ⇒ '0'. Nunca lanza, nunca float. */
  private normalizeAmount(value: unknown): string {
    if (value === null || value === undefined) return '0';
    if (typeof value === 'string') {
      const t = value.trim();
      if (t.length === 0 || Number.isNaN(Number(t))) return '0';
      return t;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : '0';
    }
    return '0';
  }

  /** Multiplica dinero (string) por un contador entero vía Decimal (no float). */
  private multiplyMoney(amount: string, count: number): string {
    try {
      return new Prisma.Decimal(amount).mul(count).toString();
    } catch {
      return '0';
    }
  }

  /** Coacciona un JsonValue a objeto plano ({} si no es objeto). */
  private asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
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

    // La orden salió del pool → notificar a los streams SSE de repartidores
    // para que la retiren de su lista en vivo (mismo shape que la limpieza).
    this.eventEmitter.emit('carrier.pool.changed', { store_id });

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
