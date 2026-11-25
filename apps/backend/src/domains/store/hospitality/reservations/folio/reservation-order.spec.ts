import { RequestContextService } from '@common/context/request-context.service';
import { LodgingFolioService, NIGHT_NOT_SLEPT_REASON, NIGHT_NOT_SOLD_REASON } from './folio.service';
import { nightLineDescription } from './folio-nights';

/**
 * QUI-1063 — the order a confirmed reservation is born with: created once,
 * kept in step with the nights it sells and cancelled with the reservation.
 * Store 3, Bogotá; "today" is 10-nov.
 */

interface Night {
  id: number;
  night_date: Date;
  is_active: boolean;
  posted_order_item_id: number | null;
  room_cancelled: boolean;
  unit_code: string | null;
  type_name: string;
  product_id: number;
}

interface Line {
  id: number;
  order_id: number;
  product_id: number;
  description: string;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
}

function build(
  options: { status?: string; folio?: boolean; paid?: number; closedDays?: string[]; inHouse?: boolean } = {},
) {
  const day = (d: string) => new Date(`${d}T00:00:00Z`);
  const folios: Array<{ id: number; store_id: number; reservation_id: number; order_id: number; status: string }> =
    options.folio
      ? [{ id: 70, store_id: 3, reservation_id: 1, order_id: 500, status: 'open' }]
      : [];
  const orders: Array<Record<string, any>> = options.folio
    ? [{ id: 500, store_id: 3, state: 'draft', total_paid: options.paid ?? 0, payments: [] }]
    : [];
  const nights: Night[] = [];
  const lines: Line[] = [];
  const closedDays = options.closedDays ?? [];

  const tx = {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async () => [{ id: 500 }]),
    lodging_folios: {
      findFirst: jest.fn(async ({ where }: any) => {
        const folio = folios.find(
          (f) =>
            (where.id === undefined || f.id === where.id) &&
            (where.reservation_id === undefined || f.reservation_id === where.reservation_id) &&
            (where.store_id === undefined || f.store_id === where.store_id) &&
            (where.status === undefined || f.status === where.status),
        );
        return folio ? { ...folio, charges_blocked: false, verified_at: null, verified_total: null, closed_at: null } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const folio = { id: 70 + folios.length, status: 'open', ...data };
        folios.push(folio);
        return { id: folio.id };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        Object.assign(folios.find((f) => f.id === where.id)!, data);
        return {};
      }),
    },
    lodging_reservations: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.store_id === 3 && where.status.in.includes(options.status ?? 'confirmed')
          ? { reservation_number: 'H-0001', customer_id: 9 }
          : null,
      ),
    },
    orders: {
      create: jest.fn(async ({ data }: any) => {
        const order = { id: 500 + orders.length, payments: [], ...data };
        orders.push(order);
        return { id: order.id };
      }),
      findFirst: jest.fn(async ({ where }: any) =>
        orders.find((o) => o.id === where.id && o.store_id === where.store_id) ?? null,
      ),
      findUnique: jest.fn(async ({ where }: any) => orders.find((o) => o.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        Object.assign(orders.find((o) => o.id === where.id)!, data);
        return {};
      }),
    },
    lodging_room_nights: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const night = nights.find((n) => n.id === where.id && n.posted_order_item_id === where.posted_order_item_id);
        if (!night) return { count: 0 };
        night.posted_order_item_id = data.posted_order_item_id;
        return { count: 1 };
      }),
    },
    order_items: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const line = lines.find((l) => l.id === where.id && l.order_id === where.order_id && !l.cancelled_at);
        if (!line) return { count: 0 };
        Object.assign(line, data);
        return { count: 1 };
      }),
    },
  };
  const prisma = {
    ...tx,
    // The reservation as the store-scoped client reads it (status only).
    lodging_reservations: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.status ? tx.lodging_reservations.findFirst({ where }) : { status: options.inHouse === false ? 'confirmed' : 'checked_in' },
      ),
    },
    store_settings: {
      findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })),
    },
    lodging_night_audits: {
      findMany: jest.fn(async () => closedDays.map((d) => ({ business_date: day(d) }))),
    },
    lodging_room_nights: {
      ...tx.lodging_room_nights,
      findMany: jest.fn(async ({ where }: any) =>
        nights
          .filter((n) => {
            const line = lines.find((l) => l.id === n.posted_order_item_id);
            return line && !line.cancelled_at && n.night_date >= where.night_date.gte;
          })
          .map((n) => ({
            id: n.id,
            night_date: n.night_date,
            is_active: n.is_active,
            posted_order_item_id: n.posted_order_item_id,
            reservation_room: { cancelled_at: n.room_cancelled ? new Date() : null },
            unit: n.unit_code ? { code: n.unit_code } : null,
            unit_type: { name: n.type_name, product: { id: n.product_id } },
            posted_order_item: lines.find((l) => l.id === n.posted_order_item_id)!,
          })),
      ),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const orderFlow = { recalcOrderTotalsFromActiveLinesInTx: jest.fn(async () => undefined) };
  const settings = { getStoreCurrency: jest.fn(async () => 'COP') };
  const service = new LodgingFolioService(
    prisma as any,
    orderFlow as any,
    {} as any,
    {} as any,
    {} as any,
    settings as any,
    { emit: jest.fn() } as any,
    {} as any,
  );
  const postNights = jest.spyOn(service, 'postNightsThrough').mockResolvedValue(0);

  /** A night posted on the folio order with its line. */
  const posted = (night: Partial<Night> & { id: number; date: string }) => {
    const line: Line = {
      id: 1000 + night.id,
      order_id: 500,
      product_id: 900,
      // Posted while the room was 101.
      description: nightLineDescription(night.date, night.type_name ?? 'Doble', '101'),
      cancelled_at: null,
      cancellation_reason: null,
    };
    lines.push(line);
    nights.push({
      is_active: true,
      room_cancelled: false,
      unit_code: '101',
      type_name: 'Doble',
      product_id: 900,
      ...night,
      night_date: day(night.date),
      posted_order_item_id: line.id,
    });
    return line;
  };
  return { service, prisma, tx, folios, orders, nights, lines, orderFlow, postNights, posted };
}

