import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  Prisma,
  dispatch_route_status_enum,
  order_state_enum,
} from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CashSettlementService } from './cash-settlement.service';
import { PdfExportService } from './pdf-export.service';
import {
  CloseDispatchRouteDto,
  ReleaseStopDto,
  SettleStopDto,
  VoidDispatchRouteDto,
} from '../dto';
import {
  aggregateRouteTotals,
  deriveStopIsPrepaid,
} from '../utils/route-stop-calc';
import { mergeStoreSettingsWithDefaults } from '../../settings/defaults/default-store-settings';

const ROUTE_INCLUDE = {
  vehicle: true,
  driver_user: {
    select: { id: true, first_name: true, last_name: true, document_number: true },
  },
  origin_location: { select: { id: true, name: true, code: true } },
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
          // COD link: the real orders.id whose state/balance the route drives.
          order_id: true,
          // needs_collection + invoice.payment_date + order.remaining_balance
          // feed the DERIVED is_prepaid (never trust the frozen stop boolean).
          needs_collection: true,
          // Delivery-address snapshot for the planilla per-stop address + the
          // dispatch-time address gate.
          customer_address: true,
          sales_order: { select: { id: true, order_number: true, status: true } },
          invoice: { select: { payment_date: true } },
          // Live payment status of a regular order (remaining_balance) drives
          // the derived prepaid resolution; the snapshot is the address fallback.
          order: {
            select: {
              id: true,
              remaining_balance: true,
              shipping_address_snapshot: true,
              // Live shipping-address relation: 3rd fallback for the per-stop
              // address (legacy remisiones created before the snapshot exist
              // with customer_address = null).
              addresses_orders_shipping_address_idToaddresses: {
                select: {
                  address_line1: true,
                  address_line2: true,
                  city: true,
                  state_province: true,
                  country_code: true,
                  postal_code: true,
                },
              },
            },
          },
        },
      },
    },
  },
};

@Injectable()
export class RouteFlowService {
  private readonly logger = new Logger(RouteFlowService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly cashSettlement: CashSettlementService,
    private readonly pdfExport: PdfExportService,
  ) {}

