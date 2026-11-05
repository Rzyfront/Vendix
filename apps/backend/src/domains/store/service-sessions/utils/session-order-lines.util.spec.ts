import {
  addSessionExtensionLine,
  ensureSessionRentalLine,
  readSessionRentalSnapshot,
  rentalBlocksConsumed,
  rentalBlocksPlanned,
  rentalUnitLabel,
  SessionRentalSnapshot,
} from './session-order-lines.util';

const taxes = { taxRowsForCategory: jest.fn().mockResolvedValue([]) };

const station = {
  name: 'Sala 1',
  rental_block_minutes: 30,
  rental_block_price: 20000,
  rental_tax_category_id: null,
  rental_tax_is_inclusive: true,
  rental_block_unit: 'hour',
};

const snapshot = (overrides: Partial<SessionRentalSnapshot> = {}): SessionRentalSnapshot => ({
  billing_mode: 'planned',
  charge_timing: 'at_end',
  block_minutes: 30,
  block_price: 20000,
  windows: [],
  ...overrides,
});

/** Minimal order_items tx: `findFirst` answers by the `where` shape, so every query stays honest. */
const buildTx = (opts: { foreignRental?: boolean; own?: Record<string, unknown> | null } = {}) => {
  const tx: any = {
    service_stations: { findFirst: jest.fn().mockResolvedValue(station) },
    orders: { findUnique: jest.fn().mockResolvedValue({ total_paid: 0 }) },
    order_items: {
      findFirst: jest.fn((args: any) => {
        if (args?.where?.service_line_kind === 'rental') return Promise.resolve(opts.foreignRental ? { id: 9, service_line_kind: 'rental' } : null);
        return Promise.resolve(opts.own ?? null);
      }),
      create: jest.fn(),
      update: jest.fn(),
    },
    order_item_taxes: { deleteMany: jest.fn() },
  };
  return tx;
};

const opened = new Date('2026-11-05T15:00:00Z');
const at = (minutes: number) => new Date(opened.getTime() + minutes * 60_000);
const base = { storeId: 1, sessionId: 21, orderId: 149, stationId: 9, openedAt: opened };

describe('rentalBlocksPlanned', () => {
  it.each([
    [0, 1],
    [30, 1],
    [31, 2],
    [60, 2],
    [95, 4],
  ])('%i planned minutes with 30-minute blocks → %i blocks', (minutes, blocks) => {
    expect(rentalBlocksPlanned(minutes, 30)).toBe(blocks);
  });
});

describe('readSessionRentalSnapshot', () => {
  it('a NULL billing mode is a legacy session', () => {
    expect(readSessionRentalSnapshot({ rental_billing_mode: null, rental_block_minutes: 30, rental_block_price: 20000 })).toBeNull();
  });

  it('rebuilds mode, timing, block and windows from the columns', () => {
    const windows = [{ weekday: 6, start_time: '20:00', end_time: '23:00', block_price: 50000 }];
    expect(
      readSessionRentalSnapshot({ rental_billing_mode: 'planned', rental_charge_timing: 'at_start', rental_block_minutes: 60, rental_block_price: '80000.00', rate_windows_snapshot: windows }),
    ).toEqual({ billing_mode: 'planned', charge_timing: 'at_start', block_minutes: 60, block_price: 80000, windows });
  });
});

