import { OrderHistoryService } from '../../../orders/order-history/order-history.service';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { OrderFlowService } from '../../../orders/order-flow/order-flow.service';
import { assertNoActiveFinancialSplit } from '../../../orders/shared/financial-split-policy';
import { getSettledOrderAmount } from '../../../payments/services/payment-validator.service';
import { OrderStockCommitService } from '../../../inventory/shared/services/order-stock-commit.service';
import { StockValidatorService } from '../../../inventory/shared/services/stock-validator.service';
import { TableSessionsService } from '../../../tables/table-sessions.service';
import { SettingsService } from '../../../settings/settings.service';
import { CreateRoomChargeDto, InHouseRoomsQueryDto } from './room-charges.dto';

/** Folio origin of a room charge when the store never set one. */
export const DEFAULT_ROOM_CHARGE_ORIGIN = 'Restaurante';

type Tx = Prisma.TransactionClient;

const toCents = (value: Prisma.Decimal | number | string | null | undefined) =>
  Math.round(Number(value ?? 0) * 100);

const fail = (message: string) => new VendixHttpException(ErrorCodes.LODGING_ROOM_CHARGE_001, message);

interface TargetRoom {
  reservation_room_id: number;
  reservation_id: number;
  room_code: string;
  guest_name: string;
  folio: { id: number; order_id: number };
}

export interface RoomChargeResult {
  id: number;
  reservation_id: number;
  reservation_room_id: number;
  room_code: string;
  guest_name: string;
  origin: string;
  amount: number;
  /** "Cargado a 101 · Juan Pérez". */
  message: string;
}

/**
 * Hospitality Suite (H3.6) — "Cargo a habitación" from the POS and the
 * tables. The sale is not paid: its lines MOVE to the guest folio (the draft
 * order opened at check-in) and the source order is cancelled without any
 * payment, so the folio invoice (H3.7) bills everything once (owner decision
 * D5) and the cash register never counts it as money.
 *
 * Stock leaves with the charge, through the same seam and inventory policy as
 * a paid POS sale (`OrderStockCommitService`). The moved lines keep
 * `inventory_committed`, so neither the check-out nor a void deducts twice.
 * Kitchen tickets keep pointing at the source order: KDS does not change.
 *
 * POS and table services are only consumed, never modified: a POS sale is
 * saved as a draft with the existing endpoint and then charged here; a table
 * bill is charged here and its session is closed with `closeSession`.
 */
@Injectable()
export class LodgingRoomChargesService {
  private readonly logger = new Logger(LodgingRoomChargesService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly orderFlow: OrderFlowService,
    private readonly orderStockCommit: OrderStockCommitService,
    private readonly stockValidator: StockValidatorService,
    private readonly tableSessions: TableSessionsService,
    private readonly settings: SettingsService,
    private readonly orderHistory: OrderHistoryService,
  ) {}