  private getStoreId(): number {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  /**
   * Read the store's `dispatch.order_state_update_mode` setting in a
   * tenant-safe way. Uses `findFirst({ where: { store_id } })` (never
   * `findUnique`, whose WhereUniqueInput breaks under the scope merge) and
   * merges with defaults so a missing JSON key falls back to `'on_close'`
   * (the legacy behavior). Read once per settle, not per stop.
   */
  private async getOrderStateUpdateMode(
    store_id: number,
  ): Promise<'live' | 'on_close'> {
    try {
      const row = await this.prisma.store_settings.findFirst({
        where: { store_id },
        select: { settings: true },
      });
      const settings = mergeStoreSettingsWithDefaults(row?.settings);
      return settings.dispatch?.order_state_update_mode ?? 'on_close';
    } catch {
      // A settings read failure must NEVER break route settlement. Fall back to
      // the legacy behavior (advance the order state only at route close).
      return 'on_close';
    }
  }

  private async getRoute(id: number, store_id: number) {
    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id },
      include: ROUTE_INCLUDE,
    });
    if (!route) throw new NotFoundException(`Planilla #${id} no encontrada`);
    return this.withDerivedStopPrepaid(route);
  }

  /**
   * Overwrite each stop's `is_prepaid` with the value DERIVED from the linked
   * note/order live payment state. The persisted `dispatch_route_stops.is_prepaid`
   * is frozen at stop creation and must NOT be trusted on read — a paid order
   * keeps `false` and would be charged again. Every read path (totals, close
   * cash filter, settle gate, PDF, route response) consumes the result of
   * `getRoute`, so deriving here keeps all of them consistent.
   */
  private withDerivedStopPrepaid<
    R extends {
      stops: Array<{
        is_prepaid: boolean;
        dispatch_note?: {
          needs_collection?: boolean | null;
          invoice?: { payment_date: Date | null } | null;
          order?: { remaining_balance: Prisma.Decimal | null } | null;
        } | null;
      }>;
    },
  >(route: R): R {
    return {
      ...route,
      stops: route.stops.map((stop) => ({
        ...stop,
        is_prepaid: deriveStopIsPrepaid(stop),
      })),
    };
  }

  /**
   * Whether a stop carries a usable delivery address. Checks, in order: the
   * remisión's `customer_address` snapshot, the order's
   * `shipping_address_snapshot` fallback, and the order's live shipping-address
   * relation (3rd fallback for legacy remisiones created before the snapshot).
   * This MUST mirror the PDF's address-resolution chain so the dispatch gate
   * never blocks a stop whose address the planilla would happily render. A JSON
   * blob (or the live address row) counts when it has a non-empty
   * `address_line1` (or legacy `line1`/`address`) string.
   */
  private stopHasDeliveryAddress(
    customerAddress: Prisma.JsonValue | null | undefined,
    orderSnapshot: Prisma.JsonValue | null | undefined,
    liveAddress?: Prisma.JsonValue | Record<string, unknown> | null,
  ): boolean {
    return (
      this.jsonAddressHasLine(customerAddress) ||
      this.jsonAddressHasLine(orderSnapshot) ||
      this.jsonAddressHasLine(liveAddress as Prisma.JsonValue)
    );
  }

  /** True when a JSON address blob carries a non-empty address line. */
  private jsonAddressHasLine(value: Prisma.JsonValue | null | undefined): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const a = value as Record<string, unknown>;
    const line1 = a.address_line1 ?? a.line1 ?? a.address;
    return typeof line1 === 'string' && line1.trim().length > 0;
  }

  /**
   * COD order-state machine helpers.
   *
   * The route drives the non-linear COD lifecycle of the linked `orders` row:
   *   processing → shipped   (on route dispatch)
   *   shipped → delivered → finished  (on route close, once delivered+collected)
   *
   * These mirror the source-of-truth `VALID_TRANSITIONS` in
   * `OrderFlowService` (shipped:['delivered'], delivered:['finished',...]).
   * We write the state directly inside the route transaction instead of
   * re-dispatching order-flow events, to avoid side effects (stock, cash,
   * notifications) that the route already orchestrates. All writes are
   * store-scoped via `updateMany` and are idempotent (no-op when the order is
   * already at/past the target state).
   */
  private async advanceOrderToShipped(
    tx: Prisma.TransactionClient,
    store_id: number,
    order_id: number,
  ): Promise<void> {
    const order = await tx.orders.findFirst({
      where: { id: order_id, store_id },
      select: { id: true, state: true },
    });
    if (!order) return;
    // Only `processing → shipped` is a valid transition. If the order is in any
    // other state (already shipped/delivered/finished, or not yet processing),
    // this is a no-op so re-dispatch never throws.
    if (order.state !== 'processing') return;
    await tx.orders.updateMany({
      where: { id: order_id, store_id, state: 'processing' },
      data: { state: 'shipped', updated_at: new Date() },
    });
  }

  /**
   * Advance a linked COD order `shipped → delivered` ONLY. Used for the
   * `dispatch.order_state_update_mode = 'live'` setting so the order reflects
   * "entregada" the moment a stop is settled, instead of waiting for the route
   * close. Idempotent and store-scoped: if the order is not in `shipped`
   * (not yet shipped, already delivered/finished, cancelled, etc.) this is a
   * no-op. The route close (`advanceOrderToFinished`) still walks
   * delivered → finished afterwards, so it composes with the live update.
   */
  private async advanceOrderToDelivered(
    tx: Prisma.TransactionClient,
    store_id: number,
    order_id: number,
  ): Promise<void> {
    const order = await tx.orders.findFirst({
      where: { id: order_id, store_id },
      select: { id: true, state: true },
    });
    if (!order) return;
    // Only `shipped → delivered` is valid here. Any other state is a no-op so
    // re-settling never throws and never skips ahead to finished.
    if (order.state !== 'shipped') return;
    await tx.orders.updateMany({
      where: { id: order_id, store_id, state: 'shipped' },
      data: { state: 'delivered', updated_at: new Date() },
    });
  }

  private async advanceOrderToFinished(
    tx: Prisma.TransactionClient,
    store_id: number,
    order_id: number,
  ): Promise<void> {
    const order = await tx.orders.findFirst({
      where: { id: order_id, store_id },
      select: { id: true, state: true },
    });
    if (!order) return;
    let state = order.state as order_state_enum;
    if (state === 'finished') return;
    // Walk the valid path shipped → delivered → finished. Each step is a no-op
    // if the order is already past it, keeping the close idempotent.
    if (state === 'shipped') {
      await tx.orders.updateMany({
        where: { id: order_id, store_id, state: 'shipped' },
        data: { state: 'delivered', updated_at: new Date() },
      });
      state = 'delivered';
    }
    if (state === 'delivered') {
      await tx.orders.updateMany({
        where: { id: order_id, store_id, state: 'delivered' },
        data: {
          state: 'finished',
          completed_at: new Date(),
          updated_at: new Date(),
        },
      });
    }
    // Any other state (processing/created/cancelled/refunded) is left untouched:
    // there is no valid direct path to finished from there in this flow.
  }

  /**
   * Transition the linked dispatch_note → 'delivered' inside the settle
   * transaction, mirroring the canonical `DispatchNoteFlowService.deliver`
   * field writes (delivered_by_user_id, delivered_at, actual_delivery_date).
   *
   * Idempotent: if the note is already past 'confirmed'
   * (delivered/invoiced/voided) it is a no-op and returns `null` so the caller
   * does NOT re-emit the `dispatch_note.delivered` event. A note still in
   * 'draft' is confirmed-on-the-fly (sets confirmed_at/confirmed_by_user_id)
   * to honor the VALID_TRANSITIONS contract (draft → ... → delivered).
   *
   * Returns the post-commit event payload (or null), so the caller can emit
   * `dispatch_note.delivered` AFTER the transaction commits — the listener
   * re-reads the note and must see status:'delivered' already persisted before
   * it fires the inventory primitive.
   */
  private async markDispatchNoteDeliveredInTx(
    tx: Prisma.TransactionClient,
    note: {
      id: number;
      dispatch_number: string;
      status: string;
      sales_order_id: number | null;
      order_id: number | null;
    },
    store_id: number,
    user_id: number | undefined,
  ): Promise<{
    dispatch_note_id: number;
    dispatch_number: string;
    store_id: number;
    sales_order_id: number | null;
    order_id: number | null;
  } | null> {
    // Terminal / already-delivered states: no re-transition, no re-emit.
    if (
      note.status === 'delivered' ||
      note.status === 'invoiced' ||
      note.status === 'voided'
    ) {
      return null;
    }

    await tx.dispatch_notes.update({
      where: { id: note.id },
      data: {
        status: 'delivered',
        delivered_by_user_id: user_id,
        delivered_at: new Date(),
        actual_delivery_date: new Date(),
        updated_at: new Date(),
        // A note still in 'draft' must be confirmed-on-the-fly so the
        // draft → confirmed → delivered invariant holds end-to-end.
        ...(note.status === 'draft'
          ? { confirmed_at: new Date(), confirmed_by_user_id: user_id }
          : {}),
      },
    });

    return {
      dispatch_note_id: note.id,
      dispatch_number: note.dispatch_number,
      store_id,
      sales_order_id: note.sales_order_id,
      order_id: note.order_id,
    };
  }

  /**
   * Transition a route: draft → dispatched.
   * Locks the stops (no more add/remove) and sets dispatch_started_at.
   */
  async dispatch(id: number) {
    const store_id = this.getStoreId();
    const user_id = RequestContextService.getContext()?.user_id;
    const route = await this.getRoute(id, store_id);

    if (route.status !== 'draft') {
      throw new BadRequestException(
        `Solo se puede despachar una planilla en estado 'draft' (actual: '${route.status}')`,
      );
    }
    if (route.stops.length === 0) {
      throw new BadRequestException('La planilla no tiene paradas');
    }

    // Conductor obligatorio al despachar (regla del plan: si interno, driver_user_id;
    // si externo, external_driver_name + external_driver_id_number).
    if (route.is_primary_driver_external) {
      if (!route.external_driver_name || !route.external_driver_id_number) {
        throw new BadRequestException(
          'Conductor externo requiere nombre y cédula antes de despachar',
        );
      }
    } else if (!route.driver_user_id) {
      throw new BadRequestException(
        'Conductor interno requiere driver_user_id antes de despachar',
      );
    }

    // Per-stop delivery-address gate (defense in depth): sub-task 2 already
    // blocks createFromOrder/createFromSalesOrder when the order has no address,
    // but legacy remisiones (created before this rule) may still lack one. We
    // require every stop to carry a delivery address (customer_address snapshot
    // or the order's shipping_address_snapshot fallback) before dispatching.
    const stopsWithoutAddress = route.stops.filter(
      (stop) =>
        !this.stopHasDeliveryAddress(
          stop.dispatch_note?.customer_address,
          stop.dispatch_note?.order?.shipping_address_snapshot,
          stop.dispatch_note?.order
            ?.addresses_orders_shipping_address_idToaddresses,
        ),
    );
    if (stopsWithoutAddress.length > 0) {
      const numbers = stopsWithoutAddress
        .map((s) => s.dispatch_note?.dispatch_number || `#${s.dispatch_note_id}`)
        .join(', ');
      throw new VendixHttpException(
        ErrorCodes.DISPATCH_ROUTE_STOP_NO_ADDRESS,
        `Las siguientes remisiones no tienen dirección de entrega: ${numbers}`,
        { dispatch_numbers: numbers },
      );
    }

    // Accumulate confirm-on-dispatch payloads so we can emit
    // `dispatch_note.confirmed` AFTER the transaction commits (the reservation
    // listener re-reads the note and must see status:'confirmed' persisted).
    const confirmedEventPayloads: Array<{
      dispatch_note_id: number;
      dispatch_number: string;
      store_id: number;
      sales_order_id: number | null;
      order_id: number | null;
    }> = [];

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated_route = await tx.dispatch_routes.update({
        where: { id },
        data: {
          status: 'dispatched',
          dispatch_started_at: new Date(),
          dispatched_by_user_id: user_id,
          updated_at: new Date(),
        },
        include: ROUTE_INCLUDE,
      });

      // COD: advance each linked order processing → shipped (idempotent).
      for (const stop of updated_route.stops) {
        const order_id = stop.dispatch_note?.order_id;
        if (order_id) {
          await this.advanceOrderToShipped(tx, store_id, order_id);
        }

        // Reserve-invariant: every DISPATCHED remisión must be at least
        // 'confirmed' so its stock reservation exists (handleConfirmed reserves
        // only standalone notes). This makes the anti double-deduction gate
        // consistent: by the time a stop settles to 'delivered', the note has a
        // reservation to consume. If all notes already arrive confirmed, no-op.
        const note = stop.dispatch_note;
        if (note?.status === 'draft') {
          await tx.dispatch_notes.update({
            where: { id: note.id },
            data: {
              status: 'confirmed',
              confirmed_by_user_id: user_id,
              confirmed_at: new Date(),
              updated_at: new Date(),
            },
          });
          confirmedEventPayloads.push({
            dispatch_note_id: note.id,
            dispatch_number: note.dispatch_number,
            store_id,
            sales_order_id: note.sales_order_id,
            order_id: note.order_id,
          });
        }
      }

      return updated_route;
    });

    // Post-commit: emit one `dispatch_note.confirmed` per note confirmed above
    // so the reservation listener sees the persisted 'confirmed' status.
    for (const payload of confirmedEventPayloads) {
      this.eventEmitter.emit('dispatch_note.confirmed', payload);
    }

    this.eventEmitter.emit('dispatch_route.dispatched', {
      route_id: id,
      route_number: updated.route_number,
      store_id,
      user_id,
      stops_count: updated.stops.length,
    });

    this.logger.log(`Planilla #${id} despachada con ${updated.stops.length} paradas`);
    return this.withDerivedStopPrepaid(updated);
  }

  /**
   * Mark a stop as in_progress (start settling in the field).
   */
  async startStop(id: number, stopId: number) {
    const store_id = this.getStoreId();
    const route = await this.getRoute(id, store_id);
    if (!['dispatched', 'in_transit', 'settling'].includes(route.status)) {
      throw new BadRequestException(
        `No se puede iniciar liquidación en planilla en estado '${route.status}'`,
      );
    }
    const stop = await this.prisma.dispatch_route_stops.findFirst({
      where: { id: stopId, route_id: id },
    });
    if (!stop) throw new NotFoundException(`Parada #${stopId} no encontrada`);
    if (stop.status !== 'pending') {
      throw new BadRequestException(
        `La parada está en estado '${stop.status}', solo se puede iniciar desde 'pending'`,
      );
    }

    // Auto-transition route to in_transit on first start
    const route_update =
      route.status === 'dispatched'
        ? { status: 'in_transit' as const, updated_at: new Date() }
        : { updated_at: new Date() };

    const [updated_stop, _] = await this.prisma.$transaction([
      this.prisma.dispatch_route_stops.update({
        where: { id: stopId },
        data: { status: 'in_progress', updated_at: new Date() },
      }),
      this.prisma.dispatch_routes.update({
        where: { id },
        data: route_update,
      }),
      this.prisma.dispatch_route_stop_history.create({
        data: {
          stop_id: stopId,
          action: 'start',
          from_status: 'pending',
          to_status: 'in_progress',
        },
      }),
    ]);

    return updated_stop;
  }

  /**
   * Settle a stop with result + amounts.
   * Emits payment / credit / refund / withholding events via CashSettlementService.
   */
  async settleStop(id: number, stopId: number, dto: SettleStopDto) {
    const store_id = this.getStoreId();
    const user_id = RequestContextService.getContext()?.user_id;
    const route = await this.getRoute(id, store_id);
    if (!['dispatched', 'in_transit', 'settling'].includes(route.status)) {
      throw new BadRequestException(
        `No se puede liquidar una parada en planilla en estado '${route.status}'`,
      );
    }

    // Read the COD order-state update mode once per settle (not per stop).
    const orderStateUpdateMode = await this.getOrderStateUpdateMode(store_id);

    const stop = await this.prisma.dispatch_route_stops.findFirst({
      where: { id: stopId, route_id: id },
      include: {
        dispatch_note: {
          select: {
            id: true,
            dispatch_number: true,
            grand_total: true,
            customer_id: true,
            sales_order_id: true,
            // Current remisión status — drives the idempotent transition to
            // 'delivered' (and confirmed-on-the-fly for draft) in
            // markDispatchNoteDeliveredInTx.
            status: true,
            // COD link: the real orders.id whose state the route drives. Needed
            // for the `live` order_state_update_mode (advance to delivered here).
            order_id: true,
            // Live payment signals so the prepaid gate below is DERIVED (never
            // the frozen stop.is_prepaid boolean).
            needs_collection: true,
            sales_order: { select: { id: true, order_number: true, status: true } },
            invoice: { select: { payment_date: true } },
            order: { select: { remaining_balance: true } },
            // For withholding-agent validation: a retenedor cliente must
            // arrive at 'delivered' or 'partial' WITH a populated
            // withholding_breakdown, otherwise the fiscal accounting will
            // not balance. We surface a 400 here instead of accepting a
            // malformed stop that downstream listeners can't reconcile.
            customer: { select: { is_withholding_agent: true } },
          },
        },
      },
    });
    if (!stop) throw new NotFoundException(`Parada #${stopId} no encontrada`);

    if (stop.status === 'released' || stop.status === 'delivered') {
      throw new BadRequestException(`La parada ya está '${stop.status}'`);
    }

    // No hay entregas parciales / crédito en ruta: el pago es TOTAL o no hay
    // pago. Entregada ⇒ pagada al 100% (o prepaga). Resultados válidos:
    // 'delivered', 'rejected', 'released'. 'partial' queda deshabilitado.
    if ((dto.result as string) === 'partial') {
      throw new VendixHttpException(
        ErrorCodes.DISPATCH_ROUTE_PARTIAL_DISABLED,
        "Las entregas parciales no están habilitadas en ruta: el pago debe ser total. Marca la parada como entregada (pago completo) o rechazada.",
      );
    }

    // DERIVED prepaid for this stop from the live note/order payment state.
    // Never trust the persisted (frozen) stop.is_prepaid for the COD logic.
    const stopIsPrepaid = deriveStopIsPrepaid(stop);

    // Withholding-agent guard: if the customer is a retenedor, the operator
    // must register the breakdown (retefuente / reteiva / reteica) and the
    // withholding_amount must match the sum of the breakdown. The frontend
    // also enforces this in the settle modal but the backend is the source
    // of truth — a retenedor with no withholding line item would leave the
    // fiscal accounting unbalanced.
    const isWithholdingAgent = !!stop.dispatch_note.customer?.is_withholding_agent;
    const withholdingAmount = Number(dto.withholding_amount || 0);
    const breakdown = dto.withholding_breakdown as
      | { retefuente?: number; reteiva?: number; reteica?: number }
      | undefined;
    const breakdownSum =
      Number(breakdown?.retefuente || 0) +
      Number(breakdown?.reteiva || 0) +
      Number(breakdown?.reteica || 0);
    if (isWithholdingAgent && dto.result === 'delivered') {
      if (withholdingAmount <= 0 || !breakdown || breakdownSum <= 0) {
        throw new BadRequestException(
          `El cliente es agente retenedor: la liquidación requiere un desglose de retención (retefuente / reteiva / reteica) con suma > 0.`,
        );
      }
      // Allow a 1-cent rounding tolerance on the breakdown sum vs the
      // declared withholding_amount.
      if (Math.abs(breakdownSum - withholdingAmount) > 0.01) {
        throw new BadRequestException(
          `El desglose de retención (${breakdownSum}) no coincide con el monto retenido (${withholdingAmount}).`,
        );
      }
    }

    // Validate amounts
    const net = Number(stop.dispatch_note.grand_total);
    const collected = Number(dto.collected_amount || 0);
    const withholding = Number(dto.withholding_amount || 0);
    const anticipo = Number(dto.anticipo_amount || 0);
    const change = Number(dto.change_amount || 0);
    const total_paid = collected + anticipo;

    if (dto.result === 'delivered') {
      // Must cover full net (or be prepaid)
      if (!stopIsPrepaid && total_paid + withholding < net) {
        throw new BadRequestException(
          `Suma de collected + anticipo + withholding (${total_paid + withholding}) es menor que el total de la remisión (${net})`,
        );
      }
    }

    // Sin crédito en ruta: el pago es total o no hay pago. `credit_amount`
    // permanece en 0 siempre (la columna se conserva en el schema, pero ya no
    // se usa). `anticipo_amount` deja de funcionar como pago parcial.
    const credit_amount = 0;

    const from_status = stop.status;

    // Captured inside the tx, emitted AFTER commit so the listener that reacts
    // to `dispatch_note.delivered` (inventory primitive) re-reads the note and
    // sees status:'delivered' already persisted. `null` ⇒ no transition, no emit.
    let deliveredEventPayload: {
      dispatch_note_id: number;
      dispatch_number: string;
      store_id: number;
      sales_order_id: number | null;
      order_id: number | null;
    } | null = null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated_stop = await tx.dispatch_route_stops.update({
        where: { id: stopId },
        data: {
          status: dto.result,
          result: dto.result,
          collected_amount: collected,
          anticipo_amount: anticipo,
          change_amount: change,
          withholding_amount: withholding,
          withholding_breakdown: dto.withholding_breakdown as any,
          credit_amount,
          payment_method: dto.payment_method,
          notes: dto.notes,
          settled_at: new Date(),
          settled_by_user_id: user_id,
          updated_at: new Date(),
        },
      });

      await tx.dispatch_route_stop_history.create({
        data: {
          stop_id: stopId,
          action: 'settle',
          from_status,
          to_status: dto.result,
          metadata: {
            collected_amount: collected,
            anticipo_amount: anticipo,
            change_amount: change,
            withholding_amount: withholding,
            credit_amount,
            payment_method: dto.payment_method,
          } as any,
        },
      });

      // Keep parent totals in sync so the detail page reflects live "Recaudado".
      await this.refreshRouteTotals(tx, id);

      // Live order-state mode: reflect the COD order as "delivered" the moment
      // the stop is settled as delivered (pago total). `rejected` is excluded
      // (a refused delivery does not deliver the order). The walk to `finished`
      // still happens at route close. No-op for `on_close` mode.
      if (orderStateUpdateMode === 'live') {
        const order_id = stop.dispatch_note?.order_id;
        if (order_id && dto.result === 'delivered') {
          await this.advanceOrderToDelivered(tx, store_id, order_id);
        }
      }

      // Sync the remisión with the route close-out: a stop settled as delivered
      // (pago total) drives its dispatch_note → 'delivered' (idempotent).
      // rejected/released do NOT deliver the note. The event is emitted AFTER
      // the tx commits (see deliveredEventPayload below).
      if (dto.result === 'delivered') {
        deliveredEventPayload = await this.markDispatchNoteDeliveredInTx(
          tx,
          stop.dispatch_note as any,
          store_id,
          user_id,
        );
      }

      return updated_stop;
    });

    // Emit domain events to drive accounting / AR / notifications.
    // Only for non-prepaid stops with actual collection (DERIVED prepaid).
    if (!stopIsPrepaid) {
      if (collected > 0 || anticipo > 0) {
        await this.cashSettlement.emitPaymentReceived({
          store_id,
          organization_id: undefined, // resolved in cashSettlement
          route_id: id,
          stop_id: stopId,
          dispatch_note_id: stop.dispatch_note_id,
          customer_id: stop.dispatch_note.customer_id,
          sales_order_id: stop.dispatch_note.sales_order_id,
          amount: collected + anticipo,
          payment_method: dto.payment_method || 'cash',
          user_id,
          withholding_breakdown: dto.withholding_breakdown,
        });
      }
      if (credit_amount > 0) {
        await this.cashSettlement.emitCreditSale({
          store_id,
          route_id: id,
          stop_id: stopId,
          dispatch_note_id: stop.dispatch_note_id,
          customer_id: stop.dispatch_note.customer_id,
          sales_order_id: stop.dispatch_note.sales_order_id,
          amount: credit_amount,
          user_id,
        });
      }
      if (change > 0) {
        await this.cashSettlement.emitRefundCompleted({
          store_id,
          route_id: id,
          stop_id: stopId,
          dispatch_note_id: stop.dispatch_note_id,
          sales_order_id: stop.dispatch_note.sales_order_id,
          amount: change,
          user_id,
          reason: 'Cambio/devolución en ruta',
        });
      }
      if (withholding > 0) {
        // Withholding suffered by the store: persist withholding_calculations
        // (role='suffered'). Fall back to retefuente if the breakdown is absent.
        const breakdown =
          (dto.withholding_breakdown as {
            retefuente?: number;
            reteiva?: number;
            reteica?: number;
          }) || {};
        const hasBreakdown =
          Number(breakdown.retefuente || 0) +
            Number(breakdown.reteiva || 0) +
            Number(breakdown.reteica || 0) >
          0;
        await this.cashSettlement.emitWithholding({
          store_id,
          organization_id: undefined, // resolved in cashSettlement
          route_id: id,
          stop_id: stopId,
          dispatch_note_id: stop.dispatch_note_id,
          customer_id: stop.dispatch_note.customer_id,
          sales_order_id: stop.dispatch_note.sales_order_id,
          net_amount: net,
          breakdown: hasBreakdown ? breakdown : { retefuente: withholding },
          user_id,
        });
      }
    }

    // Post-commit: drive the remisión-delivered listener (inventory primitive).
    // MUST be after the $transaction so the note's 'delivered' status is already
    // committed when the listener re-reads it.
    if (deliveredEventPayload) {
      this.eventEmitter.emit('dispatch_note.delivered', deliveredEventPayload);
    }

    this.logger.log(
      `Parada #${stopId} liquidada: result=${dto.result} collected=${collected} withholding=${withholding} credit=${credit_amount}`,
    );
    return updated;
  }

  /**
   * Release a stop so its dispatch_note can be reassigned to another route.
   * Valid in dispatched, in_transit, settling. Not in closed/voided.
   */
  async releaseStop(id: number, stopId: number, dto: ReleaseStopDto) {
    const store_id = this.getStoreId();
    const user_id = RequestContextService.getContext()?.user_id;
    const route = await this.getRoute(id, store_id);
    if (['closed', 'voided'].includes(route.status)) {
      throw new BadRequestException(
        `No se puede liberar una parada en planilla '${route.status}'`,
      );
    }
    const stop = await this.prisma.dispatch_route_stops.findFirst({
      where: { id: stopId, route_id: id },
    });
    if (!stop) throw new NotFoundException(`Parada #${stopId} no encontrada`);
    if (['released', 'delivered'].includes(stop.status)) {
      throw new BadRequestException(`La parada ya está '${stop.status}'`);
    }

    const from_status = stop.status;

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated_stop = await tx.dispatch_route_stops.update({
        where: { id: stopId },
        data: {
          status: 'released',
          result: 'released',
          released_at: new Date(),
          updated_at: new Date(),
        },
      });
      await tx.dispatch_route_stop_history.create({
        data: {
          stop_id: stopId,
          action: 'release',
          from_status,
          to_status: 'released',
          reason: dto.reason,
          released_by: user_id,
        },
      });

      // Released stops drop out of pending; refresh aggregates so the detail
      // page re-computes the "A cobrar" / variance projections live.
      await this.refreshRouteTotals(tx, id);

      return updated_stop;
    });

    this.logger.log(`Parada #${stopId} liberada para reasignación: ${dto.reason}`);
    return updated;
  }


  /**
   * Recompute and persist the parent `dispatch_routes` aggregate columns
   * (total_collected, total_to_collect, total_prepaid, total_credit,
   * total_withholdings, total_changes) from the current stop set.
   *
   * Called from `settleStop`, `releaseStop` and `close` so the parent stays in
   * sync with the live stop data, enabling the detail page to render real
   * "Recaudado / A cobrar" totals during the route.
   *
   * No-op when the route is closed/voided (its totals are final).
   */
  /**
   * Recompute and persist the parent `dispatch_routes` aggregate columns
   * (total_collected, total_to_collect, total_prepaid, total_credit,
   * total_withholdings, total_changes) from the current stop set.
   *
   * Accepts either a Prisma `TransactionClient` (so it composes with the
   * settle/release transaction) or the regular `StorePrismaService` (so
   * unit tests can pass a jest mock without mocking the tx). Internally it
   * only uses the `dispatch_routes` and `dispatch_route_stops` clients; both
   * Prisma clients expose the same shape for those models.
   */
  private async refreshRouteTotals(
    prismaClient: Prisma.TransactionClient | StorePrismaService,
    route_id: number,
  ): Promise<void> {
    const route = await prismaClient.dispatch_routes.findFirst({
      where: { id: route_id },
      select: { status: true },
    });
    if (!route) return;
    if (route.status === 'closed' || route.status === 'voided') return;

    const stops = await prismaClient.dispatch_route_stops.findMany({
      where: { route_id },
      select: {
        is_prepaid: true,
        collected_amount: true,
        anticipo_amount: true,
        change_amount: true,
        withholding_amount: true,
        credit_amount: true,
        dispatch_note: {
          select: {
            grand_total: true,
            // Live payment signals so is_prepaid is DERIVED, not the frozen
            // persisted boolean (mirrors getRoute / withDerivedStopPrepaid).
            needs_collection: true,
            invoice: { select: { payment_date: true } },
            order: { select: { remaining_balance: true } },
          },
        },
      },
    });

    // Prisma returns Decimal columns — normalise to number so the pure helper
    // (which expects number | string | null) accepts them.
    const totals = aggregateRouteTotals(
      stops.map((s) => ({
        is_prepaid: deriveStopIsPrepaid(s),
        collected_amount: s.collected_amount == null ? 0 : Number(s.collected_amount),
        anticipo_amount: s.anticipo_amount == null ? 0 : Number(s.anticipo_amount),
        change_amount: s.change_amount == null ? 0 : Number(s.change_amount),
        withholding_amount: s.withholding_amount == null ? 0 : Number(s.withholding_amount),
        credit_amount: s.credit_amount == null ? 0 : Number(s.credit_amount),
        dispatch_note_grand_total:
          s.dispatch_note?.grand_total == null ? 0 : Number(s.dispatch_note.grand_total),
      })),
    );

    await prismaClient.dispatch_routes.update({
      where: { id: route_id },
      data: {
        total_collected: totals.total_collected,
        total_to_collect: totals.total_to_collect,
        total_prepaid: totals.total_prepaid,
        total_credit: totals.total_credit,
        total_withholdings: totals.total_withholdings,
        total_changes: totals.total_changes,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Close the route. Aggregates totals, computes cash_variance, fires
   * settlement events. Marks the route as 'closed'.
   */
  async close(id: number, dto: CloseDispatchRouteDto) {
    const store_id = this.getStoreId();
    const user_id = RequestContextService.getContext()?.user_id;
    const route = await this.getRoute(id, store_id);

    if (!['dispatched', 'in_transit', 'settling'].includes(route.status)) {
      throw new BadRequestException(
        `No se puede cerrar una planilla en estado '${route.status}'`,
      );
    }

    // Validate all stops are in terminal state
    const non_terminal = route.stops.filter(
      (s) => !['delivered', 'partial', 'rejected', 'released'].includes(s.status),
    );
    if (non_terminal.length > 0) {
      throw new BadRequestException(
        `Hay ${non_terminal.length} parada(s) sin liquidar. Liquida o libera todas las paradas antes de cerrar.`,
      );
    }

    // Use the same pure aggregator the live-updates use, so close-time totals
    // match the per-stop refresh in `settleStop`/`releaseStop` byte-for-byte.
    const total_collected = aggregateRouteTotals(route.stops).total_collected;
    const total_changes = aggregateRouteTotals(route.stops).total_changes;
    const total_withholdings = aggregateRouteTotals(route.stops).total_withholdings;
    const total_credit = aggregateRouteTotals(route.stops).total_credit;

    const declared_cash = Number(dto.declared_cash);
    // cash_variance = declared_cash - cash collected.
    // We treat as cash any collected_amount on a non-prepaid stop whose
    // payment_method is null/'cash' (the conservative default for COD DSD).
    // Stops paid via transfer/card are excluded from the cash reconciliation.
    const cash_collected = route.stops
      .filter((s) => !s.is_prepaid)
      .filter((s) => !s.payment_method || s.payment_method === 'cash')
      .reduce(
        (sum, s) => sum + Number(s.collected_amount || 0) + Number(s.anticipo_amount || 0),
        0,
      );
    const cash_variance = declared_cash - cash_collected;

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated_route = await tx.dispatch_routes.update({
        where: { id },
        data: {
          status: 'closed',
          closed_at: new Date(),
          closed_by_user_id: user_id,
          total_collected,
          total_changes,
          total_withholdings,
          total_credit,
          declared_cash,
          cash_variance,
          notes: dto.notes ?? route.notes,
          updated_at: new Date(),
        },
        include: ROUTE_INCLUDE,
      });

      // COD: finish each linked order whose stop was ENTREGADA. Con la regla
      // "entregada = pagada al 100% (o prepaga)" ya no hay gate de recaudo: toda
      // parada con result='delivered' sincroniza su orden shipped → delivered →
      // finished. Esto cierra el gap donde las órdenes se quedaban en 'shipped'.
      // rejected/released NO avanzan. `advanceOrderToFinished` es idempotente
      // (no-op si la orden ya está en/past target) y store-scoped.
      for (const stop of updated_route.stops) {
        const order_id = stop.dispatch_note?.order_id;
        if (!order_id) continue;
        if (stop.result !== 'delivered') continue;

        await this.advanceOrderToFinished(tx, store_id, order_id);
      }

      return updated_route;
    });

    // Conductor/responsable del faltante: interno (driver_user_id) o externo.
    // El asiento de faltante (CxC 1365) usa este id/etiqueta como tercero.
    const driver_label = updated.is_primary_driver_external
      ? updated.external_driver_name || undefined
      : undefined;

    // Emit route.closed event
    this.eventEmitter.emit('dispatch_route.closed', {
      route_id: id,
      route_number: updated.route_number,
      store_id,
      user_id,
      driver_user_id: updated.driver_user_id ?? undefined,
      driver_label,
      total_collected,
      total_changes,
      total_withholdings,
      total_credit,
      cash_variance,
    });

    this.logger.log(
      `Planilla #${id} cerrada. Recaudado=${total_collected} Variance=${cash_variance}`,
    );
    return this.withDerivedStopPrepaid(updated);
  }

  /**
   * Void a route. Frees dispatch_notes (so they can be reassigned to another
   * planilla) by releasing any stops that are not yet in a terminal state.
   * Settled stops are NOT auto-released because the cash movements /
   * withholding calculations linked to them have already hit the ledger and
   * a manual adjustment is required to reverse them.
   */
  async void(id: number, dto: VoidDispatchRouteDto) {
    const store_id = this.getStoreId();
    const user_id = RequestContextService.getContext()?.user_id;
    const route = await this.getRoute(id, store_id);
    if (route.status === 'closed') {
      throw new BadRequestException(
        'No se puede anular una planilla cerrada. Solicita una nota de ajuste manual.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Auto-release stops that are still in non-terminal states (pending or
      // in_progress) so their dispatch_notes can be reassigned. Settled stops
      // stay as-is because reversing their cash/AR impact requires manual
      // accounting entries outside the scope of an "anular".
      const releasable = route.stops.filter(
        (s) => s.status === 'pending' || s.status === 'in_progress',
      );
      for (const stop of releasable) {
        await tx.dispatch_route_stops.update({
          where: { id: stop.id },
          data: {
            status: 'released',
            result: 'released',
            released_at: new Date(),
            notes: dto.notes
              ? `Anulada planilla: ${dto.reason}. ${dto.notes}`
              : `Anulada planilla: ${dto.reason}`,
            updated_at: new Date(),
          },
        });
        await tx.dispatch_route_stop_history.create({
          data: {
            stop_id: stop.id,
            action: 'void',
            from_status: stop.status,
            to_status: 'released',
            reason: dto.reason,
            released_by: user_id,
          },
        });
      }

      const updated_route = await tx.dispatch_routes.update({
        where: { id },
        data: {
          status: 'voided',
          voided_at: new Date(),
          voided_by_user_id: user_id,
          void_reason: dto.reason,
          notes: dto.notes ?? route.notes,
          updated_at: new Date(),
        },
        include: ROUTE_INCLUDE,
      });

      return updated_route;
    });

    this.eventEmitter.emit('dispatch_route.voided', {
      route_id: id,
      route_number: updated.route_number,
      store_id,
      user_id,
      reason: dto.reason,
    });

    this.logger.log(`Planilla #${id} anulada: ${dto.reason}`);
    return this.withDerivedStopPrepaid(updated);
  }

  async generatePdf(id: number): Promise<Buffer> {
    const store_id = this.getStoreId();
    const route = await this.getRoute(id, store_id);
    return this.pdfExport.generate(route);
  }
}