describe('ensureSessionRentalLine — billing mode (S10)', () => {
  it('planned: bills the allocation (2 blocks of 60 min), never the elapsed time (3 h = 6 blocks)', async () => {
    const tx = buildTx();
    const changed = await ensureSessionRentalLine(tx, { ...base, now: at(180), snapshot: snapshot(), plannedMinutes: 60 }, taxes);
    expect(changed).toBe(true);
    expect(tx.order_items.create).toHaveBeenCalledTimes(1);
    const { data } = tx.order_items.create.mock.calls[0][0];
    expect(data).toMatchObject({ order_id: 149, service_session_id: 21, product_id: null, product_name: 'Alquiler Sala 1', quantity: 2, service_line_kind: 'rental' });
    expect(Number(data.unit_price)).toBe(20000);
    expect(Number(data.total_price)).toBe(40000);
  });

  it('planned: passing the end without extending adds nothing (same blocks at 1 h and at 5 h)', async () => {
    const at1h = buildTx({ own: { id: 500, quantity: 2, unit_price: 20000, tax_rate: 0, tax_amount_item: 0, final_unit_price: 20000, cancelled_at: null } });
    const changed = await ensureSessionRentalLine(at1h, { ...base, now: at(300), snapshot: snapshot(), plannedMinutes: 60 }, taxes);
    expect(changed).toBe(false);
    expect(at1h.order_items.update).not.toHaveBeenCalled();
    expect(at1h.order_items.create).not.toHaveBeenCalled();
  });

  it('planned without a known allocation does not bill', async () => {
    const tx = buildTx();
    await expect(ensureSessionRentalLine(tx, { ...base, now: at(60), snapshot: snapshot(), plannedMinutes: null }, taxes)).resolves.toBe(false);
    expect(tx.order_items.create).not.toHaveBeenCalled();
  });

  it('elapsed: keeps billing the elapsed blocks (70 min → 3 blocks) and marks the line as rental', async () => {
    const tx = buildTx();
    await ensureSessionRentalLine(tx, { ...base, now: at(70), snapshot: snapshot({ billing_mode: 'elapsed' }), plannedMinutes: 600 }, taxes);
    const { data } = tx.order_items.create.mock.calls[0][0];
    expect(data.quantity).toBe(rentalBlocksConsumed(opened, at(70), 30));
    expect(data.quantity).toBe(3);
    expect(data.service_line_kind).toBe('rental');
  });

  it('the snapshot rate wins over the live station rate', async () => {
    const tx = buildTx();
    tx.service_stations.findFirst.mockResolvedValue({ ...station, rental_block_price: 99999, rental_block_minutes: 10 });
    await ensureSessionRentalLine(tx, { ...base, now: at(60), snapshot: snapshot(), plannedMinutes: 60 }, taxes);
    const { data } = tx.order_items.create.mock.calls[0][0];
    expect(data.quantity).toBe(2);
    expect(Number(data.unit_price)).toBe(20000);
  });

  it('windows: blocks priced differently collapse into one unit with the exact total', async () => {
    const tx = buildTx();
    // Saturday 2026-11-07 20:00 Bogota = 01:00Z Sunday. Window 20:00-21:00 costs 50.000, the rest the base 20.000.
    const start = new Date('2026-11-08T00:30:00Z');
    const windows = [{ weekday: 6, start_time: '19:30', end_time: '20:00', block_price: 50000 }];
    await ensureSessionRentalLine(
      tx,
      { ...base, openedAt: start, now: start, snapshot: snapshot({ windows }), plannedMinutes: 60, tz: 'America/Bogota' },
      taxes,
    );
    const { data } = tx.order_items.create.mock.calls[0][0];
    // 19:30 block (window) 50.000 + 20:00 block (base) 20.000.
    expect(data.quantity).toBe(1);
    expect(Number(data.unit_price)).toBe(70000);
    expect(Number(data.total_price)).toBe(70000);
  });
});

describe('ensureSessionRentalLine — double-charge guard', () => {
  it('returns false when the order already has a rental line (booking paid online, rental product)', async () => {
    const tx = buildTx({ foreignRental: true });
    await expect(ensureSessionRentalLine(tx, { ...base, now: at(70), snapshot: snapshot({ billing_mode: 'elapsed' }) }, taxes)).resolves.toBe(false);
    expect(tx.order_items.create).not.toHaveBeenCalled();
    expect(tx.order_items.update).not.toHaveBeenCalled();
    // The guard looks the rental up by kind and excludes the own "Alquiler <estación>" line.
    expect(tx.order_items.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ order_id: 149, service_line_kind: 'rental', cancelled_at: null }) }),
    );
  });

  it('keeps the name lookup as the legacy fallback: an old line without kind is recalculated, not duplicated', async () => {
    const tx = buildTx({ own: { id: 500, quantity: 2, unit_price: 20000, tax_rate: 0, tax_amount_item: 0, final_unit_price: 20000, cancelled_at: null } });
    await expect(ensureSessionRentalLine(tx, { ...base, now: at(70) }, taxes)).resolves.toBe(true);
    expect(tx.order_items.create).not.toHaveBeenCalled();
    expect(tx.order_items.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 500 }, data: expect.objectContaining({ quantity: 3 }) }));
  });

  it('legacy (no snapshot): elapsed blocks at the live station rate and no line kind, exactly as before', async () => {
    const tx = buildTx();
    await ensureSessionRentalLine(tx, { ...base, now: at(70) }, taxes);
    const { data } = tx.order_items.create.mock.calls[0][0];
    expect(data.quantity).toBe(3);
    expect(Number(data.unit_price)).toBe(20000);
    expect(data).not.toHaveProperty('service_line_kind');
  });
});

