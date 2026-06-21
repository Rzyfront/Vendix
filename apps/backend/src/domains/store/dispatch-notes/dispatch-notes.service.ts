import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateDispatchNoteDto,
  UpdateDispatchNoteDto,
  DispatchNoteQueryDto,
  CreateFromSalesOrderDto,
  CreateFromOrderDto,
} from './dto';
import {
  dispatch_note_status_enum,
  dispatch_route_status_enum,
  Prisma,
} from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DispatchNumberGenerator } from './utils/dispatch-number-generator';
import { RouteNumberGenerator } from '../dispatch-routes/utils/route-number-generator';
import {
  buildStopsData,
  computeRouteTotals,
  RouteStopNoteInput,
  RouteStopSequenceInput,
} from '../dispatch-routes/utils/route-stop-calc';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

const DISPATCH_NOTE_INCLUDE = {
  dispatch_note_items: {
    include: {
      product: true,
      product_variant: true,
      location: true,
    },
  },
  customer: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
      phone: true,
    },
  },
  sales_order: {
    select: {
      id: true,
      order_number: true,
      status: true,
    },
  },
  order: {
    select: {
      id: true,
      order_number: true,
      state: true,
    },
  },
  invoice: {
    select: {
      id: true,
      invoice_number: true,
      status: true,
    },
  },
  dispatch_location: {
    select: {
      id: true,
      name: true,
      code: true,
    },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  confirmed_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  delivered_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  voided_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  // Reverse relation so the UI can show "asignada a planilla #N" on
  // the dispatch note detail / list. Includes the full history (released
  // stops from prior routes) plus the parent route summary.
  dispatch_route_stops: {
    orderBy: { id: 'desc' as const },
    select: {
      id: true,
      route_id: true,
      stop_sequence: true,
      status: true,
      result: true,
      route: {
        select: {
          id: true,
          route_number: true,
          route_code: true,
          status: true,
        },
      },
    },
  },
};

