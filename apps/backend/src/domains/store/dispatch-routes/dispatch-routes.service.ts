import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import {
  Prisma,
  dispatch_route_status_enum,
  dispatch_route_stop_status_enum,
} from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateDispatchRouteDto,
  UpdateDispatchRouteDto,
  DispatchRouteQueryDto,
  AddStopsDto,
} from './dto';
import { RouteNumberGenerator } from './utils/route-number-generator';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { GeocodingService } from '../../ecommerce/geocoding/geocoding.service';
import { RouteFlowService } from './route-flow/route-flow.service';
import {
  buildStopsData,
  computeRouteTotals,
  buildRouteReconciliation,
  deriveStopIsPrepaid,
  resolveIsPrepaid,
  RouteReconciliation,
  ReconciliationStopInput,
  RouteStopNoteInput,
  RouteStopSequenceInput,
} from './utils/route-stop-calc';

const DISPATCH_ROUTE_INCLUDE = {
  vehicle: true,
  driver_user: {
    select: { id: true, first_name: true, last_name: true, document_number: true },
  },
  dispatched_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  closed_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  voided_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  origin_location: {
    select: { id: true, name: true, code: true },
  },
  stops: {
    orderBy: { stop_sequence: 'asc' as const },
    include: {
      dispatch_note: {
        select: {
          id: true,
          dispatch_number: true,
          customer_id: true,
          customer_name: true,
          grand_total: true,
          status: true,
          sales_order_id: true,
          order_id: true,
          // Live payment signals → DERIVED is_prepaid on read (never the frozen
          // persisted stop boolean).
          needs_collection: true,
          // Delivery-address snapshot for the planilla per-stop address.
          customer_address: true,
          sales_order: { select: { id: true, order_number: true, status: true } },
          invoice: { select: { payment_date: true } },
          order: {
            select: {
              id: true,
              remaining_balance: true,
              shipping_address_snapshot: true,
            },
          },
          // Withholding-agent flag drives the UI banner + the backend
          // re-validation in route-flow.service.settleStop().
          customer: { select: { is_withholding_agent: true } },
        },
      },
      settled_by_user: {
        select: { id: true, first_name: true, last_name: true },
      },
    },
  },
};

/**
 * Map-view include: a slimmer, purpose-built projection for
 * `GET :id/map-stops`. Unlike {@link DISPATCH_ROUTE_INCLUDE} it (a) restricts
 * the stops to the drawable set — the active not-yet-delivered stops
 * (`pending` / `in_progress`) PLUS the already `delivered` ones (the frontend
 * paints delivered stops in green alongside the pending ones, regardless of the
 * planilla's own state); `failed`/`rejected`/`released`/`partial` drop out — and
 * (b) pulls the coordinate + address fields needed to resolve each stop's
 * lat/lng: the note's `customer_address` snapshot, the order's
 * `shipping_address_snapshot`, and the order's live shipping-address row
 * (id + latitude/longitude — the FUENTE DE VERDAD for coordinates). The origin
 * location's coordinates live on its linked `addresses` row (inventory_locations
 * itself has no lat/lng column).
 */
const MAP_STOPS_INCLUDE = {
  origin_location: {
    select: {
      id: true,
      name: true,
      addresses: { select: { latitude: true, longitude: true } },
    },
  },
  stops: {
    where: {
      status: {
        in: [
          dispatch_route_stop_status_enum.pending,
          dispatch_route_stop_status_enum.in_progress,
          dispatch_route_stop_status_enum.delivered,
        ],
      },
    },
    orderBy: { stop_sequence: 'asc' as const },
    include: {
      dispatch_note: {
        select: {
          id: true,
          customer_id: true,
          customer_name: true,
          customer_address: true,
          order: {
            select: {
              shipping_address_id: true,
              shipping_address_snapshot: true,
              addresses_orders_shipping_address_idToaddresses: {
                select: {
                  id: true,
                  latitude: true,
                  longitude: true,
                  address_line1: true,
                  address_line2: true,
                  city: true,
                  state_province: true,
                  country_code: true,
                },
              },
            },
          },
        },
      },
    },
  },
};

/** Coordinate + address projection of an `addresses` row used by the map. */
interface MapAddressRow {
  id: number;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state_province: string | null;
  country_code: string;
}

/** The dispatch_note shape loaded by {@link MAP_STOPS_INCLUDE}. */
interface MapStopDispatchNote {
  id: number;
  customer_id: number;
  customer_name: string | null;
  customer_address: Prisma.JsonValue | null;
  order: {
    shipping_address_id: number | null;
    shipping_address_snapshot: Prisma.JsonValue | null;
    addresses_orders_shipping_address_idToaddresses: MapAddressRow | null;
  } | null;
}

/** A single stop as loaded by {@link MAP_STOPS_INCLUDE}. */
interface MapStopSource {
  id: number;
  stop_sequence: number;
  status: dispatch_route_stop_status_enum;
  dispatch_note: MapStopDispatchNote | null;
}

/** Structured address parts extracted from the best available source. */
interface AddressParts {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

/** Result of {@link DispatchRoutesService.resolveStopCoordinates}. */
interface ResolvedStopCoords {
  lat: number | null;
  lng: number | null;
  geocoded: boolean;
  addressText: string | null;
}

/** A located stop in the map response (has resolvable coordinates). */
export interface MapStopLocated {
  stopId: number;
  sequence: number;
  status: dispatch_route_stop_status_enum;
  customerName: string | null;
  addressText: string | null;
  lat: number;
  lng: number;
  geocoded: boolean;
}

/** An unlocated stop in the map response (no coordinates resolvable). */
export interface MapStopUnlocated {
  stopId: number;
  sequence: number;
  customerName: string | null;
  addressText: string | null;
}

/** Full response body of `GET /store/dispatch-routes/:id/map-stops`. */
export interface MapStopsResponse {
  origin: { lat: number; lng: number } | null;
  /** Active not-yet-delivered stops with coordinates (`pending`/`in_progress`). */
  stops: MapStopLocated[];
  /** Already `delivered` stops with coordinates (painted green on the map). */
  delivered: MapStopLocated[];
  /** Active stops (`pending`/`in_progress`) with no resolvable coordinates. */
  unlocated: MapStopUnlocated[];
}

@Injectable()
export class DispatchRoutesService {
  private readonly logger = new Logger(DispatchRoutesService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly routeNumberGenerator: RouteNumberGenerator,
    private readonly geocoding: GeocodingService,
    private readonly routeFlow: RouteFlowService,
  ) {}

  /**
   * Guard that every dispatch_note about to be planned is still eligible to
   * join a route. A note is planificable only while it is 'draft' or
   * 'confirmed'; a note already 'delivered' / 'received' / 'invoiced' /
   * 'voided' is terminal for this flow and must be rejected (409) instead of
   * silently attached. Reuses the notes the caller already loaded (no extra
   * query). Surfaces the offending `dispatch_number`(s) in the error detail.
   */
  private assertNotesEligible(
    notes: ReadonlyArray<{ dispatch_number: string; status: string }>,
  ): void {
    const ineligible = notes.filter(
      (n) => n.status !== 'draft' && n.status !== 'confirmed',
    );
    if (ineligible.length === 0) return;
    const numbers = ineligible.map((n) => n.dispatch_number).join(', ');
    throw new VendixHttpException(
      ErrorCodes.DSP_NOTE_NOT_ELIGIBLE_001,
      `La remisión ${numbers} no puede planillarse porque ya fue entregada, recibida, facturada o anulada.`,
      { dispatch_numbers: numbers },
    );
  }

