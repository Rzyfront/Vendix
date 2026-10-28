import {
  allotmentHolds,
  allotmentReleaseDate,
  consumedKey,
} from './lodging-allotment-holds';

/**
 * H2.5 — "Viajes X" (customer 90) holds 3 Dobles from 20-dic to 22-dic,
 * released 7 days before each night.
 */
const VIAJES_X = {
  customer_id: 90,
  from_date: '2026-12-20',
  to_date: '2026-12-22',
  rooms: 3,
  release_days: 7,
};
const NIGHTS = [
  '2026-12-19',
  '2026-12-20',
  '2026-12-21',
  '2026-12-22',
  '2026-12-23',
];

describe('allotmentHolds (H2.5 release)', () => {
  it('releases each night 7 days before it', () => {
    expect(allotmentReleaseDate('2026-12-20', 7)).toBe('2026-12-13');
    expect(allotmentReleaseDate('2027-01-03', 7)).toBe('2026-12-27');
    expect(allotmentReleaseDate('2026-12-20', 0)).toBe('2026-12-20');
  });

  it('holds 3 rooms only on the allotment nights while nothing is released', () => {
    const held = allotmentHolds({
      nights: NIGHTS,
      allotments: [VIAJES_X],
      consumed: new Map(),
      today: '2026-12-01',
    });
    expect(held).toEqual([0, 3, 3, 3, 0]);
  });

  it('returns the unused rooms of a night to the public on its release date', () => {
    // 13-dic: the 20-dic night is released; 21 and 22 are still held.
    expect(
      allotmentHolds({
        nights: NIGHTS,
        allotments: [VIAJES_X],
        consumed: new Map(),
        today: '2026-12-13',
      }),
    ).toEqual([0, 0, 3, 3, 0]);
    // The day before the release the night is still held.
    expect(
      allotmentHolds({
        nights: NIGHTS,
        allotments: [VIAJES_X],
        consumed: new Map(),
        today: '2026-12-12',
      }),
    ).toEqual([0, 3, 3, 3, 0]);
    // 15-dic: everything is public again.
    expect(
      allotmentHolds({
        nights: NIGHTS,
        allotments: [VIAJES_X],
        consumed: new Map(),
        today: '2026-12-15',
      }),
    ).toEqual([0, 0, 0, 0, 0]);
  });

  it("the agency's bookings consume the allotment instead of adding to it", () => {
    const consumed = new Map([
      [consumedKey(90, '2026-12-20'), 1],
      [consumedKey(90, '2026-12-21'), 4],
      // Another customer's booking does not consume Viajes X's rooms.
      [consumedKey(77, '2026-12-22'), 2],
    ]);
    expect(
      allotmentHolds({
        nights: NIGHTS,
        allotments: [VIAJES_X],
        consumed,
        today: '2026-12-01',
      }),
    ).toEqual([0, 2, 0, 3, 0]);
  });

  it("leaves out the buyer's own allotments and adds up other customers'", () => {
    const empresa = { ...VIAJES_X, customer_id: 91, rooms: 2, release_days: 0 };
    const input = {
      nights: NIGHTS,
      allotments: [VIAJES_X, empresa],
      consumed: new Map<string, number>(),
      today: '2026-12-01',
    };
    expect(allotmentHolds(input)).toEqual([0, 5, 5, 5, 0]);
    expect(allotmentHolds({ ...input, buyer_customer_id: 90 })).toEqual([
      0, 2, 2, 2, 0,
    ]);
  });
});
