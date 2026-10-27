import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { LodgingRoomChargesService } from './room-charges.service';

interface Item {
  id: number;
  order_id: number;
  total: number;
  cancelled_at: Date | null;
  inventory_committed: boolean;
}

interface Order {
  id: number;
  store_id: number;
  state: string;
  grand_total: number;
  discount_amount: number;
  tip_amount: number;
  shipping_cost: number;
  internal_notes: string | null;
  active_financial_split_id: number | null;
  payments: Array<{ id: number; amount: number; state: string }>;
  lodging_folio: { id: number } | null;
}

/**
 * H3.6 — room 101 of H-0001 (Juan Pérez) is in house with its folio 70 (draft
 * order 500, $250.000 of nights). The restaurant has a POS draft sale 900 of
 * $45.000 (two lines + one voided line) and table 4 with session 31 over the
 * draft order 910.
 */
function build(
  options: {
    status?: string;
    blocked?: boolean;
    paid?: number;
    discount?: number;
    existing?: { folio_id: number };
    sessionPaid?: boolean;
  } = {},
) {
  const orders = new Map<number, Order>();
  const order = (id: number, grand_total: number, extra: Partial<Order> = {}): Order => ({
    id,
    store_id: 3,
    state: 'draft',
    grand_total,
    discount_amount: 0,
    tip_amount: 0,
    shipping_cost: 0,
    internal_notes: null,
    active_financial_split_id: null,
    payments: [],
    lodging_folio: null,
    ...extra,
  });
  orders.set(500, order(500, 250000, { lodging_folio: { id: 70 } }));
  orders.set(
    900,
    order(900, 45000, {
      discount_amount: options.discount ?? 0,
      payments: options.paid ? [{ id: 1, amount: options.paid, state: 'succeeded' }] : [],
    }),
  );
  orders.set(910, order(910, 60000));

  const items: Item[] = [
    { id: 1, order_id: 500, total: 250000, cancelled_at: null, inventory_committed: false },
    { id: 11, order_id: 900, total: 30000, cancelled_at: null, inventory_committed: false },
    { id: 12, order_id: 900, total: 15000, cancelled_at: null, inventory_committed: false },
    { id: 13, order_id: 900, total: 8000, cancelled_at: new Date(), inventory_committed: false },
    { id: 21, order_id: 910, total: 60000, cancelled_at: null, inventory_committed: false },
  ];
  const charges: Array<Record<string, any>> = options.existing
    ? [{ id: 5, source_order_id: 900, reservation_room_id: 8, origin: 'Restaurante', amount: 45000, ...options.existing }]
    : [];
  const sessions = [
    {
      id: 31,
      order_id: 910,
      closed_at: null,
      paid_at: options.sessionPaid ? new Date() : null,
      table: { name: 'Mesa 4' },
    },
  ];

  const chargesTable = {
    findUnique: jest.fn(async ({ where }: any) => charges.find((c) => c.source_order_id === where.source_order_id) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: 6, ...data, amount: Number(data.amount) };
      charges.push(row);
      return row;
    }),
  };
  const tx = {
    $queryRaw: jest.fn(async (_strings: TemplateStringsArray, id: number) => (orders.has(id) ? [{ id }] : [])),
    orders: {
      findUnique: jest.fn(async ({ where }: any) => {
        const found = orders.get(where.id);
        return found ? { ...found } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(orders.get(where.id)!, data)),
    },
    order_items: {
      findMany: jest.fn(async ({ where }: any) =>
        items.filter((it) => it.order_id === where.order_id && !it.cancelled_at).map((it) => ({ id: it.id })),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const moved = items.filter((it) => where.id.in.includes(it.id) && it.order_id === where.order_id);
        moved.forEach((it) => (it.order_id = data.order_id));
        return { count: moved.length };
      }),
    },
    table_sessions: { update: jest.fn(async ({ where, data }: any) => Object.assign(sessions.find((s) => s.id === where.id)!, data)) },
    lodging_room_charges: chargesTable,
  };
  const prisma = {
    lodging_reservation_rooms: {
      findFirst: jest.fn(async () => ({
        id: 8,
        unit: { code: '101' },
        reservation: {
          id: 1,
          status: options.status ?? 'checked_in',
          customer: { first_name: 'Juan', last_name: 'Pérez' },
          folio: { id: 70, status: 'open', order_id: 500, charges_blocked: options.blocked ?? false },
        },
      })),
    },
    orders: { findFirst: jest.fn(async ({ where }: any) => (orders.has(where.id) ? { id: where.id } : null)) },
    table_sessions: { findFirst: jest.fn(async ({ where }: any) => sessions.find((s) => s.id === where.id) ?? null) },
    lodging_room_charges: chargesTable,
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const orderFlow = {
    // Shared totals rule: Σ active lines.
    recalcOrderTotalsFromActiveLinesInTx: jest.fn(async (_tx: unknown, _order: unknown, id: number) => {
      orders.get(id)!.grand_total = items
        .filter((it) => it.order_id === id && !it.cancelled_at)
        .reduce((s, it) => s + it.total, 0);
    }),
  };
  const orderStockCommit = {
    commitOrderDelivery: jest.fn(async (orderId: number) => {
      items.filter((it) => it.order_id === orderId && !it.cancelled_at).forEach((it) => (it.inventory_committed = true));
      return { totalCost: 12000, committedItemCount: 2 };
    }),
  };
  const stockValidator = { resolveInventoryPolicy: jest.fn(async () => ({ allowOversell: false })) };
  const tableSessions = { closeSession: jest.fn(async () => ({})) };
  const settings = { getSettings: jest.fn(async () => ({ hospitality: {} })) };

  const service = new LodgingRoomChargesService(
    prisma as any,
    orderFlow as any,
    orderStockCommit as any,
    stockValidator as any,
    tableSessions as any,
    settings as any,
  );
  return { service, prisma, tx, orders, items, charges, sessions, orderStockCommit, tableSessions, settings };
}

