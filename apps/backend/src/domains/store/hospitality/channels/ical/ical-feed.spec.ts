import { buildIcalFeed, mergeBusyNights, nightsOfRange } from './ical-feed';

const NOW = new Date('2026-11-01T15:04:05.678Z');

describe('ical-feed (H6.1)', () => {
  describe('mergeBusyNights', () => {
    it('joins consecutive nights into one range with an exclusive end', () => {
      expect(
        mergeBusyNights(['2026-11-12', '2026-11-10', '2026-11-11', '2026-11-11', '2026-11-20']),
      ).toEqual([
        { start: '2026-11-10', end: '2026-11-13' },
        { start: '2026-11-20', end: '2026-11-21' },
      ]);
    });

    it('crosses month and year boundaries', () => {
      expect(mergeBusyNights(['2026-12-31', '2027-01-01'])).toEqual([
        { start: '2026-12-31', end: '2027-01-02' },
      ]);
    });

    it('returns no range without nights', () => {
      expect(mergeBusyNights([])).toEqual([]);
    });
  });

  describe('nightsOfRange', () => {
    it('lists [from, to) clipped to the minimum date', () => {
      expect(nightsOfRange('2026-10-30', '2026-11-03', '2026-11-01')).toEqual([
        '2026-11-01',
        '2026-11-02',
      ]);
      expect(nightsOfRange('2026-10-01', '2026-10-05', '2026-11-01')).toEqual([]);
    });
  });

  describe('buildIcalFeed', () => {
    const feed = buildIcalFeed({
      unit_id: 7,
      calendar_name: 'Habitación 101 · Doble, vista',
      summary: 'No disponible',
      now: NOW,
      nights: ['2026-11-10', '2026-11-11', '2026-11-20'],
    });

    it('is a VCALENDAR with CRLF line endings', () => {
      expect(feed.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
      expect(feed.endsWith('END:VCALENDAR\r\n')).toBe(true);
      expect(feed.replace(/\r\n/g, '')).not.toContain('\n');
    });

    it('writes one all-day event per busy run with a stable UID', () => {
      expect(feed.match(/BEGIN:VEVENT/g)).toHaveLength(2);
      expect(feed).toContain(
        [
          'BEGIN:VEVENT',
          'UID:vendix-unit-7-20261110@vendix',
          'DTSTAMP:20261101T150405Z',
          'DTSTART;VALUE=DATE:20261110',
          'DTEND;VALUE=DATE:20261112',
          'SUMMARY:No disponible',
          'TRANSP:OPAQUE',
          'END:VEVENT',
        ].join('\r\n'),
      );
      expect(feed).toContain('DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121');
    });

    it('escapes text values', () => {
      expect(feed).toContain('X-WR-CALNAME:Habitación 101 · Doble\\, vista');
    });

    it('is an empty calendar when the room has no busy night', () => {
      const empty = buildIcalFeed({ unit_id: 1, calendar_name: 'A', summary: 'B', now: NOW, nights: [] });
      expect(empty).not.toContain('BEGIN:VEVENT');
      expect(empty).toContain('END:VCALENDAR');
    });

    it('folds lines longer than 75 octets', () => {
      const long = buildIcalFeed({
        unit_id: 1,
        calendar_name: 'Ñ'.repeat(80),
        summary: 'B',
        now: NOW,
        nights: [],
      });
      const lines = long.split('\r\n');
      for (const line of lines) {
        expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
      }
      const unfolded = long.replace(/\r\n /g, '');
      expect(unfolded).toContain(`X-WR-CALNAME:${'Ñ'.repeat(80)}`);
    });
  });
});
