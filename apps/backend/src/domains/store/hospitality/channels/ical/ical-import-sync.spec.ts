import { diffIcalBlocks, parseIcalEvents } from './ical-import-sync';

/** Shape of an Airbnb listing export (all-day events, CRLF, folded lines). */
const AIRBNB = [
  'BEGIN:VCALENDAR',
  'PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 1.0//EN',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTEND;VALUE=DATE:20261113',
  'DTSTART;VALUE=DATE:20261110',
  'UID:1418fb94e984-6a0b2d4e4f4f8e2e3b1d4a2a1c3b5e7f@airbnb.c',
  ' om',
  'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/',
  ' details/HMABC\\nPhone Number (Last 4 Digits): 1234',
  'SUMMARY:Reserved',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTEND;VALUE=DATE:20261202',
  'DTSTART;VALUE=DATE:20261128',
  'UID:7f3c2a1b-airbnb-blocked@airbnb.com',
  'SUMMARY:Airbnb (Not available)',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

describe('parseIcalEvents (H6.2)', () => {
  it('reads all-day events with their UID, unfolding long lines', () => {
    expect(parseIcalEvents(AIRBNB)).toEqual([
      {
        uid: '1418fb94e984-6a0b2d4e4f4f8e2e3b1d4a2a1c3b5e7f@airbnb.com',
        from: '2026-11-10',
        to: '2026-11-13',
      },
      { uid: '7f3c2a1b-airbnb-blocked@airbnb.com', from: '2026-11-28', to: '2026-12-02' },
    ]);
  });

  it('keeps the date of DATE-TIME values, blocks one night without DTEND and keys a missing UID by dates', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20261105T150000Z',
      'DTEND:20261107T110000Z',
      'UID:booking-1',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261120',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    expect(parseIcalEvents(ics)).toEqual([
      { uid: 'booking-1', from: '2026-11-05', to: '2026-11-07' },
      { uid: '2026-11-20/2026-11-21', from: '2026-11-20', to: '2026-11-21' },
    ]);
  });

  it('skips cancelled, undated, invalid and backwards events and repeated UIDs', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT\nUID:a\nSTATUS:CANCELLED\nDTSTART;VALUE=DATE:20261110\nDTEND;VALUE=DATE:20261112\nEND:VEVENT',
      'BEGIN:VEVENT\nUID:b\nSUMMARY:no dates\nEND:VEVENT',
      'BEGIN:VEVENT\nUID:c\nDTSTART;VALUE=DATE:20261340\nEND:VEVENT',
      'BEGIN:VEVENT\nUID:d\nDTSTART;VALUE=DATE:20261112\nDTEND;VALUE=DATE:20261110\nEND:VEVENT',
      'BEGIN:VEVENT\nUID:e\nDTSTART;VALUE=DATE:20261101\nDTEND;VALUE=DATE:20261102\nEND:VEVENT',
      'BEGIN:VEVENT\nUID:e\nDTSTART;VALUE=DATE:20261201\nDTEND;VALUE=DATE:20261202\nEND:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    expect(parseIcalEvents(ics)).toEqual([{ uid: 'e', from: '2026-11-01', to: '2026-11-02' }]);
  });

  it('hashes a UID longer than the column so it still matches on the next sync', () => {
    const long = 'x'.repeat(300);
    const ics = `BEGIN:VEVENT\nUID:${long}\nDTSTART;VALUE=DATE:20261110\nEND:VEVENT`;
    const [first] = parseIcalEvents(ics);
    expect(first.uid).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parseIcalEvents(ics)[0].uid).toBe(first.uid);
  });

  it('returns nothing for a calendar without events', () => {
    expect(parseIcalEvents('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')).toEqual([]);
  });
});

describe('diffIcalBlocks (H6.2)', () => {
  const today = '2026-11-01';

  it('creates new UIDs, moves changed dates, keeps unchanged ones and releases UIDs gone from the feed', () => {
    const diff = diffIcalBlocks(
      [
        { uid: 'same', from: '2026-11-10', to: '2026-11-12' },
        { uid: 'moved', from: '2026-11-20', to: '2026-11-23' },
        { uid: 'new', from: '2026-12-01', to: '2026-12-03' },
      ],
      [
        { id: 1, external_uid: 'same', from: '2026-11-10', to: '2026-11-12' },
        { id: 2, external_uid: 'moved', from: '2026-11-20', to: '2026-11-22' },
        { id: 3, external_uid: 'cancelled', from: '2026-11-15', to: '2026-11-16' },
      ],
      today,
    );
    expect(diff).toEqual({
      create: [{ uid: 'new', from: '2026-12-01', to: '2026-12-03' }],
      update: [{ id: 2, from: '2026-11-20', to: '2026-11-23' }],
      release: [3],
    });
  });

  it('leaves the past alone: ended events are not imported and ended blocks are not released', () => {
    const diff = diffIcalBlocks(
      [{ uid: 'old', from: '2026-10-20', to: '2026-10-25' }],
      [{ id: 4, external_uid: 'gone-past', from: '2026-10-01', to: '2026-10-03' }],
      today,
    );
    expect(diff).toEqual({ create: [], update: [], release: [] });
  });

  it('a stay in progress still counts and an empty feed releases every upcoming block', () => {
    expect(
      diffIcalBlocks([{ uid: 'stay', from: '2026-10-30', to: '2026-11-03' }], [], today).create,
    ).toEqual([{ uid: 'stay', from: '2026-10-30', to: '2026-11-03' }]);
    expect(
      diffIcalBlocks(
        [],
        [
          { id: 5, external_uid: 'stay', from: '2026-10-30', to: '2026-11-03' },
          { id: 6, external_uid: 'later', from: '2026-12-10', to: '2026-12-12' },
        ],
        today,
      ).release,
    ).toEqual([5, 6]);
  });

  it('releases a duplicated block of one UID and a block without UID', () => {
    const diff = diffIcalBlocks(
      [{ uid: 'a', from: '2026-11-10', to: '2026-11-12' }],
      [
        { id: 7, external_uid: 'a', from: '2026-11-10', to: '2026-11-12' },
        { id: 8, external_uid: 'a', from: '2026-11-10', to: '2026-11-12' },
        { id: 9, external_uid: null, from: '2026-11-10', to: '2026-11-12' },
      ],
      today,
    );
    expect(diff).toEqual({ create: [], update: [], release: [8, 9] });
  });
});
