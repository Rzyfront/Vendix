import { priceToCents, quoteBlocks, validateRateWindows, RateWindow } from './rate-window.util';

const TZ = 'America/Bogota'; // UTC-5, no DST
// Local wall-clock (Bogota) -> UTC instant.
const bogota = (iso: string) => new Date(`${iso}-05:00`);

const win = (over: Partial<RateWindow> & Pick<RateWindow, 'weekday' | 'start_time' | 'end_time' | 'block_price'>): RateWindow => ({
  id: 1,
  is_active: true,
  ...over,
});

describe('rate-window.util', () => {
  describe('priceToCents', () => {
    it('rounds to integer cents', () => {
      expect(priceToCents(33333.335)).toBe(3333334);
      expect(priceToCents('80000')).toBe(8000000);
      expect(priceToCents(0)).toBe(0);
    });
  });

  describe('quoteBlocks', () => {
    // 2026-11-07 is a Saturday, 2026-11-06 is a Friday.
    it('prices a block at the window where it starts', () => {
      const windows = [win({ id: 7, weekday: 6, start_time: '18:00', end_time: '23:00', block_price: 100000 })];
      const r = quoteBlocks({ startAt: bogota('2026-11-07T20:00:00'), blockMinutes: 60, blocks: 1, windows, basePrice: 80000, tz: TZ });
      expect(r.cents).toBe(10000000);
      expect(r.perBlock).toEqual([{ startAt: bogota('2026-11-07T20:00:00'), cents: 10000000, windowId: 7 }]);
    });

    it('falls back to the base price when no window matches', () => {
      const windows = [win({ weekday: 6, start_time: '18:00', end_time: '23:00', block_price: 100000 })];
      const r = quoteBlocks({ startAt: bogota('2026-11-07T10:00:00'), blockMinutes: 60, blocks: 2, windows, basePrice: 80000, tz: TZ });
      expect(r.cents).toBe(16000000);
      expect(r.perBlock.map((b) => b.windowId)).toEqual([null, null]);
    });

    it('prices each block of a multi-block rental by its own start (crossing two windows)', () => {
      const windows = [win({ id: 3, weekday: 6, start_time: '20:00', end_time: '23:00', block_price: 100000 })];
      // Blocks start 19:00 (base), 20:00 (window), 21:00 (window).
      const r = quoteBlocks({ startAt: bogota('2026-11-07T19:00:00'), blockMinutes: 60, blocks: 3, windows, basePrice: 80000, tz: TZ });
      expect(r.perBlock.map((b) => b.cents)).toEqual([8000000, 10000000, 10000000]);
      expect(r.cents).toBe(28000000);
    });

    it('does not split a block that straddles a window boundary', () => {
      const windows = [win({ id: 3, weekday: 6, start_time: '20:00', end_time: '23:00', block_price: 100000 })];
      const r = quoteBlocks({ startAt: bogota('2026-11-07T19:30:00'), blockMinutes: 60, blocks: 1, windows, basePrice: 80000, tz: TZ });
      expect(r.cents).toBe(8000000);
    });

    it('prices the early minutes after midnight by the previous weekday overnight window', () => {
      // Friday 22:00 -> 04:00 spills into Saturday.
      const windows = [win({ id: 9, weekday: 5, start_time: '22:00', end_time: '04:00', block_price: 150000 })];
      const r = quoteBlocks({ startAt: bogota('2026-11-07T01:00:00'), blockMinutes: 60, blocks: 1, windows, basePrice: 80000, tz: TZ });
      expect(r.perBlock[0]).toMatchObject({ cents: 15000000, windowId: 9 });
      // Saturday 04:00 is outside (exclusive end).
      const after = quoteBlocks({ startAt: bogota('2026-11-07T04:00:00'), blockMinutes: 60, blocks: 1, windows, basePrice: 80000, tz: TZ });
      expect(after.perBlock[0]).toMatchObject({ cents: 8000000, windowId: null });
    });

    it('prices a rental that crosses midnight: blocks before and after the day change', () => {
      const windows = [win({ id: 9, weekday: 5, start_time: '22:00', end_time: '04:00', block_price: 150000 })];
      const r = quoteBlocks({ startAt: bogota('2026-11-06T23:00:00'), blockMinutes: 60, blocks: 3, windows, basePrice: 80000, tz: TZ });
      expect(r.perBlock.map((b) => b.windowId)).toEqual([9, 9, 9]);
      expect(r.cents).toBe(45000000);
    });

    it('uses the store timezone weekday, not the UTC one', () => {
      // Friday 21:00 Bogota = Saturday 02:00Z. The Friday window must apply.
      const windows = [
        win({ id: 1, weekday: 5, start_time: '20:00', end_time: '23:00', block_price: 120000 }),
        win({ id: 2, weekday: 6, start_time: '00:00', end_time: '06:00', block_price: 50000 }),
      ];
      const startAt = new Date('2026-11-07T02:00:00Z');
      const r = quoteBlocks({ startAt, blockMinutes: 60, blocks: 1, windows, basePrice: 80000, tz: TZ });
      expect(r.perBlock[0]).toMatchObject({ windowId: 1, cents: 12000000 });
    });

    it('ignores inactive windows', () => {
      const windows = [win({ weekday: 6, start_time: '18:00', end_time: '23:00', block_price: 100000, is_active: false })];
      const r = quoteBlocks({ startAt: bogota('2026-11-07T20:00:00'), blockMinutes: 60, blocks: 1, windows, basePrice: 80000, tz: TZ });
      expect(r.cents).toBe(8000000);
    });

    it('rounds every block to integer cents before summing', () => {
      const windows = [win({ weekday: 6, start_time: '00:00', end_time: '23:59', block_price: '33333.335' as any })];
      const r = quoteBlocks({ startAt: bogota('2026-11-07T10:00:00'), blockMinutes: 60, blocks: 3, windows, basePrice: 0, tz: TZ });
      expect(r.perBlock.map((b) => b.cents)).toEqual([3333334, 3333334, 3333334]);
      expect(r.cents).toBe(10000002);
    });

    it('returns zero for zero blocks', () => {
      const r = quoteBlocks({ startAt: bogota('2026-11-07T10:00:00'), blockMinutes: 60, blocks: 0, windows: [], basePrice: 10, tz: TZ });
      expect(r).toEqual({ cents: 0, perBlock: [] });
    });
  });

  describe('validateRateWindows', () => {
    it('accepts overnight windows', () => {
      expect(validateRateWindows([{ weekday: 5, start_time: '22:00', end_time: '04:00' }])).toBeNull();
    });
    it('rejects overlaps, including the previous day spill', () => {
      expect(
        validateRateWindows([
          { weekday: 5, start_time: '22:00', end_time: '04:00' },
          { weekday: 6, start_time: '03:00', end_time: '05:00' },
        ]),
      ).toEqual({ day: 6, reason: 'overlap' });
    });
    it('rejects a bad HH:MM', () => {
      expect(validateRateWindows([{ weekday: 1, start_time: '25:00', end_time: '04:00' }])).toEqual({ day: 1, reason: 'format' });
    });
  });
});