describe('addSessionExtensionLine (S10)', () => {
  const oldEnd = new Date('2026-11-05T16:00:00Z');
  const snap = snapshot({ block_minutes: 60, block_price: 80000 }) as SessionRentalSnapshot & { block_minutes: number; block_price: number };

  it('adds one "Extensión · 1 hora" line: kind extension, no product, qty 1, priced from the old end', async () => {
    const tx = buildTx();
    const charged = await addSessionExtensionLine(
      tx,
      { storeId: 1, sessionId: 21, orderId: 149, stationId: 9, snapshot: snap, oldEnd, newEnd: new Date(oldEnd.getTime() + 60 * 60_000), tz: null, now: oldEnd },
      taxes,
    );
    expect(charged).toEqual({ extra_minutes: 60, blocks: 1, total_cents: 8_000_000 });
    expect(tx.order_items.create).toHaveBeenCalledTimes(1);
    const { data } = tx.order_items.create.mock.calls[0][0];
    expect(data).toMatchObject({ order_id: 149, service_session_id: 21, product_id: null, product_name: 'Extensión · 1 hora', quantity: 1, service_line_kind: 'extension', item_type: 'service' });
    expect(Number(data.total_price)).toBe(80000);
  });

  it('rounds a partial block up and pluralizes: 90 min with 60-min blocks → 2 horas', async () => {
    const tx = buildTx();
    await addSessionExtensionLine(
      tx,
      { storeId: 1, sessionId: 21, orderId: 149, stationId: 9, snapshot: snap, oldEnd, newEnd: new Date(oldEnd.getTime() + 90 * 60_000), tz: null, now: oldEnd },
      taxes,
    );
    const { data } = tx.order_items.create.mock.calls[0][0];
    expect(data.product_name).toBe('Extensión · 2 horas');
    expect(Number(data.total_price)).toBe(160000);
  });

  it('prices the extension blocks over the snapshot windows starting at the OLD end', async () => {
    const tx = buildTx();
    // Old end Saturday 2026-11-07 20:00 Bogota (01:00Z Sunday): window 20:00-21:00 → 120.000.
    const saturdayEnd = new Date('2026-11-08T01:00:00Z');
    const windows = [{ weekday: 6, start_time: '20:00', end_time: '21:00', block_price: 120000 }];
    await addSessionExtensionLine(
      tx,
      { storeId: 1, sessionId: 21, orderId: 149, stationId: 9, snapshot: { ...snap, windows }, oldEnd: saturdayEnd, newEnd: new Date(saturdayEnd.getTime() + 60 * 60_000), tz: 'America/Bogota', now: saturdayEnd },
      taxes,
    );
    expect(Number(tx.order_items.create.mock.calls[0][0].data.total_price)).toBe(120000);
  });

  it('takes the tax from the station category', async () => {
    const tx = buildTx();
    tx.service_stations.findFirst.mockResolvedValue({ ...station, rental_tax_category_id: 3, rental_tax_is_inclusive: false });
    await addSessionExtensionLine(
      tx,
      { storeId: 1, sessionId: 21, orderId: 149, stationId: 9, snapshot: snap, oldEnd, newEnd: new Date(oldEnd.getTime() + 60 * 60_000), tz: null, now: oldEnd },
      taxes,
    );
    expect(taxes.taxRowsForCategory).toHaveBeenLastCalledWith(tx, { tax_category_id: 3, tax_is_inclusive: false, store_id: 1 });
  });
});

describe('rentalUnitLabel', () => {
  it.each([
    ['minute', 1, 'minuto'],
    ['minute', 45, 'minutos'],
    ['hour', 1, 'hora'],
    ['hour', 2, 'horas'],
    ['day', 1, 'día'],
    ['day', 3, 'días'],
  ])('%s × %d → %s', (unit, amount, label) => {
    expect(rentalUnitLabel(unit, amount)).toBe(label);
  });
});