  /** Rooms with a guest in house and an open folio (the room picker). */
  async listInHouseRooms(query: InHouseRoomsQueryDto) {
    const search = query.search?.trim();
    const rooms = await this.prisma.lodging_reservation_rooms.findMany({
      where: {
        cancelled_at: null,
        unit_id: { not: null },
        reservation: { status: 'checked_in', folio: { status: 'open' } },
        ...(search
          ? {
              OR: [
                { unit: { code: { contains: search, mode: 'insensitive' } } },
                { reservation: { customer: { first_name: { contains: search, mode: 'insensitive' } } } },
                { reservation: { customer: { last_name: { contains: search, mode: 'insensitive' } } } },
                { reservation: { reservation_number: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        unit: { select: { code: true } },
        unit_type: { select: { name: true } },
        reservation: {
          select: {
            id: true,
            reservation_number: true,
            departure_date: true,
            customer: { select: { first_name: true, last_name: true } },
            folio: { select: { charges_blocked: true } },
          },
        },
      },
      orderBy: { unit: { code: 'asc' } },
      take: 50,
    });
    return rooms.map((room) => ({
      reservation_room_id: room.id,
      reservation_id: room.reservation.id,
      reservation_number: room.reservation.reservation_number,
      room_code: room.unit?.code ?? '',
      unit_type_name: room.unit_type.name,
      guest_name: this.guestName(room.reservation.customer),
      departure_date: room.reservation.departure_date.toISOString().slice(0, 10),
      charges_blocked: room.reservation.folio?.charges_blocked ?? false,
    }));
  }

  /** Moves a POS draft sale or a table bill to the folio of an in-house room. */
  async chargeToRoom(dto: CreateRoomChargeDto): Promise<RoomChargeResult> {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const user_id = RequestContextService.getUserId() ?? null;
    if ((dto.order_id == null) === (dto.table_session_id == null)) {
      throw fail('Indica la venta del POS o la cuenta de la mesa');
    }

    const room = await this.resolveTargetRoom(dto.reservation_room_id);
    const source = await this.resolveSource(dto);

    // A double click (or a retry) of a charge already made answers the same.
    const existing = await this.prisma.lodging_room_charges.findUnique({
      where: { source_order_id: source.order_id },
    });
    if (existing) return this.alreadyCharged(existing, room);

    const settings = (await this.settings.getSettings()) as { hospitality?: { room_charge_origin?: string } };
    const label = settings?.hospitality?.room_charge_origin?.trim() || DEFAULT_ROOM_CHARGE_ORIGIN;
    const origin = (source.table_name ? `${label} · ${source.table_name}` : label).slice(0, 80);

    const afterCommit: Array<() => void> = [];
    const charge = await this.prisma.$transaction(
      async (tx) => {
        // Source first, then folio: the folio service only ever locks the folio.
        const order = await this.lockOrder(tx, source.order_id, store_id);
        const folioOrder = await this.lockOrder(tx, room.folio.order_id, store_id);
        if (folioOrder.state !== 'draft') throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_CLOSED_001);
        assertNoActiveFinancialSplit(folioOrder);
        // Read again under the lock: the folio may have closed or blocked
        // charges after the room was resolved.
        const fresh = await tx.lodging_folios.findUnique({
          where: { id: room.folio.id },
          select: { status: true, charges_blocked: true, reservation: { select: { status: true } } },
        });
        if (!fresh || fresh.status !== 'open' || fresh.reservation.status !== 'checked_in') {
          throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_CLOSED_001);
        }
        if (fresh.charges_blocked) {
          throw new VendixHttpException(
            ErrorCodes.LODGING_ROOM_CHARGE_BLOCKED_001,
            `La habitación ${room.room_code} tiene los cargos bloqueados`,
          );
        }

        const again = await tx.lodging_room_charges.findUnique({ where: { source_order_id: order.id } });
        if (again) return again;
        this.assertChargeable(order);
        assertNoActiveFinancialSplit(order);

        const items = await tx.order_items.findMany({
          where: { order_id: order.id, cancelled_at: null },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        if (items.length === 0) throw fail('La cuenta no tiene consumos para cargar');

        // Stock leaves now, exactly like a paid POS sale (same policy).
        const policy = await this.stockValidator.resolveInventoryPolicy(store_id, tx);
        const allowOversell = policy.allowOversell === true;
        const commit = await this.orderStockCommit.commitOrderDelivery(
          order.id,
          {
            movementType: 'sale',
            blockOnInsufficient: !allowOversell,
            allowNegativeOnShortfall: allowOversell,
            consumeSerials: true,
            reason: `Cargo a habitación ${room.room_code}`,
            userId: user_id ?? undefined,
            afterCommit,
          },
          tx,
        );

        const item_ids = items.map((item) => item.id);
        await tx.order_items.updateMany({
          where: { id: { in: item_ids }, order_id: order.id },
          data: { order_id: folioOrder.id, updated_at: new Date() },
        });
        await this.orderFlow.recalcOrderTotalsFromActiveLinesInTx(tx, folioOrder, folioOrder.id);
        await this.orderFlow.recalcOrderTotalsFromActiveLinesInTx(tx, order, order.id);
        const after = await tx.orders.findUnique({ where: { id: folioOrder.id }, select: { grand_total: true } });
        const amount = (toCents(after?.grand_total) - toCents(folioOrder.grand_total)) / 100;

        // The source closes without payment: no POS document, no cash.
        await tx.orders.update({
          where: { id: order.id },
          data: {
            state: 'cancelled',
            internal_notes: `Cargado a habitación ${room.room_code} · folio ${room.folio.id}`,
            updated_at: new Date(),
          },
        });
        await this.orderHistory.record(tx, {
          orderId: order.id,
          storeId: store_id,
          type: 'state_changed',
          fromState: order.state,
          toState: 'cancelled',
          payload: { reason: 'room_charge', room_code: room.room_code, folio_id: room.folio.id },
        });
        if (source.table_session_id) {
          await tx.table_sessions.update({
            where: { id: source.table_session_id },
            data: { paid_at: new Date(), updated_at: new Date() },
          });
        }

        return tx.lodging_room_charges.create({
          data: {
            store_id,
            folio_id: room.folio.id,
            reservation_room_id: room.reservation_room_id,
            source_order_id: order.id,
            table_session_id: source.table_session_id,
            origin,
            item_ids,
            amount: new Prisma.Decimal(amount),
            cost_amount: new Prisma.Decimal(commit.totalCost ?? 0),
            created_by_user_id: user_id,
          },
        });
      },
      { timeout: 30_000, maxWait: 5_000 },
    );

    for (const publish of afterCommit) {
      try {
        publish();
      } catch (error) {
        this.logger.warn(`Room charge saved; stock notification failed: ${(error as Error).message}`);
      }
    }
    if (source.table_session_id) {
      // Frees the table with the same close (and staff notification) as a paid check.
      await this.tableSessions.closeSession(source.table_session_id).catch((error: Error) => {
        this.logger.warn(`Room charge ${charge.id}: table session not closed: ${error.message}`);
      });
    }
    return this.toResult(charge, room);
  }

  // --------------------------------------------------------------- helpers

  private async resolveTargetRoom(reservation_room_id: number): Promise<TargetRoom> {
    const room = await this.prisma.lodging_reservation_rooms.findFirst({
      where: { id: reservation_room_id, cancelled_at: null },
      select: {
        id: true,
        unit: { select: { code: true } },
        reservation: {
          select: {
            id: true,
            status: true,
            customer: { select: { first_name: true, last_name: true } },
            folio: { select: { id: true, status: true, order_id: true, charges_blocked: true } },
          },
        },
      },
    });
    const folio = room?.reservation.folio;
    if (!room || !room.unit || room.reservation.status !== 'checked_in' || !folio || folio.status !== 'open') {
      throw fail('La habitación no tiene un huésped en casa');
    }
    if (folio.charges_blocked) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_ROOM_CHARGE_BLOCKED_001,
        `La habitación ${room.unit.code} tiene los cargos bloqueados`,
      );
    }
    return {
      reservation_room_id: room.id,
      reservation_id: room.reservation.id,
      room_code: room.unit.code,
      guest_name: this.guestName(room.reservation.customer),
      folio: { id: folio.id, order_id: folio.order_id },
    };
  }

  private async resolveSource(
    dto: CreateRoomChargeDto,
  ): Promise<{ order_id: number; table_session_id: number | null; table_name: string | null }> {
    if (dto.table_session_id != null) {
      const session = await this.prisma.table_sessions.findFirst({
        where: { id: dto.table_session_id },
        select: { id: true, order_id: true, closed_at: true, paid_at: true, table: { select: { name: true } } },
      });
      if (!session) throw fail('La mesa no tiene una cuenta abierta');
      const charged = await this.prisma.lodging_room_charges.findUnique({
        where: { source_order_id: session.order_id },
        select: { id: true },
      });
      if (!charged && (session.closed_at || session.paid_at)) {
        throw fail('La cuenta de esta mesa ya está cerrada o pagada');
      }
      return { order_id: session.order_id, table_session_id: session.id, table_name: session.table.name };
    }
    const order = await this.prisma.orders.findFirst({ where: { id: dto.order_id }, select: { id: true } });
    if (!order) throw new VendixHttpException(ErrorCodes.ORD_FIND_001);
    return { order_id: order.id, table_session_id: null, table_name: null };
  }

  private async lockOrder(tx: Tx, order_id: number, store_id: number) {
    const locked: Array<{ id: number }> = await tx.$queryRaw`
      SELECT id FROM orders WHERE id = ${order_id} AND store_id = ${store_id} FOR UPDATE
    `;
    if (!locked.length) throw new VendixHttpException(ErrorCodes.ORD_FIND_001);
    const order = await tx.orders.findUnique({
      where: { id: order_id },
      include: {
        payments: { select: { id: true, amount: true, state: true } },
        lodging_folio: { select: { id: true } },
      },
    });
    if (!order) throw new VendixHttpException(ErrorCodes.ORD_FIND_001);
    return order;
  }

  /** Only an unpaid draft sale, with nothing the folio could not carry over. */
  private assertChargeable(order: Awaited<ReturnType<LodgingRoomChargesService['lockOrder']>>): void {
    if (order.lodging_folio) throw fail('Esa orden ya es el folio de una habitación');
    if (order.state !== 'draft') throw fail('Solo se carga una venta sin cobrar');
    if (toCents(getSettledOrderAmount(order)) > 0 || order.payments.some((p) => p.state === 'pending')) {
      throw fail('La cuenta ya tiene pagos: termina de cobrarla en caja');
    }
    // Order-level amounts do not belong to any line, so they cannot move.
    if (
      toCents(order.discount_amount) > 0 ||
      toCents(order.tip_amount) > 0 ||
      toCents(order.shipping_cost) > 0
    ) {
      throw fail('La cuenta tiene descuento, propina o envío: cóbrala en caja');
    }
  }

  private async alreadyCharged(
    existing: { id: number; folio_id: number; reservation_room_id: number; origin: string; amount: Prisma.Decimal },
    room: TargetRoom,
  ): Promise<RoomChargeResult> {
    if (existing.folio_id !== room.folio.id) throw fail('Esa cuenta ya se cargó a otra habitación');
    return this.toResult(existing, room);
  }

  private toResult(
    charge: { id: number; reservation_room_id: number; origin: string; amount: Prisma.Decimal },
    room: TargetRoom,
  ): RoomChargeResult {
    return {
      id: charge.id,
      reservation_id: room.reservation_id,
      reservation_room_id: charge.reservation_room_id,
      room_code: room.room_code,
      guest_name: room.guest_name,
      origin: charge.origin,
      amount: Number(charge.amount),
      message: `Cargado a ${room.room_code} · ${room.guest_name}`,
    };
  }

  private guestName(customer: { first_name: string | null; last_name: string | null } | null): string {
    return [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim() || 'Huésped';
  }
}