const FOLIO = { id: 70, status: 'open', reservation_id: 1, order_id: 500 };

describe('Reservation order (QUI-1063)', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3, user_id: 42 } as any);
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    // 10-nov 10:00 in Bogotá.
    jest.setSystemTime(new Date('2026-11-10T15:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('confirming creates the order', () => {
    it('a confirmed reservation gets one draft order F-H-0001 of its holder and its folio, then the stay is posted', async () => {
      const { service, orders, folios, postNights, tx } = build();

      const folio = await service.ensureReservationOrder(1);

      expect(orders).toHaveLength(1);
      expect(orders[0]).toMatchObject({
        store_id: 3,
        customer_id: 9,
        order_number: 'F-H-0001',
        state: 'draft',
        channel: 'pos',
        currency: 'COP',
      });
      expect(folios).toEqual([expect.objectContaining({ store_id: 3, reservation_id: 1, order_id: orders[0].id })]);
      expect(folio).toMatchObject({ reservation_id: 1, order_id: orders[0].id });
      // The whole stay goes on the order, not only the nights already due.
      expect(postNights).toHaveBeenCalledWith(expect.objectContaining({ order_id: orders[0].id }), '9999-12-31', true);
      // Store isolation: the reservation is read and locked in its own store.
      expect(tx.lodging_reservations.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 1, store_id: 3 }) }),
      );
    });

    it('confirming twice (double click, check-in later) keeps one order', async () => {
      const { service, orders, folios } = build();

      await service.ensureReservationOrder(1);
      await service.ensureReservationOrder(1);

      expect(orders).toHaveLength(1);
      expect(folios).toHaveLength(1);
    });

    it('a tentative web hold gets no order', async () => {
      const { service, orders, postNights } = build({ status: 'tentative' });

      const folio = await service.ensureReservationOrder(1);

      expect(folio).toBeNull();
      expect(orders).toHaveLength(0);
      expect(postNights).not.toHaveBeenCalled();
    });
  });

  describe('the order follows the nights sold', () => {
    it('a night no longer sold leaves the order with its reason and can be posted again later', async () => {
      const { service, posted, nights, orderFlow } = build({ folio: true });
      posted({ id: 1, date: '2026-11-12' });
      const dropped = posted({ id: 2, date: '2026-11-13', is_active: false });

      await service.syncStayNights(FOLIO);

      expect(dropped).toMatchObject({ cancellation_reason: NIGHT_NOT_SOLD_REASON });
      expect(dropped.cancelled_at).toBeInstanceOf(Date);
      expect(nights[1].posted_order_item_id).toBeNull();
      expect(nights[0].posted_order_item_id).toBe(1001);
      expect(orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledTimes(1);
    });

    it('a room of another type re-prices the night: the old line is voided so it is posted at the new rate', async () => {
      const { service, posted, nights } = build({ folio: true });
      const line = posted({ id: 1, date: '2026-11-12', product_id: 901, type_name: 'Suite' });

      await service.syncStayNights(FOLIO);

      expect(line.cancelled_at).toBeInstanceOf(Date);
      expect(nights[0].posted_order_item_id).toBeNull();
    });

    it('a new room number of the same type only relabels the line (same price, no void)', async () => {
      const { service, posted, orderFlow } = build({ folio: true });
      const line = posted({ id: 1, date: '2026-11-12', unit_code: '102' });

      await service.syncStayNights(FOLIO);

      expect(line.cancelled_at).toBeNull();
      expect(line.description).toBe('Noche 12-nov · Doble · 102');
      expect(orderFlow.recalcOrderTotalsFromActiveLinesInTx).not.toHaveBeenCalled();
    });

    it('a night of a closed business day is never touched', async () => {
      const { service, posted } = build({ folio: true, closedDays: ['2026-11-12'] });
      const line = posted({ id: 1, date: '2026-11-12', is_active: false });

      await service.syncStayNights(FOLIO);

      expect(line.cancelled_at).toBeNull();
    });

    it('early departure: the nights from today on leave the folio; the nights slept stay', async () => {
      const { service, posted, nights } = build({ folio: true });
      const tonight = posted({ id: 2, date: '2026-11-10' });
      const tomorrow = posted({ id: 3, date: '2026-11-11' });

      const released = await service.releaseUnsleptNights(FOLIO);

      expect(released).toBe(2);
      expect(tonight).toMatchObject({ cancellation_reason: NIGHT_NOT_SLEPT_REASON });
      expect(tomorrow).toMatchObject({ cancellation_reason: NIGHT_NOT_SLEPT_REASON });
      expect(nights.every((n) => n.posted_order_item_id === null)).toBe(true);
    });

    it('a confirmed stay (guest not in house) never loses its nights as "unslept"', async () => {
      const { service, posted } = build({ folio: true, inHouse: false });
      const line = posted({ id: 2, date: '2026-11-10' });

      expect(await service.releaseUnsleptNights(FOLIO)).toBe(0);
      expect(line.cancelled_at).toBeNull();
    });

    it('a closed folio is not synced', async () => {
      const { service, posted, postNights } = build({ folio: true });
      const line = posted({ id: 1, date: '2026-11-12', is_active: false });

      expect(await service.syncStayNights({ ...FOLIO, status: 'closed' })).toBe(0);
      expect(line.cancelled_at).toBeNull();
      expect(postNights).not.toHaveBeenCalled();
    });
  });

  describe('cancelling the reservation', () => {
    it('cancelled or no-show: the order stays in Orders as "Cancelada" and the folio closes', async () => {
      const { tx, orders, folios } = build({ folio: true });
      const now = new Date();

      const done = await LodgingFolioService.cancelReservationFolioInTx(tx as any, {
        store_id: 3,
        reservation_id: 1,
        reason: 'Cliente desistió',
        now,
      });

      expect(done).toBe(true);
      expect(orders[0]).toMatchObject({ state: 'cancelled', remaining_balance: 0 });
      expect(orders[0].internal_notes).toBe('Reserva cancelada: Cliente desistió');
      expect(folios[0]).toMatchObject({ status: 'closed', closed_at: now });
    });

    it('an order with money on it is left for the desk', async () => {
      const { tx, orders, folios } = build({ folio: true, paid: 50000 });

      const done = await LodgingFolioService.cancelReservationFolioInTx(tx as any, {
        store_id: 3,
        reservation_id: 1,
        reason: null,
        now: new Date(),
      });

      expect(done).toBe(false);
      expect(orders[0].state).toBe('draft');
      expect(folios[0].status).toBe('open');
    });

    it('a reservation without an order (confirmed before this change) is a no-op', async () => {
      const { tx } = build();

      const done = await LodgingFolioService.cancelReservationFolioInTx(tx as any, {
        store_id: 3,
        reservation_id: 1,
        reason: null,
        now: new Date(),
      });

      expect(done).toBe(false);
      expect(tx.orders.update).not.toHaveBeenCalled();
    });

    it('never reaches another store: the folio is looked up in the reservation store', async () => {
      const { tx } = build({ folio: true });

      const done = await LodgingFolioService.cancelReservationFolioInTx(tx as any, {
        store_id: 4,
        reservation_id: 1,
        reason: null,
        now: new Date(),
      });

      expect(done).toBe(false);
      expect(tx.orders.update).not.toHaveBeenCalled();
    });
  });
});
