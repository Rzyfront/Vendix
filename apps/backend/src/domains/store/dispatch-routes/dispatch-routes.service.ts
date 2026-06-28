import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma, dispatch_route_status_enum } from '@prisma/client';
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

@Injectable()
export class DispatchRoutesService {
  private readonly logger = new Logger(DispatchRoutesService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly routeNumberGenerator: RouteNumberGenerator,
  ) {}

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
        status: true,
        sales_order_id: true,
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

        const created = await this.prisma.dispatch_routes.create({
          data: {
            store_id,
            route_number,
            route_code: dto.route_code,
            status: 'draft',
            vehicle_id: dto.vehicle_id,
            driver_user_id: dto.driver_user_id,
            external_driver_name: dto.external_driver_name,
            external_driver_id_number: dto.external_driver_id_number,
            is_primary_driver_external: dto.is_primary_driver_external ?? false,
            assistants: dto.assistants as any,
            origin_location_id: dto.origin_location_id,
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
        status: true,
        sales_order_id: true,
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

    return this.prisma.$transaction(async (tx) => {
      await tx.dispatch_route_stops.createMany({
        data: new_stops_data.map((s) => ({ ...s, route_id: id })),
      });
      return tx.dispatch_routes.update({
        where: { id },
        data: {
          total_to_collect,
          total_prepaid,
          updated_at: new Date(),
        },
        include: DISPATCH_ROUTE_INCLUDE,
      });
    });
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
        where: { store_id, status: { in: ['closed', 'in_transit', 'settling'] } },
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
  async listAvailableNotes(search?: string) {
    const store_id = this.getStoreId();

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
      status: { not: 'voided' },
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
        order: { select: { shipping_address_snapshot: true } },
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
      }));
  }
}
