import { VendixHttpException } from '@common/errors';
import { buildRack, rackNights, RackRoomInput, RackUnitInput } from './rack-builder';

const d = (date: string) => new Date(`${date}T00:00:00.000Z`);

const TYPES = [
  { id: 1, name: 'Doble estándar', overbooking_allowance: 0 },
  { id: 2, name: 'Suite', overbooking_allowance: 0 },
];

const unit = (id: number, unit_type_id: number, code: string, is_active = true): RackUnitInput => ({
  id,
  unit_type_id,
  code,
  floor: null,
  housekeeping_status: 'clean',
  is_active,
});

const UNITS = [unit(101, 1, '101'), unit(102, 1, '102'), unit(201, 2, '201')];

let nextId = 1;
const room = (
  unit_type_id: number,
  unit_id: number | null,
  arrival: string,
  departure: string,
  status: RackRoomInput['reservation']['status'] = 'confirmed',
): RackRoomInput => {
  const id = nextId++;
  return {
    id,
    unit_type_id,
    unit_id,
    arrival_date: d(arrival),
    departure_date: d(departure),
    reservation: {
      id: 100 + id,
      reservation_number: `H-${String(id).padStart(4, '0')}`,
      status,
      customer: { first_name: 'Juan', last_name: 'Pérez' },
    },
  };
};

const rack = (rooms: RackRoomInput[], sold = [] as { unit_type_id: number; night_date: Date; count: number }[]) =>
  buildRack({ from: '2026-11-10', to: '2026-11-24', types: TYPES, units: UNITS, rooms, sold });

describe('rack builder (H1.3)', () => {
  it('columns are the nights [from, to): the end night is not shown', () => {
    const nights = rackNights('2026-11-10', '2026-11-24');
    expect(nights).toHaveLength(14);
    expect(nights[0]).toBe('2026-11-10');
    expect(nights[13]).toBe('2026-11-23');
    expect(rackNights('2026-11-28', '2026-12-02')).toEqual([
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
    ]);
  });

  it('rejects an empty, inverted or wider than 62 nights window', () => {
    expect(() => rackNights('2026-11-10', '2026-11-10')).toThrow(VendixHttpException);
    expect(() => rackNights('2026-11-10', '2026-11-01')).toThrow(VendixHttpException);
    expect(() => rackNights('2026-11-01', '2027-01-03')).toThrow(VendixHttpException);
    expect(rackNights('2026-11-01', '2027-01-02')).toHaveLength(62);
  });

  it('rows are rooms grouped by type, with the guest name on each bar', () => {
    const r = rack([room(1, 102, '2026-11-12', '2026-11-15')]);
    expect(r.types.map((t) => [t.name, t.units.map((u) => u.code)])).toEqual([
      ['Doble estándar', ['101', '102']],
      ['Suite', ['201']],
    ]);
    const [bar] = r.types[0].bars;
    expect(bar).toMatchObject({
      guest: 'Juan Pérez',
      unit_id: 102,
      status: 'confirmed',
      start: 2,
      span: 3,
      continues_before: false,
      continues_after: false,
    });
    expect(r.types[1].bars).toEqual([]);
  });

  it('clips a stay that started before the window and flags it', () => {
    const [bar] = rack([room(1, 101, '2026-11-05', '2026-11-12')]).types[0].bars;
    expect(bar).toMatchObject({ start: 0, span: 2, continues_before: true, continues_after: false });
  });

  it('clips a stay that goes on after the window and flags it', () => {
    const [bar] = rack([room(1, 101, '2026-11-20', '2026-11-30')]).types[0].bars;
    expect(bar).toMatchObject({ start: 10, span: 4, continues_before: false, continues_after: true });
  });

  it('a stay spanning the whole window is clipped on both edges', () => {
    const [bar] = rack([room(1, 101, '2026-11-01', '2026-12-01')]).types[0].bars;
    expect(bar).toMatchObject({ start: 0, span: 14, continues_before: true, continues_after: true });
  });

  it('drops stays leaving on the first night or arriving on the end night', () => {
    const r = rack([
      room(1, 101, '2026-11-08', '2026-11-10'),
      room(1, 101, '2026-11-24', '2026-11-26'),
    ]);
    expect(r.types[0].bars).toEqual([]);
  });

  it('unassigned stays stack in the fewest lanes of their type', () => {
    const r = rack([
      room(1, null, '2026-11-10', '2026-11-13'),
      room(1, null, '2026-11-11', '2026-11-12'),
      // Starts the night the first one leaves: reuses lane 0.
      room(1, null, '2026-11-13', '2026-11-15'),
      room(1, 101, '2026-11-10', '2026-11-20'),
    ]);
    const type = r.types[0];
    expect(type.unassigned_lanes).toBe(2);
    expect(type.bars.filter((b) => b.unit_id === null).map((b) => [b.start, b.lane])).toEqual([
      [0, 0],
      [1, 1],
      [3, 0],
    ]);
    expect(type.bars.find((b) => b.unit_id === 101)?.lane).toBe(0);
    expect(r.types[1].unassigned_lanes).toBe(0);
  });

  it('free rooms per night = active rooms - sold nights, never below zero', () => {
    const r = rack([], [
      { unit_type_id: 1, night_date: d('2026-11-10'), count: 1 },
      { unit_type_id: 1, night_date: d('2026-11-11'), count: 3 },
      { unit_type_id: 2, night_date: d('2026-11-23'), count: 1 },
      // Outside the window: ignored.
      { unit_type_id: 1, night_date: d('2026-11-24'), count: 2 },
    ]);
    expect(r.types[0].free.slice(0, 3)).toEqual([1, 0, 2]);
    expect(r.types[0].free[13]).toBe(2);
    expect(r.types[1].free[13]).toBe(0);
  });

  it('H1.6 overbooking: 3 sold of 2 rooms with allowance 1 shows sold above capacity and 0 free', () => {
    const r = buildRack({
      from: '2026-11-10',
      to: '2026-11-13',
      types: [{ id: 1, name: 'Doble estándar', overbooking_allowance: 1 }],
      units: UNITS,
      rooms: [],
      sold: [
        { unit_type_id: 1, night_date: d('2026-11-10'), count: 3 },
        { unit_type_id: 1, night_date: d('2026-11-11'), count: 2 },
      ],
    });
    const type = r.types[0];
    expect(type.capacity).toBe(2);
    expect(type.overbooking_allowance).toBe(1);
    expect(type.sold).toEqual([3, 2, 0]);
    expect(type.free).toEqual([0, 1, 3]);
  });

  it('inactive rooms are listed but do not count as free', () => {
    const r = buildRack({
      from: '2026-11-10',
      to: '2026-11-11',
      types: TYPES,
      units: [...UNITS, unit(103, 1, '103', false)],
      rooms: [],
      sold: [],
    });
    expect(r.types[0].units.map((u) => u.code)).toEqual(['101', '102', '103']);
    expect(r.types[0].free).toEqual([2]);
  });
});
