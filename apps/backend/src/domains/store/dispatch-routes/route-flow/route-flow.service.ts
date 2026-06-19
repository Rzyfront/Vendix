import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma, dispatch_route_status_enum } from '@prisma/client';
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
          sales_order: { select: { id: true, order_number: true, status: true } },
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

  private async getRoute(id: number, store_id: number) {
    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id, store_id },
      include: ROUTE_INCLUDE,
    });
    if (!route) throw new NotFoundException(`Planilla #${id} no encontrada`);
    return route;
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

    const updated = await this.prisma.dispatch_routes.update({
      where: { id },
      data: {
        status: 'dispatched',
        dispatch_started_at: new Date(),
        dispatched_by_user_id: user_id,
        updated_at: new Date(),
      },
      include: ROUTE_INCLUDE,
    });

    this.eventEmitter.emit('dispatch_route.dispatched', {
      route_id: id,
      route_number: updated.route_number,
      store_id,
      user_id,
      stops_count: updated.stops.length,
    });

    this.logger.log(`Planilla #${id} despachada con ${updated.stops.length} paradas`);
    return updated;
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
            sales_order: { select: { id: true, order_number: true, status: true } },
          },
        },
      },
    });
    if (!stop) throw new NotFoundException(`Parada #${stopId} no encontrada`);

    if (stop.status === 'released' || stop.status === 'delivered') {
      throw new BadRequestException(`La parada ya está '${stop.status}'`);
    }

    // Validate amounts
    const net = Number(stop.dispatch_note.grand_total);
    const collected = Number(dto.collected_amount || 0);
    const withholding = Number(dto.withholding_amount || 0);
    const anticipo = Number(dto.anticipo_amount || 0);
    const change = Number(dto.change_amount || 0);
    const total_paid = collected + anticipo;

    if (dto.result === 'delivered') {
      // Must cover full net (or be is_prepaid)
      if (!stop.is_prepaid && total_paid + withholding < net) {
        throw new BadRequestException(
          `Suma de collected + anticipo + withholding (${total_paid + withholding}) es menor que el total de la remisión (${net})`,
        );
      }
    }

    // Compute credit amount for partial
    let credit_amount = 0;
    if (dto.result === 'partial') {
      credit_amount = Math.max(0, net - total_paid - withholding);
    }

    const from_status = stop.status;

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

      return updated_stop;
    });

    // Emit domain events to drive accounting / AR / notifications.
    // Only for non-prepaid stops with actual collection.
    if (!stop.is_prepaid) {
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
      return updated_stop;
    });

    this.logger.log(`Parada #${stopId} liberada para reasignación: ${dto.reason}`);
    return updated;
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

    // Compute totals
    const total_collected = route.stops
      .filter((s) => !s.is_prepaid)
      .reduce(
        (sum, s) => sum + Number(s.collected_amount || 0) + Number(s.anticipo_amount || 0),
        0,
      );
    const total_changes = route.stops
      .filter((s) => !s.is_prepaid)
      .reduce((sum, s) => sum + Number(s.change_amount || 0), 0);
    const total_withholdings = route.stops
      .filter((s) => !s.is_prepaid)
      .reduce((sum, s) => sum + Number(s.withholding_amount || 0), 0);
    const total_credit = route.stops
      .filter((s) => !s.is_prepaid)
      .reduce((sum, s) => sum + Number(s.credit_amount || 0), 0);

    const declared_cash = Number(dto.declared_cash);
    // cash_variance = declared_cash - cash collected
    // cash collected = collected_amount in cash (we assume all collected_amount is cash
    // unless payment_method indicates otherwise; conservative: subtract non-cash).
    const cash_collected = route.stops
      .filter((s) => !s.is_prepaid)
      .filter((s) => !s.payment_method || s.payment_method === 'cash')
      .reduce(
        (sum, s) => sum + Number(s.collected_amount || 0) + Number(s.anticipo_amount || 0),
        0,
      );
    const cash_variance = declared_cash - cash_collected;

    const updated = await this.prisma.dispatch_routes.update({
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

    // Emit route.closed event
    this.eventEmitter.emit('dispatch_route.closed', {
      route_id: id,
      route_number: updated.route_number,
      store_id,
      user_id,
      total_collected,
      total_changes,
      total_withholdings,
      total_credit,
      cash_variance,
    });

    this.logger.log(
      `Planilla #${id} cerrada. Recaudado=${total_collected} Variance=${cash_variance}`,
    );
    return updated;
  }

  /**
   * Void a route. Reverses movements if any, frees dispatch_notes.
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

    const updated = await this.prisma.dispatch_routes.update({
      where: { id },
      data: {
        status: 'voided',
        voided_at: new Date(),
        voided_by_user_id: user_id,
        void_reason: dto.reason,
        updated_at: new Date(),
      },
      include: ROUTE_INCLUDE,
    });

    this.eventEmitter.emit('dispatch_route.voided', {
      route_id: id,
      route_number: updated.route_number,
      store_id,
      user_id,
      reason: dto.reason,
    });

    this.logger.log(`Planilla #${id} anulada: ${dto.reason}`);
    return updated;
  }

  async generatePdf(id: number): Promise<Buffer> {
    const store_id = this.getStoreId();
    const route = await this.getRoute(id, store_id);
    return this.pdfExport.generate(route);
  }
}