async function errorOf(promise: Promise<unknown>): Promise<VendixHttpException> {
  try {
    await promise;
  } catch (error) {
    return error as VendixHttpException;
  }
  throw new Error('expected the room charge to fail');
}

describe('LodgingRoomChargesService (H3.6)', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3, user_id: 42 } as any);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(42);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('POS sale', () => {
    it('moves the active lines to the folio, commits stock once and cancels the sale unpaid', async () => {
      const ctx = build();

      const result = await ctx.service.chargeToRoom({ reservation_room_id: 8, order_id: 900 });

      expect(result.message).toBe('Cargado a 101 · Juan Pérez');
      expect(result.origin).toBe('Restaurante');
      expect(result.amount).toBe(45000);
      // Lines (not the voided one) now belong to the folio order, stock committed.
      expect(ctx.items.filter((it) => it.order_id === 500).map((it) => it.id)).toEqual([1, 11, 12]);
      expect(ctx.items.find((it) => it.id === 13)!.order_id).toBe(900);
      expect(ctx.items.filter((it) => [11, 12].includes(it.id)).every((it) => it.inventory_committed)).toBe(true);
      expect(ctx.orderStockCommit.commitOrderDelivery).toHaveBeenCalledTimes(1);
      expect(ctx.orderStockCommit.commitOrderDelivery).toHaveBeenCalledWith(
        900,
        expect.objectContaining({ movementType: 'sale', blockOnInsufficient: true, consumeSerials: true }),
        ctx.tx,
      );
      // Folio grows by the sale; the sale closes at $0 without payment.
      expect(ctx.orders.get(500)!.grand_total).toBe(295000);
      expect(ctx.orders.get(900)!).toMatchObject({ state: 'cancelled', grand_total: 0, payments: [] });
      expect(ctx.charges[0]).toMatchObject({
        folio_id: 70,
        reservation_room_id: 8,
        source_order_id: 900,
        table_session_id: null,
        item_ids: [11, 12],
        created_by_user_id: 42,
      });
      expect(Number(ctx.charges[0].cost_amount)).toBe(12000);
      expect(ctx.tableSessions.closeSession).not.toHaveBeenCalled();
    });

    it('uses the store origin label when it is set', async () => {
      const ctx = build();
      ctx.settings.getSettings.mockResolvedValue({ hospitality: { room_charge_origin: 'Bar' } });

      const result = await ctx.service.chargeToRoom({ reservation_room_id: 8, order_id: 900 });

      expect(result.origin).toBe('Bar');
    });

    it('answers a double click with the same charge and moves nothing again', async () => {
      const ctx = build({ existing: { folio_id: 70 } });

      const result = await ctx.service.chargeToRoom({ reservation_room_id: 8, order_id: 900 });

      expect(result).toMatchObject({ id: 5, message: 'Cargado a 101 · Juan Pérez' });
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
      expect(ctx.orderStockCommit.commitOrderDelivery).not.toHaveBeenCalled();
    });

    it('rejects a sale already charged to another room', async () => {
      const ctx = build({ existing: { folio_id: 99 } });

      const error = await errorOf(ctx.service.chargeToRoom({ reservation_room_id: 8, order_id: 900 }));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_ROOM_CHARGE_001.code);
    });

    it('rejects a sale with payments and keeps it intact', async () => {
      const ctx = build({ paid: 10000 });

      const error = await errorOf(ctx.service.chargeToRoom({ reservation_room_id: 8, order_id: 900 }));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_ROOM_CHARGE_001.code);
      expect(ctx.orderStockCommit.commitOrderDelivery).not.toHaveBeenCalled();
      expect(ctx.orders.get(900)!.state).toBe('draft');
      expect(ctx.items.filter((it) => it.order_id === 900)).toHaveLength(3);
    });

    it('rejects a sale with an order-level discount (it cannot move to the folio)', async () => {
      const ctx = build({ discount: 5000 });

      const error = await errorOf(ctx.service.chargeToRoom({ reservation_room_id: 8, order_id: 900 }));

      expect(error.message).toContain('descuento');
      expect(ctx.orderStockCommit.commitOrderDelivery).not.toHaveBeenCalled();
    });

    it('rejects charging the folio order to itself', async () => {
      const ctx = build();

      const error = await errorOf(ctx.service.chargeToRoom({ reservation_room_id: 8, order_id: 500 }));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_ROOM_CHARGE_001.code);
    });
  });

  describe('table bill', () => {
    it('charges the table to the room with its table as origin and frees the table', async () => {
      const ctx = build();

      const result = await ctx.service.chargeToRoom({ reservation_room_id: 8, table_session_id: 31 });

      expect(result.origin).toBe('Restaurante · Mesa 4');
      expect(result.amount).toBe(60000);
      expect(ctx.items.find((it) => it.id === 21)!.order_id).toBe(500);
      expect(ctx.orders.get(910)!.state).toBe('cancelled');
      expect(ctx.sessions[0].paid_at).toBeInstanceOf(Date);
      expect(ctx.charges[0]).toMatchObject({ table_session_id: 31, source_order_id: 910 });
      expect(ctx.tableSessions.closeSession).toHaveBeenCalledWith(31);
    });

    it('rejects a table already paid', async () => {
      const ctx = build({ sessionPaid: true });

      const error = await errorOf(ctx.service.chargeToRoom({ reservation_room_id: 8, table_session_id: 31 }));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_ROOM_CHARGE_001.code);
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('target room', () => {
    it('rejects a guest with "Cargos bloqueados"', async () => {
      const ctx = build({ blocked: true });

      const error = await errorOf(ctx.service.chargeToRoom({ reservation_room_id: 8, order_id: 900 }));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_ROOM_CHARGE_BLOCKED_001.code);
      expect(error.message).toBe('La habitación 101 tiene los cargos bloqueados');
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a room whose guest is not in house', async () => {
      const ctx = build({ status: 'confirmed' });

      const error = await errorOf(ctx.service.chargeToRoom({ reservation_room_id: 8, order_id: 900 }));

      expect(error.message).toBe('La habitación no tiene un huésped en casa');
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('needs exactly one source', async () => {
      const ctx = build();

      const both = await errorOf(
        ctx.service.chargeToRoom({ reservation_room_id: 8, order_id: 900, table_session_id: 31 }),
      );
      const none = await errorOf(ctx.service.chargeToRoom({ reservation_room_id: 8 }));

      expect(both.errorCode).toBe(ErrorCodes.LODGING_ROOM_CHARGE_001.code);
      expect(none.errorCode).toBe(ErrorCodes.LODGING_ROOM_CHARGE_001.code);
    });
  });

  it('lists only in-house rooms with an open folio', async () => {
    const ctx = build();
    const findMany = jest.fn(async () => [
      {
        id: 8,
        unit: { code: '101' },
        unit_type: { name: 'Doble' },
        reservation: {
          id: 1,
          reservation_number: 'H-0001',
          departure_date: new Date('2026-11-12T00:00:00Z'),
          customer: { first_name: 'Juan', last_name: 'Pérez' },
          folio: { charges_blocked: false },
        },
      },
    ]);
    (ctx.prisma.lodging_reservation_rooms as any).findMany = findMany;

    const rooms = await ctx.service.listInHouseRooms({ search: '101' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cancelled_at: null,
          reservation: { status: 'checked_in', folio: { status: 'open' } },
        }),
      }),
    );
    expect(rooms).toEqual([
      {
        reservation_room_id: 8,
        reservation_id: 1,
        reservation_number: 'H-0001',
        room_code: '101',
        unit_type_name: 'Doble',
        guest_name: 'Juan Pérez',
        departure_date: '2026-11-12',
        charges_blocked: false,
      },
    ]);
  });
});