@Injectable()
export class DispatchNotesService {
  private readonly logger = new Logger(DispatchNotesService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly dispatchNumberGenerator: DispatchNumberGenerator,
    private readonly routeNumberGenerator: RouteNumberGenerator,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(dto: CreateDispatchNoteDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    // Denormalize customer data
    const customer = await this.prisma.users.findUnique({
      where: { id: dto.customer_id },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        document_number: true,
      },
    });

    if (!customer) {
      throw new VendixHttpException(ErrorCodes.CUST_FIND_001);
    }

    const customer_name =
      `${customer.first_name || ''} ${customer.last_name || ''}`.trim();

    // Calculate totals from items
    const items: any[] = dto.items || [];
    const subtotal = items.reduce(
      (sum, item) =>
        sum + Number(item.unit_price || 0) * item.dispatched_quantity,
      0,
    );
    const total_discount = items.reduce(
      (sum, item) => sum + Number(item.discount_amount || 0),
      0,
    );
    const total_tax = items.reduce(
      (sum, item) => sum + Number(item.tax_amount || 0),
      0,
    );
    const grand_total = subtotal - total_discount + total_tax;

    let retries = 3;
    while (retries > 0) {
      try {
        const dispatch_number =
          await this.dispatchNumberGenerator.generateNextNumber(store_id);

        const dispatch_note = await this.prisma.dispatch_notes.create({
          data: {
            store_id,
            dispatch_number,
            status: dispatch_note_status_enum.draft,
            customer_id: dto.customer_id,
            customer_name,
            customer_tax_id: customer.document_number || null,
            sales_order_id: dto.sales_order_id,
            dispatch_location_id: dto.dispatch_location_id,
            emission_date: dto.emission_date
              ? new Date(dto.emission_date)
              : new Date(),
            agreed_delivery_date: dto.agreed_delivery_date
              ? new Date(dto.agreed_delivery_date)
              : null,
            subtotal_amount: subtotal,
            discount_amount: total_discount,
            tax_amount: total_tax,
            grand_total,
            currency: dto.currency || 'COP',
            notes: dto.notes,
            internal_notes: dto.internal_notes,
            created_by_user_id: context?.user_id,
            updated_at: new Date(),
            dispatch_note_items: {
              create: items.map((item) => ({
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                location_id: item.location_id,
                ordered_quantity: item.ordered_quantity,
                dispatched_quantity: item.dispatched_quantity,
                unit_price: item.unit_price,
                discount_amount: item.discount_amount || 0,
                tax_amount: item.tax_amount || 0,
                total_price:
                  Number(item.unit_price || 0) * item.dispatched_quantity -
                  Number(item.discount_amount || 0) +
                  Number(item.tax_amount || 0),
                lot_serial: item.lot_serial,
                sales_order_item_id: item.sales_order_item_id,
              })),
            },
          },
          include: DISPATCH_NOTE_INCLUDE,
        });

        return dispatch_note;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = error.meta?.target as string[];
          if (Array.isArray(target) && target.includes('dispatch_number')) {
            retries--;
            if (retries === 0) {
              throw new ConflictException(
                'No se pudo generar un número de remisión único después de varios intentos',
              );
            }
            continue;
          }
        }
        throw error;
      }
    }
  }

  async createFromSalesOrder(
    sales_order_id: number,
    dto: CreateFromSalesOrderDto,
  ) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    // Fetch the sales order with items
    const sales_order = await this.prisma.sales_orders.findFirst({
      where: { id: sales_order_id },
      include: {
        sales_order_items: {
          include: {
            product: { select: { id: true, name: true } },
            product_variant: { select: { id: true, sku: true } },
          },
        },
        customer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            document_number: true,
          },
        },
      },
    });

    if (!sales_order) {
      throw new NotFoundException('Orden de venta no encontrada');
    }

    const customer_name =
      `${sales_order.customer?.first_name || ''} ${sales_order.customer?.last_name || ''}`.trim();

    // Build items from sales order items
    const items_map = new Map(dto.items.map((i) => [i.sales_order_item_id, i]));

    const dispatch_items: any[] = [];
    for (const dto_item of dto.items) {
      const so_item = sales_order.sales_order_items.find(
        (si: any) => si.id === dto_item.sales_order_item_id,
      );

      if (!so_item) {
        throw new BadRequestException(
          `Item de orden de venta #${dto_item.sales_order_item_id} no encontrado`,
        );
      }

      dispatch_items.push({
        product_id: so_item.product_id,
        product_variant_id: so_item.product_variant_id,
        location_id: dto_item.location_id,
        ordered_quantity: so_item.quantity,
        dispatched_quantity: dto_item.dispatched_quantity,
        unit_price: so_item.unit_price,
        discount_amount: so_item.discount_amount || 0,
        tax_amount: so_item.tax_amount || 0,
        total_price:
          Number(so_item.unit_price || 0) * dto_item.dispatched_quantity -
          Number(so_item.discount_amount || 0) +
          Number(so_item.tax_amount || 0),
        lot_serial: dto_item.lot_serial,
        sales_order_item_id: dto_item.sales_order_item_id,
      });
    }

    const subtotal = dispatch_items.reduce(
      (sum, item) =>
        sum + Number(item.unit_price || 0) * item.dispatched_quantity,
      0,
    );
    const total_discount = dispatch_items.reduce(
      (sum, item) => sum + Number(item.discount_amount || 0),
      0,
    );
    const total_tax = dispatch_items.reduce(
      (sum, item) => sum + Number(item.tax_amount || 0),
      0,
    );
    const grand_total = subtotal - total_discount + total_tax;

    const dispatch_number =
      await this.dispatchNumberGenerator.generateNextNumber(store_id);

    const dispatch_note = await this.prisma.dispatch_notes.create({
      data: {
        store_id,
        dispatch_number,
        status: dispatch_note_status_enum.draft,
        customer_id: sales_order.customer_id,
        customer_name,
        customer_tax_id: sales_order.customer?.document_number || null,
        sales_order_id,
        dispatch_location_id: dto.dispatch_location_id,
        emission_date: new Date(),
        agreed_delivery_date: dto.agreed_delivery_date
          ? new Date(dto.agreed_delivery_date)
          : null,
        subtotal_amount: subtotal,
        discount_amount: total_discount,
        tax_amount: total_tax,
        grand_total,
        currency: sales_order.currency || 'COP',
        notes: dto.notes,
        created_by_user_id: context?.user_id,
        updated_at: new Date(),
        dispatch_note_items: {
          create: dispatch_items,
        },
      },
      include: DISPATCH_NOTE_INCLUDE,
    });

    return dispatch_note;
  }

  /**
   * Create a dispatch note (remisión) straight from an order, optionally
   * confirming it and/or attaching it to a route — all in ONE atomic
   * transaction. This is the "atajo de despacho COD" shortcut: a single call
   * can create the remisión, leave it confirmed, and either drop it on an
   * existing hot route or spin up a brand-new route with driver/vehicle/
   * assistants and the remisión as its first stop.
   *
   * Atomicity: the remisión and the route/stop writes share one `$transaction`,
   * so a failure on the route side rolls back the remisión too. Side effects
   * that must run AFTER the data is durable (the `dispatch_note.confirmed`
   * event that reserves stock) are emitted post-commit.
   */
  async createFromOrder(order_id: number, dto: CreateFromOrderDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const user_id = context?.user_id;

    // Resolve and validate the target status up front so we fail fast with the
    // correct code before touching the DB.
    const target_status: 'draft' | 'confirmed' = dto.target_status ?? 'draft';
    if (target_status !== 'draft' && target_status !== 'confirmed') {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_TARGET_STATUS_001);
    }

    // Validate the route_assignment shape (DTO already guards required fields
    // per mode, but we re-assert here to throw the domain code, not a 422).
    const assignment_mode = dto.route_assignment?.mode ?? 'none';
    if (assignment_mode === 'existing' && !dto.route_assignment?.route_id) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_ASSIGN_001);
    }
    if (assignment_mode === 'new' && !dto.route_assignment?.new_route) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_ASSIGN_001);
    }

    // Fetch the order with items (store-scoped via StorePrismaService).
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      include: {
        order_items: true,
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            document_number: true,
          },
        },
      },
    });

    if (!order) {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_FIND_001);
    }

    // A dispatch note (remisión) only makes sense for orders that are being
    // fulfilled. `processing` is the canonical state (stock reserved, goods
    // ready to leave). `pending_payment` is admitted for the COD shortcut: the
    // courier collects on delivery, so the order may not be paid yet.
    if (order.state !== 'processing' && order.state !== 'pending_payment') {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_STATE_001);
    }

    // Direct-delivery orders hand the goods over immediately at the counter;
    // they do not go through the remisión + recaudo cycle.
    if (order.delivery_type === 'direct_delivery') {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_DELIVERY_001);
    }

    const customer_name =
      `${order.users?.first_name || ''} ${order.users?.last_name || ''}`.trim();

    // Build items from order items
    const dispatch_items: any[] = [];
    for (const dto_item of dto.items) {
      const order_item = order.order_items.find(
        (oi: any) => oi.id === dto_item.order_item_id,
      );

      if (!order_item) {
        throw new VendixHttpException(ErrorCodes.DSP_ORDER_ITEM_001);
      }

      dispatch_items.push({
        product_id: order_item.product_id,
        product_variant_id: order_item.product_variant_id,
        location_id: dto_item.location_id,
        ordered_quantity: order_item.quantity,
        dispatched_quantity: dto_item.dispatched_quantity,
        unit_price: order_item.unit_price,
        discount_amount: 0,
        tax_amount: order_item.tax_amount_item || 0,
        total_price:
          Number(order_item.unit_price || 0) * dto_item.dispatched_quantity +
          Number(order_item.tax_amount_item || 0),
        lot_serial: dto_item.lot_serial,
      });
    }

    const subtotal = dispatch_items.reduce(
      (sum, item) =>
        sum + Number(item.unit_price || 0) * item.dispatched_quantity,
      0,
    );
    const total_discount = dispatch_items.reduce(
      (sum, item) => sum + Number(item.discount_amount || 0),
      0,
    );
    const total_tax = dispatch_items.reduce(
      (sum, item) => sum + Number(item.tax_amount || 0),
      0,
    );
    const grand_total = subtotal - total_discount + total_tax;

    // Pending balance on the order means the courier must collect on delivery.
    const needs_collection = Number(order.remaining_balance) > 0;

    // When target_status === 'confirmed' we create the note already in the
    // `confirmed` state (the valid draft -> confirmed transition) and stamp the
    // confirmation audit fields, so the result mirrors what the flow service
    // would produce — without a second round-trip outside the transaction.
    const is_confirmed = target_status === 'confirmed';

    // Everything below is one all-or-nothing transaction.
    const dispatch_note = await this.prisma.$transaction(async (tx) => {
      const dispatch_number =
        await this.dispatchNumberGenerator.generateNextNumber(store_id);

      const created_note = await tx.dispatch_notes.create({
        data: {
          store_id,
          dispatch_number,
          status: is_confirmed
            ? dispatch_note_status_enum.confirmed
            : dispatch_note_status_enum.draft,
          customer_id: order.customer_id,
          customer_name,
          customer_tax_id: order.users?.document_number || null,
          order_id,
          needs_collection,
          dispatch_location_id: dto.dispatch_location_id,
          emission_date: new Date(),
          agreed_delivery_date: dto.agreed_delivery_date
            ? new Date(dto.agreed_delivery_date)
            : null,
          subtotal_amount: subtotal,
          discount_amount: total_discount,
          tax_amount: total_tax,
          grand_total,
          currency: order.currency || 'COP',
          notes: dto.notes,
          created_by_user_id: user_id,
          ...(is_confirmed && {
            confirmed_by_user_id: user_id,
            confirmed_at: new Date(),
          }),
          updated_at: new Date(),
          dispatch_note_items: {
            create: dispatch_items,
          },
        },
        include: DISPATCH_NOTE_INCLUDE,
      });

      // ── Route assignment (optional) ──────────────────────────────────────
      if (assignment_mode === 'existing') {
        await this.attachToExistingRoute(
          tx,
          store_id,
          dto.route_assignment!.route_id!,
          created_note.id,
        );
      } else if (assignment_mode === 'new') {
        await this.createRouteWithFirstStop(
          tx,
          store_id,
          user_id,
          dto.route_assignment!.new_route!,
          created_note.id,
        );
      }

      return created_note;
    });

    // POST-COMMIT side effects. The confirmed event triggers the stock
    // listener; its double-stock guard keys off `order_id`, so order-linked
    // notes (like this one) do NOT re-reserve stock.
    if (is_confirmed) {
      this.eventEmitter.emit('dispatch_note.confirmed', {
        dispatch_note_id: dispatch_note.id,
        dispatch_number: dispatch_note.dispatch_number,
        store_id: dispatch_note.store_id,
        sales_order_id: dispatch_note.sales_order_id,
        order_id: dispatch_note.order_id,
      });
    }

    return dispatch_note;
  }

  /**
   * Normalize a Prisma dispatch-note row into the pure calculator input shape.
   * `grand_total` is a Prisma `Decimal`; the calculators expect
   * number/string/null, so we coerce it to a number here.
   */
  private toRouteStopNoteInput(row: {
    id: number;
    grand_total: Prisma.Decimal | number | string | null;
    needs_collection: boolean | null;
    invoice?: { payment_date: Date | null } | null;
  }): RouteStopNoteInput {
    return {
      id: row.id,
      grand_total: row.grand_total == null ? null : Number(row.grand_total),
      needs_collection: row.needs_collection,
      invoice: row.invoice ?? null,
    };
  }

  /**
   * Attach a freshly created dispatch note as a new stop on an EXISTING route,
   * inside the caller's transaction. Validates the route is store-scoped and in
   * an editable state, that the note is not already on a route, appends the
   * stop at `max(stop_sequence) + 1`, and recomputes the route totals over the
   * complete set of stops using the pure route-stop calculators.
   */
  private async attachToExistingRoute(
    tx: Prisma.TransactionClient,
    store_id: number,
    route_id: number,
    dispatch_note_id: number,
  ): Promise<void> {
    // dispatch_routes is NOT auto-scoped by StorePrismaService, so we filter
    // store_id explicitly (mirrors DispatchRoutesService.findOne).
    const route = await tx.dispatch_routes.findFirst({
      where: { id: route_id, store_id },
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
    if (!route) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_NOT_EDITABLE_001);
    }

    // State gate: only "hot" routes (draft / dispatched) accept new stops.
    const EDITABLE_STATES: dispatch_route_status_enum[] = [
      'draft',
      'dispatched',
    ];
    if (!EDITABLE_STATES.includes(route.status)) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_NOT_EDITABLE_001);
    }

    // The note was just created so it cannot be on a route yet, but the global
    // unique on dispatch_note_id makes this explicit and future-proof.
    const already_on_route = await tx.dispatch_route_stops.findFirst({
      where: { dispatch_note_id },
      select: { id: true },
    });
    if (already_on_route) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_STOP_CONFLICT_001);
    }

    // Load the new note with the SAME select shape the calculators expect.
    const new_note = await tx.dispatch_notes.findFirst({
      where: { id: dispatch_note_id, store_id },
      select: {
        id: true,
        grand_total: true,
        needs_collection: true,
        invoice: { select: { payment_date: true } },
      },
    });
    if (!new_note) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_STOP_CONFLICT_001);
    }

    const next_sequence =
      route.stops.reduce((max, s) => Math.max(max, s.stop_sequence ?? 0), 0) + 1;

    const new_stop_input: RouteStopSequenceInput = {
      dispatch_note_id,
      stop_sequence: next_sequence,
    };
    const new_note_input = this.toRouteStopNoteInput(new_note);
    const new_notes_by_id: ReadonlyMap<number, RouteStopNoteInput> = new Map([
      [new_note_input.id, new_note_input],
    ]);
    const [new_stop_data] = buildStopsData([new_stop_input], new_notes_by_id);

    // Recompute totals over the COMPLETE set (existing + new).
    const existing_note_ids = route.stops.map((s) => s.dispatch_note_id);
    const existing_notes_full = await tx.dispatch_notes.findMany({
      where: { id: { in: existing_note_ids }, store_id },
      select: { id: true, grand_total: true, needs_collection: true },
    });
    const all_notes_by_id = new Map<number, RouteStopNoteInput>([
      [new_note_input.id, new_note_input],
    ]);
    for (const n of existing_notes_full)
      all_notes_by_id.set(n.id, this.toRouteStopNoteInput(n));

    const all_stops_data = [
      ...route.stops.map((s) => ({
        dispatch_note_id: s.dispatch_note_id,
        stop_sequence: s.stop_sequence,
        is_extra_route: false,
        is_prepaid: s.is_prepaid,
        collected_amount: 0,
        anticipo_amount: 0,
        change_amount: 0,
        withholding_amount: 0,
        credit_amount: 0,
        notes: null,
      })),
      new_stop_data,
    ];
    const { total_to_collect, total_prepaid } = computeRouteTotals(
      all_stops_data,
      all_notes_by_id,
    );

    await tx.dispatch_route_stops.create({
      data: { ...new_stop_data, route_id },
    });
    await tx.dispatch_routes.update({
      where: { id: route_id },
      data: { total_to_collect, total_prepaid, updated_at: new Date() },
    });
  }

  /**
   * Create a brand-new route (planilla) inside the caller's transaction, with
   * the freshly created dispatch note as its FIRST stop. Mirrors
   * DispatchRoutesService.create(): generates the route number with the shared
   * generator (retrying on the unique collision), maps `assistant_ids` to the
   * JSON `assistants` shape, and computes totals via the pure calculators.
   */
  private async createRouteWithFirstStop(
    tx: Prisma.TransactionClient,
    store_id: number,
    user_id: number | undefined,
    new_route: NonNullable<CreateFromOrderDto['route_assignment']>['new_route'],
    dispatch_note_id: number,
  ): Promise<void> {
    if (!new_route) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_ASSIGN_001);
    }

    // Validate vehicle belongs to the store, when provided.
    if (new_route.vehicle_id) {
      const vehicle = await tx.vehicles.findFirst({
        where: { id: new_route.vehicle_id, store_id },
        select: { id: true },
      });
      if (!vehicle) {
        throw new VendixHttpException(ErrorCodes.DSP_ROUTE_ASSIGN_001);
      }
    }

    // Map the flat assistant_ids into the JSON `assistants` shape the table
    // stores ({ user_id }[]), matching DispatchRoutesService.create().
    const assistants = (new_route.assistant_ids ?? []).map((id) => ({
      user_id: id,
    }));

    // Load the note for prepaid/total resolution (calculator input shape).
    const note = await tx.dispatch_notes.findFirst({
      where: { id: dispatch_note_id, store_id },
      select: {
        id: true,
        grand_total: true,
        needs_collection: true,
        invoice: { select: { payment_date: true } },
      },
    });
    if (!note) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_STOP_CONFLICT_001);
    }

    const note_input = this.toRouteStopNoteInput(note);
    const notes_by_id: ReadonlyMap<number, RouteStopNoteInput> = new Map([
      [note_input.id, note_input],
    ]);
    const stops_data = buildStopsData(
      [{ dispatch_note_id, stop_sequence: 1 }],
      notes_by_id,
    );
    const { total_to_collect, total_prepaid } = computeRouteTotals(
      stops_data,
      notes_by_id,
    );

    let attempts = 0;
    while (true) {
      try {
        const route_number =
          await this.routeNumberGenerator.generateNextNumber(store_id);
        await tx.dispatch_routes.create({
          data: {
            store_id,
            route_number,
            route_code: new_route.route_code,
            status: 'draft',
            vehicle_id: new_route.vehicle_id,
            driver_user_id: new_route.driver_user_id,
            external_driver_name: new_route.external_driver_name,
            external_driver_id_number: new_route.external_driver_id_number,
            is_primary_driver_external:
              new_route.is_primary_driver_external ?? false,
            assistants: assistants as Prisma.InputJsonValue,
            origin_location_id: new_route.origin_location_id,
            planned_date: new Date(new_route.planned_date),
            currency: new_route.currency || 'COP',
            notes: new_route.notes,
            total_to_collect,
            total_prepaid,
            created_by_user_id: user_id,
            updated_at: new Date(),
            stops: {
              create: stops_data,
            },
          },
        });
        return;
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

  async findAll(query: DispatchNoteQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      customer_id,
      sales_order_id,
      date_from,
      date_to,
      sort_by,
      sort_order,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.dispatch_notesWhereInput = {
      ...(search && {
        OR: [
          { dispatch_number: { contains: search, mode: 'insensitive' as any } },
          { customer_name: { contains: search, mode: 'insensitive' as any } },
        ],
      }),
      ...(status && { status }),
      ...(customer_id && { customer_id }),
      ...(sales_order_id && { sales_order_id }),
      ...(date_from &&
        date_to && {
          created_at: {
            gte: new Date(date_from),
            lte: new Date(date_to),
          },
        }),
    };

    const orderBy: any = {};
    if (sort_by) {
      orderBy[sort_by] = sort_order === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.created_at = 'desc';
    }

    const [data, total] = await Promise.all([
      this.prisma.dispatch_notes.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          dispatch_note_items: {
            select: {
              id: true,
              product_id: true,
              dispatched_quantity: true,
            },
          },
          customer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          // Reverse relation so the list view can show which planilla
          // the remisión is currently assigned to (or '—' if unassigned).
          dispatch_route_stops: {
            orderBy: { id: 'desc' as const },
            select: {
              id: true,
              route_id: true,
              stop_sequence: true,
              status: true,
              result: true,
              route: {
                select: {
                  id: true,
                  route_number: true,
                  route_code: true,
                  status: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.dispatch_notes.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const dispatch_note = await this.prisma.dispatch_notes.findFirst({
      where: { id },
      include: DISPATCH_NOTE_INCLUDE,
    });

    if (!dispatch_note) {
      throw new NotFoundException('Remisión no encontrada');
    }

    return dispatch_note;
  }

  async update(id: number, dto: UpdateDispatchNoteDto) {
    const dispatch_note = await this.findOne(id);

    if (dispatch_note.status !== dispatch_note_status_enum.draft) {
      throw new BadRequestException(
        'Solo se pueden editar remisiones en estado borrador',
      );
    }

    // If items are provided, delete and recreate
    if (dto.items) {
      return this.prisma.$transaction(async (tx) => {
        await tx.dispatch_note_items.deleteMany({
          where: { dispatch_note_id: id },
        });

        const items = dto.items!;
        const subtotal = items.reduce(
          (sum, item) =>
            sum + Number(item.unit_price || 0) * item.dispatched_quantity,
          0,
        );
        const total_discount = items.reduce(
          (sum, item) => sum + Number(item.discount_amount || 0),
          0,
        );
        const total_tax = items.reduce(
          (sum, item) => sum + Number(item.tax_amount || 0),
          0,
        );
        const grand_total = subtotal - total_discount + total_tax;

        // Denormalize customer if changed
        let customer_data: any = {};
        if (dto.customer_id && dto.customer_id !== dispatch_note.customer_id) {
          const customer = await tx.users.findUnique({
            where: { id: dto.customer_id },
            select: {
              first_name: true,
              last_name: true,
              document_number: true,
            },
          });
          if (customer) {
            customer_data = {
              customer_name:
                `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
              customer_tax_id: customer.document_number || null,
            };
          }
        }

        return tx.dispatch_notes.update({
          where: { id },
          data: {
            customer_id: dto.customer_id ?? dispatch_note.customer_id,
            sales_order_id: dto.sales_order_id ?? dispatch_note.sales_order_id,
            dispatch_location_id:
              dto.dispatch_location_id ?? dispatch_note.dispatch_location_id,
            emission_date: dto.emission_date
              ? new Date(dto.emission_date)
              : dispatch_note.emission_date,
            agreed_delivery_date: dto.agreed_delivery_date
              ? new Date(dto.agreed_delivery_date)
              : dispatch_note.agreed_delivery_date,
            notes: dto.notes ?? dispatch_note.notes,
            internal_notes: dto.internal_notes ?? dispatch_note.internal_notes,
            currency: dto.currency ?? dispatch_note.currency,
            subtotal_amount: subtotal,
            discount_amount: total_discount,
            tax_amount: total_tax,
            grand_total,
            ...customer_data,
            updated_at: new Date(),
            dispatch_note_items: {
              create: items.map((item) => ({
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                location_id: item.location_id,
                ordered_quantity: item.ordered_quantity,
                dispatched_quantity: item.dispatched_quantity,
                unit_price: item.unit_price,
                discount_amount: item.discount_amount || 0,
                tax_amount: item.tax_amount || 0,
                total_price:
                  Number(item.unit_price || 0) * item.dispatched_quantity -
                  Number(item.discount_amount || 0) +
                  Number(item.tax_amount || 0),
                lot_serial: item.lot_serial,
                sales_order_item_id: item.sales_order_item_id,
              })),
            },
          },
          include: DISPATCH_NOTE_INCLUDE,
        });
      });
    }

    // Update without items
    const { items: _items, ...update_data } = dto as any;

    // Denormalize customer if changed
    let customer_data: any = {};
    if (dto.customer_id && dto.customer_id !== dispatch_note.customer_id) {
      const customer = await this.prisma.users.findUnique({
        where: { id: dto.customer_id },
        select: { first_name: true, last_name: true, document_number: true },
      });
      if (customer) {
        customer_data = {
          customer_name:
            `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
          customer_tax_id: customer.document_number || null,
        };
      }
    }

    return this.prisma.dispatch_notes.update({
      where: { id },
      data: {
        ...update_data,
        ...customer_data,
        emission_date: update_data.emission_date
          ? new Date(update_data.emission_date)
          : undefined,
        agreed_delivery_date: update_data.agreed_delivery_date
          ? new Date(update_data.agreed_delivery_date)
          : undefined,
        updated_at: new Date(),
      },
      include: DISPATCH_NOTE_INCLUDE,
    });
  }

  async remove(id: number) {
    const dispatch_note = await this.findOne(id);

    if (dispatch_note.status !== dispatch_note_status_enum.draft) {
      throw new BadRequestException(
        'Solo se pueden eliminar remisiones en estado borrador',
      );
    }

    return this.prisma.dispatch_notes.delete({ where: { id } });
  }

  async getStats() {
    const [total, draft, confirmed, delivered, invoiced, voided, total_value] =
      await Promise.all([
        this.prisma.dispatch_notes.count(),
        this.prisma.dispatch_notes.count({ where: { status: 'draft' } }),
        this.prisma.dispatch_notes.count({ where: { status: 'confirmed' } }),
        this.prisma.dispatch_notes.count({ where: { status: 'delivered' } }),
        this.prisma.dispatch_notes.count({ where: { status: 'invoiced' } }),
        this.prisma.dispatch_notes.count({ where: { status: 'voided' } }),
        this.prisma.dispatch_notes.aggregate({
          _sum: { grand_total: true },
          where: { status: { not: 'voided' } },
        }),
      ]);

    const pending_invoicing = delivered;
    const average_value =
      total > 0 ? Number(total_value._sum.grand_total || 0) / total : 0;

    return {
      total,
      draft,
      confirmed,
      delivered,
      invoiced,
      voided,
      pending_invoicing,
      average_value: Math.round(average_value * 100) / 100,
    };
  }

  async getBySalesOrder(sales_order_id: number) {
    const dispatch_notes = await this.prisma.dispatch_notes.findMany({
      where: { sales_order_id },
      orderBy: { created_at: 'desc' },
      include: {
        dispatch_note_items: {
          select: {
            id: true,
            product_id: true,
            dispatched_quantity: true,
            sales_order_item_id: true,
          },
        },
      },
    });

    return dispatch_notes;
  }

  async getByOrder(order_id: number) {
    const dispatch_notes = await this.prisma.dispatch_notes.findMany({
      where: { order_id },
      orderBy: { created_at: 'desc' },
      include: {
        dispatch_note_items: {
          select: {
            id: true,
            product_id: true,
            dispatched_quantity: true,
          },
        },
      },
    });

    return dispatch_notes;
  }

  async getPendingInvoicing(query: DispatchNoteQueryDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    const where: any = {
      store_id,
      status: 'delivered',
    };

    if (query.customer_id) where.customer_id = Number(query.customer_id);
    if (query.date_from)
      where.emission_date = {
        ...(where.emission_date || {}),
        gte: new Date(query.date_from),
      };
    if (query.date_to)
      where.emission_date = {
        ...(where.emission_date || {}),
        lte: new Date(query.date_to),
      };

    const page = Number(query.page || 1);
    const limit = Number(query.limit || 20);

    const [data, total] = await Promise.all([
      this.prisma.dispatch_notes.findMany({
        where,
        include: {
          customer: { select: { id: true, first_name: true, last_name: true } },
          dispatch_note_items: true,
        },
        orderBy: { emission_date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dispatch_notes.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getByCustomerReport(query: DispatchNoteQueryDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    const where: any = { store_id };

    if (query.customer_id) where.customer_id = Number(query.customer_id);
    if (query.status) where.status = query.status;
    if (query.date_from)
      where.emission_date = {
        ...(where.emission_date || {}),
        gte: new Date(query.date_from),
      };
    if (query.date_to)
      where.emission_date = {
        ...(where.emission_date || {}),
        lte: new Date(query.date_to),
      };
    if (query.search) {
      where.OR = [
        { dispatch_number: { contains: query.search, mode: 'insensitive' } },
        { customer_name: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = Number(query.page || 1);
    const limit = Number(query.limit || 20);

    const [data, total] = await Promise.all([
      this.prisma.dispatch_notes.findMany({
        where,
        include: {
          customer: { select: { id: true, first_name: true, last_name: true } },
          dispatch_note_items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
            },
          },
        },
        orderBy: { emission_date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dispatch_notes.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getProfitabilityReport(query: DispatchNoteQueryDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    const where: any = {
      store_id,
      status: { in: ['delivered', 'invoiced'] },
    };

    if (query.customer_id) where.customer_id = Number(query.customer_id);
    if (query.date_from)
      where.emission_date = {
        ...(where.emission_date || {}),
        gte: new Date(query.date_from),
      };
    if (query.date_to)
      where.emission_date = {
        ...(where.emission_date || {}),
        lte: new Date(query.date_to),
      };

    const dispatch_notes = await this.prisma.dispatch_notes.findMany({
      where,
      include: {
        dispatch_note_items: true,
        invoice: {
          select: {
            id: true,
            invoice_number: true,
            total_amount: true,
            status: true,
          },
        },
      },
      orderBy: { emission_date: 'desc' },
    });

    const summary = {
      total_dispatched: dispatch_notes.reduce(
        (sum, dn) => sum + Number(dn.grand_total),
        0,
      ),
      total_invoiced: dispatch_notes
        .filter((dn) => dn.invoice)
        .reduce((sum, dn) => sum + Number(dn.invoice?.total_amount || 0), 0),
      gap: 0,
      dispatch_notes_count: dispatch_notes.length,
      invoiced_count: dispatch_notes.filter((dn) => dn.status === 'invoiced')
        .length,
      pending_count: dispatch_notes.filter((dn) => dn.status === 'delivered')
        .length,
    };
    summary.gap = summary.total_dispatched - summary.total_invoiced;

    return { summary, dispatch_notes };
  }
}