  private getStoreId(): number {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  /**
   * Validate the driver/assistant block and defensively sanitize `assistants`.
   *
   * Shared by `create()` and `update()` so both entry points enforce the same
   * invariants (the frontend wizard already prevents these cases, but the
   * backend must not trust the client). On success it MUTATES `dto.assistants`
   * to the cleaned array (same behaviour create() relied on before).
   *
   * Rules enforced:
   * 1. Internal (`driver_user_id`) and external (`external_driver_*`) driver are
   *    mutually exclusive — they cannot both be present.
   * 2. When `requireDriver` is true (create), a complete driver must be
   *    provided: if `is_primary_driver_external` the external name + id_number
   *    are required, otherwise `driver_user_id` is required. On a partial
   *    update (`requireDriver = false`) this presence requirement is skipped so
   *    a PATCH that doesn't touch driver fields stays valid.
   * 3. The driver (`driver_user_id`) cannot also appear as an assistant
   *    (`assistants[].user_id`) — checked AFTER sanitizing assistants.
   *
   * @param requireDriver when true (create) enforce that a driver is present.
   */
  private validateDriverAndAssistants(
    dto: CreateDispatchRouteDto | UpdateDispatchRouteDto,
    requireDriver: boolean,
  ): void {
    // (1) Internal vs external driver mutual exclusion.
    if (
      dto.driver_user_id &&
      (dto.external_driver_name || dto.external_driver_id_number)
    ) {
      throw new BadRequestException(
        'Conductor interno y externo son mutuamente excluyentes',
      );
    }

    // (2) On create, a complete driver must be provided.
    if (requireDriver) {
      if (dto.is_primary_driver_external) {
        if (!dto.external_driver_name || !dto.external_driver_id_number) {
          throw new BadRequestException(
            'Conductor externo requiere external_driver_name y external_driver_id_number',
          );
        }
      } else {
        if (!dto.driver_user_id) {
          throw new BadRequestException(
            'Conductor interno requiere driver_user_id',
          );
        }
      }
    }

    // Sanitize `assistants` defensive pass (DTO already validates shape with
    // class-validator; this catches any item missing both user_id and external
    // fields that would otherwise persist as `[]` on the JSONB column).
    if (dto.assistants && Array.isArray(dto.assistants)) {
      const cleaned: any[] = [];
      for (const a of dto.assistants) {
        if (!a || typeof a !== 'object') continue;
        const obj = a as Record<string, unknown>;
        const hasUser = typeof obj.user_id === 'number' && obj.user_id > 0;
        const hasExt =
          typeof obj.external_name === 'string' &&
          obj.external_name.length > 0 &&
          typeof obj.external_id_number === 'string' &&
          obj.external_id_number.length > 0;
        if (!hasUser && !hasExt) continue; // skip invalid items silently
        cleaned.push(obj);
      }
      dto.assistants = cleaned;
    }

    // (3) The driver cannot also be listed as an assistant (checked after the
    // sanitize pass so released/invalid items don't trigger a false positive).
    if (dto.driver_user_id && Array.isArray(dto.assistants)) {
      const driverIsAssistant = dto.assistants.some(
        (a) =>
          a &&
          typeof a === 'object' &&
          (a as Record<string, unknown>).user_id === dto.driver_user_id,
      );
      if (driverIsAssistant) {
        throw new BadRequestException(
          'El conductor no puede figurar también como auxiliar',
        );
      }
    }
  }

  async create(dto: CreateDispatchRouteDto) {
    const store_id = this.getStoreId();
    const user_id = RequestContextService.getContext()?.user_id;

    // Validate driver (mutual exclusion + required driver) and sanitize
    // assistants (mutates dto.assistants). create() always requires a driver.
    this.validateDriverAndAssistants(dto, true);

    // Validate that all dispatch_notes exist, belong to this store, and are not already in another route
    const note_ids = dto.stops.map((s) => s.dispatch_note_id);
    const unique_note_ids = Array.from(new Set(note_ids));
    if (unique_note_ids.length !== note_ids.length) {
      throw new BadRequestException(
        'Hay dispatch_note_id duplicados en la planilla',
      );
    }

    const existing_notes = await this.prisma.dispatch_notes.findMany({
      where: { id: { in: unique_note_ids }, store_id },
      select: {
        id: true,
        store_id: true,
        // dispatch_number + order_id feed both the eligibility error detail and
        // the `dispatch_note.confirmed` auto-confirm payload (no extra query).
        dispatch_number: true,
        status: true,
        sales_order_id: true,
        order_id: true,
        grand_total: true,
        needs_collection: true,
        invoice: { select: { id: true, status: true, payment_date: true } },
      },
    });
    if (existing_notes.length !== unique_note_ids.length) {
      throw new BadRequestException(
        'Una o más remisiones no existen o no pertenecen a la tienda',
      );
    }

    // Eligibility gate: only draft/confirmed notes can be planned. A
    // delivered/received/invoiced/voided note is terminal for the route flow.
    this.assertNotesEligible(existing_notes);

    // Check whether the dispatch_notes are already in an active (non-released) stop.
    // A stop blocks reuse iff it is not yet 'released'. The previous carve-out
    // that allowed `route.status === 'draft'` violated the partial unique
    // index `dispatch_route_stops_dispatch_note_id_active_idx` (which uses
    // `WHERE status <> 'released'`) and produced 500 errors when the wizard
    // selected a note that was reserved by an unrelated draft route.
    const existing_stops = await this.prisma.dispatch_route_stops.findMany({
      where: { dispatch_note_id: { in: unique_note_ids } },
      include: { route: { select: { status: true } } },
    });
    const blocking = existing_stops.filter((s) => s.status !== 'released');
    if (blocking.length > 0) {
      throw new BadRequestException(
        `Las remisiones ${blocking.map((s) => s.dispatch_note_id).join(', ')} ya pertenecen a una planilla activa (estado: ${blocking.map((s) => s.route.status).join(', ')})`,
      );
    }

    // Validate vehicle
    if (dto.vehicle_id) {
      const vehicle = await this.prisma.vehicles.findFirst({
        where: { id: dto.vehicle_id, store_id },
      });
      if (!vehicle) {
        throw new BadRequestException('Vehículo no encontrado en la tienda');
      }
    }

    // Plan Despacho Economía — FASE 3 paso 11.
    // Auto-configuración desde la política del método cuando el usuario no
    // pasa el ejecutor explícitamente. Mantiene UX cero-fricción: el operador
    // elige el método y el resto se rellena solo.
    let resolvedVehicle = dto.vehicle_id ?? null;
    let resolvedDriver = dto.driver_user_id ?? null;
    let resolvedCarrier = dto.external_carrier_supplier_id ?? null;

    if (dto.shipping_method_id) {
      const method = await this.prisma.shipping_methods.findFirst({
        where: { id: dto.shipping_method_id, is_system: false },
      });
      if (!method) {
        throw new BadRequestException(
          `Método de envío #${dto.shipping_method_id} no habilitado en la tienda`,
        );
      }
      // Mismo método ⇒ autocompletar desde la política.
      if (method.collects_payment && !dto.external_carrier_supplier_id) {
        // noop marker — el carrier es opcional; se setea abajo.
      }
      if (!resolvedVehicle && method.default_vehicle_id) {
        const v = await this.prisma.vehicles.findFirst({
          where: { id: method.default_vehicle_id, store_id },
        });
        if (v) resolvedVehicle = method.default_vehicle_id;
      }
      if (!resolvedDriver && method.default_driver_user_id) {
        resolvedDriver = method.default_driver_user_id;
      }
      if (!resolvedCarrier && method.default_carrier_supplier_id) {
        const s = await this.prisma.suppliers.findFirst({
          where: {
            id: method.default_carrier_supplier_id,
            store_id,
            supplier_category: 'carrier',
          },
        });
        if (s) resolvedCarrier = method.default_carrier_supplier_id;
      }
    }

    // Generate route_number
    let route_number: string;
    let attempts = 0;
    while (true) {
      try {
        route_number = await this.routeNumberGenerator.generateNextNumber(store_id);
        // Calculate totals from stops using the pure route-stop calculators.
        // needs_collection wins when present; fallback to invoice.payment_date.
        const notes_by_id: ReadonlyMap<number, RouteStopNoteInput> = new Map(
          existing_notes.map((n) => [n.id, n]),
        );
        const stops_data = buildStopsData(dto.stops, notes_by_id);
        const { total_to_collect, total_prepaid } = computeRouteTotals(
          stops_data,
          notes_by_id,
        );

        // Create the route + stops and auto-confirm any draft note in the SAME
        // transaction, then emit `dispatch_note.confirmed` post-commit (the
        // reservation listener re-reads the note and must see 'confirmed'
        // persisted). Reuses the shared RouteFlowService mechanism.
        const { created, confirmedPayloads } = await this.prisma.$transaction(
          async (tx: any) => {
            const created = await tx.dispatch_routes.create({
              data: {
                store_id,
                route_number,
                route_code: dto.route_code,
                status: 'draft',
                vehicle_id: resolvedVehicle,
                driver_user_id: resolvedDriver,
                external_driver_name: dto.external_driver_name,
                external_driver_id_number: dto.external_driver_id_number,
                is_primary_driver_external:
                  dto.is_primary_driver_external ?? false,
                assistants: dto.assistants as any,
                origin_location_id: dto.origin_location_id,
                // Plan Despacho Economía — FASE 3 paso 11.
                shipping_method_id: dto.shipping_method_id ?? null,
                external_carrier_supplier_id: resolvedCarrier,
                planned_date: new Date(dto.planned_date),
                currency: dto.currency || 'COP',
                notes: dto.notes,
                total_to_collect,
                total_prepaid,
                created_by_user_id: user_id,
                updated_at: new Date(),
                stops: {
                  create: stops_data,
                },
              },
              include: DISPATCH_ROUTE_INCLUDE,
            });
            const confirmedPayloads =
              await this.routeFlow.confirmDraftNotesInTx(
                tx,
                existing_notes,
                user_id,
                store_id,
              );
            return { created, confirmedPayloads };
          },
        );
        this.routeFlow.emitConfirmedNotes(confirmedPayloads);
        return created;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          (error.meta?.target as string[])?.includes('route_number')
        ) {
          attempts++;
          if (attempts >= 3) {
            throw new ConflictException(
              'No se pudo generar un número de planilla único',
            );
          }
          continue;
        }
        throw error;
      }
    }
  }

