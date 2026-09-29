/**
 * Spec de `date.util.ts` — store-timezone-aware presentation formatters
 * (order-truth-and-invoice-tz-plan, Step 9).
 *
 * `formatStoreDate`/`formatStoreDateTime`/`storeToday` mirror the EXACT
 * bifurcation the backend already applies in `store-timezone.util.ts`'s
 * `fiscalIssueDate`/`formatStoreDate`:
 *   - a value with a real time-of-day is a genuine instant → converted to the
 *     store's local calendar day;
 *   - a value at exact UTC midnight is a civil date stored naively → read back
 *     in UTC verbatim, NEVER re-converted (a negative-offset store like
 *     America/Bogota would otherwise slip it to the previous day — the
 *     "invoice shows the wrong day after 19:00" bug this plan exists to fix).
 *
 * The test instant (`2026-09-26T02:30:00Z` = 25-Sep 21:30 in America/Bogota,
 * UTC-5) and its expected outputs come straight from the plan's Step 8/9
 * verification criteria, so the frontend and backend specs assert the same
 * fixed point.
 */
import {
  formatStoreDate,
  formatStoreDateTime,
  storeToday,
} from './date.util';

const BOGOTA = 'America/Bogota';

describe('date.util — store-timezone formatters', () => {
  describe('formatStoreDate', () => {
    it('converts a real instant to the STORE local calendar day (21:30 in Bogotá, not the UTC day)', () => {
      // 2026-09-26T02:30:00Z carries a real time-of-day → genuine instant.
      expect(formatStoreDate('2026-09-26T02:30:00Z', BOGOTA)).toBe('25/09/2026');
    });

    it('reads an exact UTC-midnight date-only value verbatim, never shifting it to the previous day', () => {
      // Same rule as the backend's fiscalIssueDate: midnight UTC is a civil
      // date written naively, not an instant — converting it with Bogotá's
      // -05:00 offset would wrongly print 24/09/2026.
      expect(formatStoreDate('2026-09-25T00:00:00Z', BOGOTA)).toBe('25/09/2026');
    });

    it('accepts a Date instance as well as an ISO string', () => {
      expect(formatStoreDate(new Date('2026-09-25T00:00:00Z'), BOGOTA)).toBe(
        '25/09/2026',
      );
    });

    it('falls back to America/Bogota-shaped output for an invalid value without throwing', () => {
      expect(formatStoreDate('not-a-date', BOGOTA)).toBe('');
    });
  });

  describe('formatStoreDateTime', () => {
    it('formats a genuine instant as dd/MM/yyyy HH:mm in the store timezone by default', () => {
      // 02:30Z - 5h = 21:30 local on the 25th.
      expect(formatStoreDateTime('2026-09-26T02:30:00Z', BOGOTA)).toBe(
        '25/09/2026 21:30',
      );
    });

    it('honors custom Intl.DateTimeFormatOptions while still sourcing the timezone from the store', () => {
      const out = formatStoreDateTime('2026-09-26T02:30:00Z', BOGOTA, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      // Exact locale punctuation of `Intl` is environment-dependent; assert
      // the parts that prove the STORE offset was applied (25, not 26).
      expect(out).toContain('25');
      expect(out).not.toMatch(/\b26\b/);
    });
  });

  describe('storeToday', () => {
    it('returns the store-local calendar day, not the UTC day, near a day boundary', () => {
      jasmine.clock().install();
      try {
        // 03:00Z - 5h = 22:00 on the 25th in Bogotá — a full day before the UTC date.
        jasmine.clock().mockDate(new Date('2026-09-26T03:00:00Z'));
        expect(storeToday(BOGOTA)).toBe('2026-09-25');
      } finally {
        jasmine.clock().uninstall();
      }
    });
  });
});