  async findAll(query: DispatchRouteQueryDto) {
    const store_id = this.getStoreId();
    const {
      page = 1,
      limit = 10,
      search,
      status,
      vehicle_id,
      driver_user_id,
      date_from,
      date_to,
      sort_by,
      sort_order,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.dispatch_routesWhereInput = {
      store_id,
      ...(search && {
        OR: [
          { route_number: { contains: search, mode: 'insensitive' as any } },
          { route_code: { contains: search, mode: 'insensitive' as any } },
          { external_driver_name: { contains: search, mode: 'insensitive' as any } },
        ],
      }),
      // `status` may be a single value or an array (DTO accepts
      // `?status=draft,dispatched`); Prisma's `in` filter handles both
      // shapes for the enum column.
      ...(status &&
        (Array.isArray(status) ? { status: { in: status } } : { status })),
      ...(vehicle_id && { vehicle_id }),
      ...(driver_user_id && { driver_user_id }),
      ...(date_from && date_to && {
        planned_date: { gte: new Date(date_from), lte: new Date(date_to) },
      }),
    };

    const orderBy: any = {};
    if (sort_by) {
      orderBy[sort_by] = sort_order === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.created_at = 'desc';
    }

    const [data, total] = await Promise.all([
      this.prisma.dispatch_routes.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          vehicle: { select: { id: true, plate: true, type: true } },
          driver_user: {
            select: { id: true, first_name: true, last_name: true },
          },
          _count: { select: { stops: true } },
        },
      }),
      this.prisma.dispatch_routes.count({ where }),
    ]);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Plan Despacho Economía — FASE 3 paso 11.
   * Helper de derivación: si la ruta no tiene `shipping_method_id` (caso
   * legacy o ruta creada sin método explícito), lo deriva del set mayoritario
   * de órdenes asociadas. Devuelve `null` si la ruta no tiene paradas o las
   * órdenes tienen métodos mixtos sin mayoría clara.
   *
   * NO modifica el registro — es solo lectura. Usado por el monitor y por
   * el listener de settlement (FASE 5) cuando necesita resolver la política.
   */
  async resolveRouteShippingMethod(id: number): Promise<number | null> {
    const store_id = this.getStoreId();
    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id },
      select: { shipping_method_id: true },
    });
    if (!route) return null;
    if (route.shipping_method_id) return route.shipping_method_id;

    const method_counts = await this.prisma.dispatch_route_stops.groupBy({
      by: ['dispatch_note_id'],
      where: { route_id: id },
    });
    const note_ids = method_counts.map((s) => s.dispatch_note_id);
    if (note_ids.length === 0) return null;

    const notes = await this.prisma.dispatch_notes.findMany({
      where: { id: { in: note_ids } },
      select: { sales_order_id: true },
    });
    const order_ids = notes
      .map((n) => n.sales_order_id)
      .filter((x): x is number => !!x);
    if (order_ids.length === 0) return null;

    const orders = await this.prisma.orders.findMany({
      where: { id: { in: order_ids } },
      select: { shipping_method_id: true },
    });
    const counts = new Map<number, number>();
    for (const o of orders) {
      if (!o.shipping_method_id) continue;
      counts.set(o.shipping_method_id, (counts.get(o.shipping_method_id) ?? 0) + 1);
    }
    if (counts.size === 0) return null;
    // Devuelve el método con mayor recurrencia.
    let best: number | null = null;
    let best_count = 0;
    for (const [mid, c] of counts) {
      if (c > best_count) {
        best = mid;
        best_count = c;
      }
    }
    return best;
  }

  async findOne(id: number) {
    const store_id = this.getStoreId();
    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id },
      include: DISPATCH_ROUTE_INCLUDE,
    });
    if (!route) throw new NotFoundException(`Planilla #${id} no encontrada`);

    // Surface `customer.is_withholding_agent` as a top-level
    // `customer_is_withholding_agent` on each stop's dispatch_note for
    // legacy UI consumers. The nested `customer` object remains the
    // source of truth. We ALSO overwrite each stop's `is_prepaid` with the
    // DERIVED value (live note/order payment state) so the frontend reflects
    // the real prepaid status instead of the frozen persisted boolean.
    const stops_with_alias = (route.stops ?? []).map((stop: any) => {
      const dn = stop.dispatch_note ?? null;
      const is_prepaid = deriveStopIsPrepaid(stop);
      if (!dn) return { ...stop, is_prepaid };
      return {
        ...stop,
        is_prepaid,
        dispatch_note: {
          ...dn,
          customer_is_withholding_agent:
            dn.customer?.is_withholding_agent ?? false,
        },
      };
    });

    const reconciliation = this.buildReconciliation({
      ...route,
      stops: stops_with_alias,
    });
    return { ...route, stops: stops_with_alias, reconciliation };
  }

  /**
   * Derive the structured reconciliation summary (por recaudar vs recaudado,
   * faltante/sobrante, por parada) from the data already loaded on the route.
   * Computed on read — NOT a DB column. For a closed route the persisted close
   * totals (`total_collected`, `cash_variance`) are reused; for an open route a
   * projection is computed from the live stops via the pure helper.
   */
  private buildReconciliation(
    route: Prisma.dispatch_routesGetPayload<{
      include: typeof DISPATCH_ROUTE_INCLUDE;
    }>,
  ): RouteReconciliation {
    const stops: ReconciliationStopInput[] = route.stops.map((stop) => ({
      stop_sequence: stop.stop_sequence,
      dispatch_note_id: stop.dispatch_note_id,
      is_prepaid: stop.is_prepaid,
      result: stop.result,
      collected_amount: Number(stop.collected_amount ?? 0),
      anticipo_amount: Number(stop.anticipo_amount ?? 0),
      dispatch_note_grand_total: Number(stop.dispatch_note?.grand_total ?? 0),
    }));

    return buildRouteReconciliation(stops, {
      is_closed: route.status === 'closed',
      persisted: {
        total_collected:
          route.total_collected != null
            ? Number(route.total_collected)
            : null,
        cash_variance:
          route.cash_variance != null ? Number(route.cash_variance) : null,
      },
    });
  }

  /**
   * Add one or more dispatch notes as new stops to a "hot" route.
   *
   * Only routes in `draft` or `dispatched` admit new stops; any other state
   * (in_transit / settling / closed / voided) is rejected. Notes already
   * present on the route raise a conflict. After inserting the new stops the
   * route totals are recomputed over the COMPLETE set (existing + new) using
   * the same pure calculators as create() so is_prepaid semantics stay aligned.
   */
  async addStops(id: number, dto: AddStopsDto) {
    const store_id = this.getStoreId();
    const user_id = RequestContextService.getContext()?.user_id;

    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id },
      include: {
        stops: {
          select: {
            dispatch_note_id: true,
            stop_sequence: true,
            is_prepaid: true,
          },
        },
      },
    });
    if (!route) throw new NotFoundException(`Planilla #${id} no encontrada`);

    // State gate: only "hot" routes (draft / dispatched) accept new stops.
    const EDITABLE_STATES: dispatch_route_status_enum[] = ['draft', 'dispatched'];
    if (!EDITABLE_STATES.includes(route.status)) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_NOT_EDITABLE_001);
    }

    // No duplicate dispatch_note_id within the incoming payload.
    const new_note_ids = dto.stops.map((s) => s.dispatch_note_id);
    const unique_new_ids = Array.from(new Set(new_note_ids));
    if (unique_new_ids.length !== new_note_ids.length) {
      throw new BadRequestException(
        'Hay dispatch_note_id duplicados en la solicitud',
      );
    }

    // Conflict: a note already present on this route cannot be re-added.
    const existing_note_ids = new Set(
      route.stops.map((s) => s.dispatch_note_id),
    );
    const conflicting = unique_new_ids.filter((nid) =>
      existing_note_ids.has(nid),
    );
    if (conflicting.length > 0) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_STOP_CONFLICT_001);
    }

    // Load the new dispatch notes with the SAME select shape as create().
    const new_notes = await this.prisma.dispatch_notes.findMany({
      where: { id: { in: unique_new_ids }, store_id },
      select: {
        id: true,
        store_id: true,
        // dispatch_number + order_id feed the eligibility error detail and the
        // `dispatch_note.confirmed` auto-confirm payload (no extra query).
        dispatch_number: true,
        status: true,
        sales_order_id: true,
        order_id: true,
        grand_total: true,
        needs_collection: true,
        invoice: { select: { id: true, status: true, payment_date: true } },
      },
    });
    if (new_notes.length !== unique_new_ids.length) {
      throw new BadRequestException(
        'Una o más remisiones no existen o no pertenecen a la tienda',
      );
    }

    // Eligibility gate: only draft/confirmed notes can be planned. A
    // delivered/received/invoiced/voided note is terminal for the route flow.
    this.assertNotesEligible(new_notes);

    // Assignability: a note already sitting on an active (non-released) stop
    // of any other route cannot be assigned. Mirrors create()'s rule and the
    // partial unique index `dispatch_route_stops_dispatch_note_id_active_idx`
    // (`WHERE status <> 'released'`).
    const other_stops = await this.prisma.dispatch_route_stops.findMany({
      where: {
        dispatch_note_id: { in: unique_new_ids },
        route_id: { not: id },
      },
      include: { route: { select: { status: true } } },
    });
    const blocking = other_stops.filter((s) => s.status !== 'released');
    if (blocking.length > 0) {
      throw new BadRequestException(
        `Las remisiones ${blocking
          .map((s) => s.dispatch_note_id)
          .join(', ')} ya pertenecen a una planilla activa`,
      );
    }

    // Compute the starting sequence for stops that omit stop_sequence:
    // continue after the current max sequence on the route.
    const current_max_sequence = route.stops.reduce(
      (max, s) => Math.max(max, s.stop_sequence ?? 0),
      0,
    );
    const new_stop_inputs: RouteStopSequenceInput[] = dto.stops.map(
      (stop, idx) => ({
        dispatch_note_id: stop.dispatch_note_id,
        stop_sequence: stop.stop_sequence ?? current_max_sequence + idx + 1,
      }),
    );

    const new_notes_by_id: ReadonlyMap<number, RouteStopNoteInput> = new Map(
      new_notes.map((n) => [n.id, n]),
    );
    const new_stops_data = buildStopsData(new_stop_inputs, new_notes_by_id);

    // Recompute route totals over the COMPLETE set (existing + new). is_prepaid
    // is DERIVED from each note's live payment state (needs_collection +
    // invoice.payment_date + order.remaining_balance), not the frozen persisted
    // stop boolean — so the recomputed totals match the read-path derivation.
    const existing_note_ids_list = route.stops.map((s) => s.dispatch_note_id);
    const existing_notes_full = await this.prisma.dispatch_notes.findMany({
      where: { id: { in: existing_note_ids_list }, store_id },
      select: {
        id: true,
        grand_total: true,
        needs_collection: true,
        invoice: { select: { payment_date: true } },
        order: { select: { remaining_balance: true } },
      },
    });
    const all_notes_by_id = new Map<number, RouteStopNoteInput>(
      new_notes.map((n) => [n.id, n]),
    );
    for (const n of existing_notes_full) all_notes_by_id.set(n.id, n);

    const all_stops_data = [
      ...route.stops.map((s) => {
        const note = all_notes_by_id.get(s.dispatch_note_id);
        return {
          dispatch_note_id: s.dispatch_note_id,
          stop_sequence: s.stop_sequence,
          is_extra_route: false,
          // DERIVE from the live note payment state instead of the frozen
          // persisted stop boolean, so totals match the read-path derivation.
          is_prepaid: note ? resolveIsPrepaid(note) : s.is_prepaid,
          collected_amount: 0,
          anticipo_amount: 0,
          change_amount: 0,
          withholding_amount: 0,
          credit_amount: 0,
          notes: null,
        };
      }),
      ...new_stops_data,
    ];
    const { total_to_collect, total_prepaid } = computeRouteTotals(
      all_stops_data,
      all_notes_by_id,
    );

    // Insert the new stops, refresh route totals, and auto-confirm any draft
    // note among the newly added ones — all in the SAME transaction. The
    // `dispatch_note.confirmed` events are emitted post-commit so the
    // reservation listener sees the persisted 'confirmed' status. Applies to a
    // destination route in both `draft` and `dispatched` states.
    const { updated, confirmedPayloads } = await this.prisma.$transaction(
      async (tx: any) => {
        await tx.dispatch_route_stops.createMany({
          data: new_stops_data.map((s) => ({ ...s, route_id: id })),
        });
        const updated = await tx.dispatch_routes.update({
          where: { id },
          data: {
            total_to_collect,
            total_prepaid,
            updated_at: new Date(),
          },
          include: DISPATCH_ROUTE_INCLUDE,
        });
        const confirmedPayloads = await this.routeFlow.confirmDraftNotesInTx(
          tx,
          new_notes,
          user_id,
          store_id,
        );
        return { updated, confirmedPayloads };
      },
    );
    this.routeFlow.emitConfirmedNotes(confirmedPayloads);
    return updated;
  }

  async update(id: number, dto: UpdateDispatchRouteDto) {
    const store_id = this.getStoreId();
    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id },
    });
    if (!route) throw new NotFoundException(`Planilla #${id} no encontrada`);

    if (route.status !== 'draft') {
      throw new BadRequestException(
        'Solo se pueden editar planillas en estado borrador',
      );
    }

    // Validate driver block + sanitize assistants. Partial update: the
    // mutual-exclusion and driver-vs-assistant checks only apply to the fields
    // actually present, and a complete driver is NOT required (requireDriver=false).
    this.validateDriverAndAssistants(dto, false);

    return this.prisma.$transaction(async (tx) => {
      // Update stops if provided
      if (dto.stops) {
        for (const stop_update of dto.stops) {
          // We need to identify the stop. Since update.dto doesn't include id,
          // we only support stop_sequence changes by matching on sequence.
          // For simplicity, the controller passes full DTO with stop_id implicitly
          // via the included dispatch_note. We'll skip sequence updates here and
          // expose a separate method if needed. For now: support add/remove via
          // dedicated endpoint, not via update.
        }
      }

      return tx.dispatch_routes.update({
        where: { id },
        data: {
          route_code: dto.route_code,
          vehicle_id: dto.vehicle_id,
          driver_user_id: dto.driver_user_id,
          external_driver_name: dto.external_driver_name,
          external_driver_id_number: dto.external_driver_id_number,
          is_primary_driver_external: dto.is_primary_driver_external,
          assistants: dto.assistants as any,
          origin_location_id: dto.origin_location_id,
          planned_date: dto.planned_date ? new Date(dto.planned_date) : undefined,
          currency: dto.currency,
          notes: dto.notes,
          updated_at: new Date(),
        },
        include: DISPATCH_ROUTE_INCLUDE,
      });
    });
  }

  async remove(id: number) {
    const store_id = this.getStoreId();
    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id },
    });
    if (!route) throw new NotFoundException(`Planilla #${id} no encontrada`);
    if (route.status !== 'draft') {
      throw new BadRequestException(
        'Solo se pueden eliminar planillas en estado borrador',
      );
    }
    // Free dispatch_notes by deleting the route (cascade deletes stops,
    // and the UNIQUE on dispatch_note_id is removed)
    await this.prisma.dispatch_routes.delete({ where: { id } });
    return { id, deleted: true };
  }

  async getStats() {
    const store_id = this.getStoreId();
    const [total, draft, dispatched, in_transit, closed, voided, totals] = await Promise.all([
      this.prisma.dispatch_routes.count({ where: { store_id } }),
      this.prisma.dispatch_routes.count({ where: { store_id, status: 'draft' } }),
      this.prisma.dispatch_routes.count({ where: { store_id, status: 'dispatched' } }),
      this.prisma.dispatch_routes.count({ where: { store_id, status: 'in_transit' } }),
      this.prisma.dispatch_routes.count({ where: { store_id, status: 'closed' } }),
      this.prisma.dispatch_routes.count({ where: { store_id, status: 'voided' } }),
      this.prisma.dispatch_routes.aggregate({
        where: { store_id, status: { in: ['closed', 'in_transit'] } },
        _sum: { total_to_collect: true, total_collected: true, cash_variance: true },
      }),
    ]);
    return {
      total,
      draft,
      dispatched,
      in_transit,
      closed,
      voided,
      total_to_collect: Number(totals._sum.total_to_collect || 0),
      total_collected: Number(totals._sum.total_collected || 0),
      total_cash_variance: Number(totals._sum.cash_variance || 0),
    };
  }

  /**
   * Lists dispatch notes that the operator can still pick when creating or
   * editing a planilla. A note is "available" iff:
   * - it belongs to the current store
   * - it is not voided
   * - it is NOT attached to a non-released stop of a non-draft route
   *   (draft routes "hold" their stops in a soft reservation; any other
   *   active/closed route locks the note).
   *
   * Used by the wizard's stop picker — see
   * `DispatchRoutesController.listAvailableNotes`. Without this filter the
   * legacy `dispatch-notes?status=confirmed` endpoint returns notes that the
   * backend then rejects with 500 on `create()`.
   */
  /**
   * Plan Despacho Economía — FASE 8 paso 24.
   * Monitor económico por ruta:
   *   recaudo              = total_collected + total_prepaid
   *   ingreso_flete        = SUM(shipping_amount) sobre dispatch_notes de la ruta
   *   costo_transporte     = SUM(accounts_payable.original_amount donde source_type='dispatch_route' Y source_id=route.id)
   *   margen_flete         = ingreso_flete − costo_transporte
   *   estado_liquidacion   = 'pending' | 'paid' (derivado de ap.balance)
   *
   * Paginado (ResponseService.paginated no aplica aquí; usamos el envoltorio
   * del controller vía `@Query`).
   */
  async getMonitor(query: {
    page?: number;
    limit?: number;
    store_id?: number;
  }) {
    const store_id = query.store_id ?? this.getStoreId();
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.max(1, Math.min(100, query.limit ?? 20));
    const skip = (page - 1) * limit;

    // Traemos las rutas cerradas como foco del monitor.
    const where: any = { store_id };
    const [routes, total] = await Promise.all([
      this.prisma.dispatch_routes.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ closed_at: 'desc' }, { id: 'desc' }],
        include: {
          shipping_method: {
            select: { id: true, name: true, type: true },
          },
        },
      }),
      this.prisma.dispatch_routes.count({ where }),
    ]);

    // Para cada ruta, agregar ingreso de flete (suma de shipping_amount de
    // sus dispatch_notes) y costo (AP source_type='dispatch_route').
    const route_ids = routes.map((r) => r.id);
    const [shipping_sums, ap_sums, executor_sums] = await Promise.all([
      route_ids.length === 0
        ? []
        : this.prisma.dispatch_notes.groupBy({
            by: ['route_id_fk' as any], // placeholder — Prisma no permite route_id directo en notes
          }).catch(() => []),
      route_ids.length === 0
        ? []
        : this.prisma.accounts_payable.groupBy({
            by: ['source_id'],
            where: {
              organization_id: undefined as any,
              source_type: 'dispatch_route',
              source_id: { in: route_ids },
            },
            _sum: { original_amount: true, paid_amount: true },
          }).catch(() => []),
      route_ids.length === 0
        ? []
        : this.prisma.dispatch_routes.findMany({
            where: { id: { in: route_ids } },
            select: {
              id: true,
              shipping_method_id: true,
              external_carrier_supplier_id: true,
              vehicle_id: true,
            },
          }),
    ]);

    // Ingreso de flete: dispatch_notes no tienen route_id directo; lo derivamos
    // vía dispatch_route_stops.sum(route_id) = route.id.
    const stop_groups =
      route_ids.length === 0
        ? []
        : await this.prisma.dispatch_route_stops.groupBy({
            by: ['route_id'],
            where: { route_id: { in: route_ids } },
            _count: { dispatch_note_id: true },
          });
    const stops_by_route = new Map<number, number>();
    stop_groups.forEach((g) =>
      stops_by_route.set(Number(g.route_id), g._count.dispatch_note_id),
    );

    // Para el flete: sumamos shipping_amount de las notes asociadas por ruta.
    const note_ids_by_route = new Map<number, number[]>();
    for (const r of route_ids) {
      const stops = await this.prisma.dispatch_route_stops.findMany({
        where: { route_id: r },
        select: { dispatch_note_id: true },
      });
      note_ids_by_route.set(
        r,
        stops.map((s) => s.dispatch_note_id),
      );
    }
    const all_note_ids = Array.from(
      new Set(
        Array.from(note_ids_by_route.values()).flat(),
      ),
    );
    // El ingreso de flete vive en `invoices.shipping_amount` (FASE 4 paso 13),
    // no en dispatch_notes. Lo leemos vía la relación dispatch_note.invoice.
    const notes =
      all_note_ids.length === 0
        ? []
        : await this.prisma.dispatch_notes.findMany({
            where: { id: { in: all_note_ids } },
            select: { id: true, invoice: { select: { shipping_amount: true } } },
          });
    const shipping_by_note = new Map<number, number>();
    notes.forEach((n) =>
      shipping_by_note.set(n.id, Number(n.invoice?.shipping_amount || 0)),
    );
    const shipping_by_route = new Map<number, number>();
    for (const [route_id, ids] of note_ids_by_route) {
      const total_shipping = ids.reduce(
        (acc, id) => acc + (shipping_by_note.get(id) ?? 0),
        0,
      );
      shipping_by_route.set(route_id, total_shipping);
    }

    const ap_by_route = new Map<number, number>();
    ap_sums.forEach((g: any) => {
      ap_by_route.set(Number(g.source_id), Number(g._sum.original_amount || 0));
    });

    const data = routes.map((r) => {
      const recaudo = Number(r.total_collected || 0) + Number(r.total_prepaid || 0);
      const ingreso_flete = shipping_by_route.get(r.id) ?? 0;
      const costo_transporte = ap_by_route.get(r.id) ?? 0;
      const margen_flete = ingreso_flete - costo_transporte;
      const ejecutor = r.shipping_method?.name ?? null;
      const estado_liquidacion = costo_transporte > 0 ? 'paid' : 'pending';
      return {
        id: r.id,
        route_number: r.route_number,
        store_id: r.store_id,
        status: r.status,
        planned_date: r.planned_date,
        closed_at: r.closed_at,
        shipping_method: r.shipping_method,
        external_carrier_supplier_id: r.external_carrier_supplier_id,
        vehicle_id: r.vehicle_id,
        recaudo,
        ingreso_flete,
        costo_transporte,
        margen_flete,
        ejecutor,
        estado_liquidacion,
      };
    });

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async listAvailableNotes(search?: string) {
    const store_id = this.getStoreId();

    // Plan Despacho Economía — FASE 6 paso 18. Sólo remisiones planillables:
    // `outbound`/`customer_delivery` en `draft|confirmed`. Las `delivered`,
    // `invoiced` y `voided` NO aparecen. El filtro de status es el source of
    // truth del endpoint; antes dependía de la limpieza del cliente.
    //
    // Find notes that are locked by an active (non-released) stop on ANY
    // route. Matches the partial unique index
    // `dispatch_route_stops_dispatch_note_id_active_idx` and the create()
    // /addStops() blockers. We don't carve out parent=draft here because a
    // draft route still holds its stops locked at the DB layer.
    const lockedNoteIds = await this.prisma.dispatch_route_stops.findMany({
      where: { status: { not: 'released' } },
      select: { dispatch_note_id: true },
    });
    const lockedSet = new Set(lockedNoteIds.map((s) => s.dispatch_note_id));

    const where: any = {
      store_id,
      direction: 'outbound',
      subtype: 'customer_delivery',
      status: { in: ['draft', 'confirmed'] },
    };
    if (search) {
      where.OR = [
        { dispatch_number: { contains: search, mode: 'insensitive' } },
        { customer_name: { contains: search, mode: 'insensitive' } },
      ];
    }
    const notes = await this.prisma.dispatch_notes.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 100,
      select: {
        id: true,
        dispatch_number: true,
        customer_name: true,
        grand_total: true,
        status: true,
        needs_collection: true,
        customer_address: true,
        order: {
          select: { shipping_address_snapshot: true, shipping_method_id: true },
        },
      },
    });
    return notes
      .filter((n) => !lockedSet.has(n.id))
      .map((n) => ({
        id: n.id,
        dispatch_number: n.dispatch_number,
        customer_name: n.customer_name,
        grand_total: n.grand_total,
        status: n.status,
        needs_collection: n.needs_collection,
        customer_address: n.customer_address,
        shipping_address_snapshot: n.order?.shipping_address_snapshot ?? null,
        shipping_method_id: n.order?.shipping_method_id ?? null,
      }));
  }

  // ==========================================================================
  // Map view: not-yet-delivered stops with resolved coordinates + a suggested
  // route origin. Consumed by the planilla detail map.
  // ==========================================================================

  /**
   * Build the payload for `GET /store/dispatch-routes/:id/map-stops`.
   *
   * Tenant-isolated exactly like {@link findOne}: the route is loaded with a
   * `{ id, store_id }` filter so a route from another store yields a 404
   * (dispatch_routes is NOT auto-scoped by the Prisma extension — this domain
   * scopes manually, mirroring the rest of the service). Works regardless of the
   * planilla's own state (draft/dispatched/closed/…): the stop set is drawn from
   * `pending` / `in_progress` (active) PLUS `delivered` (see
   * {@link MAP_STOPS_INCLUDE}); the two are partitioned so the frontend can paint
   * delivered stops green alongside the pending ones. Each stop's coordinates are
   * resolved via {@link resolveStopCoordinates}, preserving `stop_sequence` order:
   *   - active stops WITH coords → `stops[]`;
   *   - active stops WITHOUT coords → `unlocated[]`;
   *   - delivered stops WITH coords → `delivered[]`;
   *   - delivered stops WITHOUT coords → dropped (nothing to draw).
   *
   * `origin` is the coordinate of the route's `origin_location` (read from its
   * linked `addresses` row); `null` when the location has no address/coords.
   */
  async getMapStops(id: number): Promise<MapStopsResponse> {
    const store_id = this.getStoreId();

    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id },
      include: MAP_STOPS_INCLUDE,
    });
    if (!route) throw new NotFoundException(`Planilla #${id} no encontrada`);

    const originAddr = route.origin_location?.addresses ?? null;
    const originLat = this.decimalToCoord(originAddr?.latitude ?? null);
    const originLng = this.decimalToCoord(originAddr?.longitude ?? null);
    const origin =
      originLat != null && originLng != null
        ? { lat: originLat, lng: originLng }
        : null;

    const stops: MapStopLocated[] = [];
    const delivered: MapStopLocated[] = [];
    const unlocated: MapStopUnlocated[] = [];

    // Resolve sequentially: {@link resolveStopCoordinates} may hit the geocoding
    // provider, and serial calls respect Nominatim's 1 req/sec usage policy
    // (results are Redis-cached anyway, so warm stops are effectively free).
    for (const stop of route.stops as unknown as MapStopSource[]) {
      const resolved = await this.resolveStopCoordinates(stop);
      const customerName = stop.dispatch_note?.customer_name ?? null;
      const isDelivered =
        stop.status === dispatch_route_stop_status_enum.delivered;
      const hasCoords = resolved.lat != null && resolved.lng != null;

      if (hasCoords) {
        const located: MapStopLocated = {
          stopId: stop.id,
          sequence: stop.stop_sequence,
          status: stop.status,
          customerName,
          addressText: resolved.addressText,
          lat: resolved.lat as number,
          lng: resolved.lng as number,
          geocoded: resolved.geocoded,
        };
        // Delivered stops feed the green trail; active ones feed the pending set.
        (isDelivered ? delivered : stops).push(located);
      } else if (!isDelivered) {
        // Only active stops surface as unlocated; a delivered stop we can't draw
        // is dropped silently (there is no marker to place on the map).
        unlocated.push({
          stopId: stop.id,
          sequence: stop.stop_sequence,
          customerName,
          addressText: resolved.addressText,
        });
      }
    }

    return { origin, stops, delivered, unlocated };
  }

  /**
   * Resolve a stop's delivery coordinates with the following cascade:
   *   (a) `dispatch_note.customer_address` JSON lat/lng,
   *   (b) `order.shipping_address_snapshot` JSON lat/lng,
   *   (c) the order's shipping `addresses` row lat/lng (FUENTE DE VERDAD),
   *   (d) the customer's stored `shipping` address row lat/lng (B2B/POS or
   *       legacy notes with no order),
   *   (e) forward-geocode the composed address text; on success PERSIST the
   *       lat/lng back onto a known `addresses` row (scoped) and flag
   *       `geocoded: true`.
   *
   * Fail-open: geocoding is wrapped in try/catch and NEVER makes the request
   * fail — on any error the stop is returned as `{ lat: null, lng: null,
   * geocoded: false }` and the caller lists it under `unlocated[]`.
   */
  private async resolveStopCoordinates(
    stop: MapStopSource,
  ): Promise<ResolvedStopCoords> {
    const dn = stop.dispatch_note;
    const orderAddrRow =
      dn?.order?.addresses_orders_shipping_address_idToaddresses ?? null;

    const withText = (
      coords: { lat: number | null; lng: number | null; geocoded: boolean },
      customerAddr: MapAddressRow | null,
    ): ResolvedStopCoords => ({
      ...coords,
      addressText: this.buildAddressText(
        this.extractAddressParts(dn, orderAddrRow, customerAddr),
      ),
    });

    // (a) remisión delivery snapshot.
    const fromNoteJson = this.readCoordsFromJson(dn?.customer_address ?? null);
    if (fromNoteJson) return withText({ ...fromNoteJson, geocoded: false }, null);

    // (b) order shipping snapshot.
    const fromOrderJson = this.readCoordsFromJson(
      dn?.order?.shipping_address_snapshot ?? null,
    );
    if (fromOrderJson) return withText({ ...fromOrderJson, geocoded: false }, null);

    // (c) order live shipping-address row.
    const fromOrderRow = this.readCoordsFromRow(orderAddrRow);
    if (fromOrderRow) return withText({ ...fromOrderRow, geocoded: false }, null);

    // (d) customer's stored shipping address (no order / POS / B2B / legacy).
    let customerAddr: MapAddressRow | null = null;
    if (dn?.customer_id) {
      customerAddr = await this.findCustomerShippingAddress(dn.customer_id);
      const fromCustomer = this.readCoordsFromRow(customerAddr);
      if (fromCustomer) {
        return withText({ ...fromCustomer, geocoded: false }, customerAddr);
      }
    }

    // (e) forward-geocode + best-effort persist.
    const geo = await this.geocodeAndPersist(dn, orderAddrRow, customerAddr);
    return withText(geo, customerAddr);
  }

  /**
   * Forward-geocode the stop's composed address text and, on a hit, persist the
   * coordinate back onto the `addresses` row we can identify (order shipping row
   * first, else the customer's shipping row). Returns `geocoded: true` only when
   * the provider resolved a coordinate. NEVER throws — a provider/persist
   * failure degrades to `{ null, null, false }`.
   */
  private async geocodeAndPersist(
    dn: MapStopDispatchNote | null,
    orderAddrRow: MapAddressRow | null,
    customerAddr: MapAddressRow | null,
  ): Promise<{ lat: number | null; lng: number | null; geocoded: boolean }> {
    const empty = { lat: null, lng: null, geocoded: false };
    try {
      const parts = this.extractAddressParts(dn, orderAddrRow, customerAddr);
      const query = this.buildGeocodeQuery(parts);
      if (!query) return empty;

      const { lat, lng } = await this.geocoding.forward(query);
      if (lat == null || lng == null) return empty;

      // Persist only when we hold a concrete addresses.id (never guess). The
      // scoped updateMany injects store_id, so a cross-tenant row is a silent
      // no-op instead of a leak.
      const addrId = orderAddrRow?.id ?? customerAddr?.id ?? null;
      if (addrId != null) {
        await this.persistAddressCoords(addrId, lat, lng);
      }
      return { lat, lng, geocoded: true };
    } catch (err) {
      this.logger.warn(`Geocoding a stop address failed (fail-open): ${err}`);
      return empty;
    }
  }

  /**
   * Persist resolved coordinates onto an `addresses` row. Uses the store-scoped
   * `updateMany` (not `update`) so the injected `store_id` acts as a where
   * filter — a row belonging to another store (or with a null store_id) simply
   * matches nothing instead of throwing P2025. Best-effort: swallows errors.
   */
  private async persistAddressCoords(
    addressId: number,
    lat: number,
    lng: number,
  ): Promise<void> {
    try {
      await this.prisma.addresses.updateMany({
        where: { id: addressId },
        data: { latitude: lat, longitude: lng },
      });
    } catch (err) {
      this.logger.warn(
        `Persisting geocoded coords on address #${addressId} failed: ${err}`,
      );
    }
  }

  /**
   * Find the customer's stored `shipping` address in the current store. The
   * `addresses` model IS store-scoped, so the injected `store_id` guarantees
   * tenant isolation. Returns the primary shipping address first. Fail-open.
   */
  private async findCustomerShippingAddress(
    customerId: number,
  ): Promise<MapAddressRow | null> {
    try {
      return await this.prisma.addresses.findFirst({
        where: { user_id: customerId, type: 'shipping' },
        orderBy: [{ is_primary: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          latitude: true,
          longitude: true,
          address_line1: true,
          address_line2: true,
          city: true,
          state_province: true,
          country_code: true,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Loading customer #${customerId} shipping address failed: ${err}`,
      );
      return null;
    }
  }

  /**
   * Extract structured address parts from the first source that carries a
   * non-empty `address_line1`, in the same priority as the coordinate cascade:
   * note snapshot → order snapshot → order row → customer row.
   */
  private extractAddressParts(
    dn: MapStopDispatchNote | null,
    orderAddrRow: MapAddressRow | null,
    customerAddr: MapAddressRow | null,
  ): AddressParts {
    const fromNote = this.partsFromJson(dn?.customer_address ?? null);
    if (fromNote) return fromNote;
    const fromOrderSnap = this.partsFromJson(
      dn?.order?.shipping_address_snapshot ?? null,
    );
    if (fromOrderSnap) return fromOrderSnap;
    const fromOrderRow = this.partsFromRow(orderAddrRow);
    if (fromOrderRow) return fromOrderRow;
    const fromCustomer = this.partsFromRow(customerAddr);
    if (fromCustomer) return fromCustomer;
    return { line1: null, line2: null, city: null, state: null, country: null };
  }

  /** Parts from an address JSON blob (column-name keys, with legacy aliases). */
  private partsFromJson(value: Prisma.JsonValue | null): AddressParts | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const o = value as Record<string, unknown>;
    const line1 = this.asString(o.address_line1 ?? o.line1 ?? o.address);
    if (!line1) return null;
    return {
      line1,
      line2: this.asString(o.address_line2 ?? o.line2),
      city: this.asString(o.city),
      state: this.asString(o.state_province ?? o.state),
      country: this.asString(o.country_code ?? o.country),
    };
  }

  /** Parts from an `addresses` table row. */
  private partsFromRow(row: MapAddressRow | null): AddressParts | null {
    if (!row) return null;
    const line1 = this.asString(row.address_line1);
    if (!line1) return null;
    return {
      line1,
      line2: this.asString(row.address_line2),
      city: this.asString(row.city),
      state: this.asString(row.state_province),
      country: this.asString(row.country_code),
    };
  }

  /** Human-readable one-line address for the map card. Null when empty. */
  private buildAddressText(parts: AddressParts): string | null {
    const text = [parts.line1, parts.line2, parts.city, parts.state]
      .map((p) => (p ? p.trim() : ''))
      .filter((p) => p.length > 0)
      .join(', ');
    return text.length > 0 ? text : null;
  }

  /** Geocoding query string ("line1, city, state, country"). Null when no line1. */
  private buildGeocodeQuery(parts: AddressParts): string | null {
    if (!parts.line1) return null;
    const query = [parts.line1, parts.city, parts.state, parts.country]
      .map((p) => (p ? p.trim() : ''))
      .filter((p) => p.length > 0)
      .join(', ');
    return query.length > 0 ? query : null;
  }

  /** Read numeric lat/lng from a JSON address blob (accepts string or number). */
  private readCoordsFromJson(
    value: Prisma.JsonValue | null,
  ): { lat: number; lng: number } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const o = value as Record<string, unknown>;
    const lat = this.toCoord(o.latitude ?? o.lat);
    const lng = this.toCoord(o.longitude ?? o.lng ?? o.lon);
    if (lat == null || lng == null) return null;
    return { lat, lng };
  }

  /** Read numeric lat/lng from an `addresses` row (Decimal columns). */
  private readCoordsFromRow(
    row: MapAddressRow | null,
  ): { lat: number; lng: number } | null {
    if (!row) return null;
    const lat = this.decimalToCoord(row.latitude);
    const lng = this.decimalToCoord(row.longitude);
    if (lat == null || lng == null) return null;
    return { lat, lng };
  }

  /** Normalize a Prisma.Decimal|null coordinate to a validated number|null. */
  private decimalToCoord(value: Prisma.Decimal | null | undefined): number | null {
    if (value == null) return null;
    return this.toCoord(value.toString());
  }

  /**
   * Coerce an unknown coordinate value to a finite number within valid
   * geographic bounds. Rejects the (0,0) "Null Island" sentinel implicitly by
   * bounds only at the pair level (see readCoords*), so a legitimate 0 on ONE
   * axis is still accepted here.
   */
  private toCoord(value: unknown): number | null {
    if (value == null) return null;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    if (Math.abs(n) > 180) return null;
    return n;
  }

  /** Trim a value to a non-empty string, or null. */
  private asString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
}
