import { stayNights } from '../reservations/stay-dates';
import { restrictionViolations, StayRestriction } from './lodging-restriction-validator';

const DOUBLE = { id: 11, name: 'Doble' };
const SUITE = { id: 12, name: 'Suite' };

const rule = (date: string, patch: Partial<StayRestriction>): StayRestriction => ({
  date,
  unit_type_id: null,
  min_stay: null,
  max_stay: null,
  closed_to_arrival: false,
  closed_to_departure: false,
  stop_sell: false,
  ...patch,
});

const check = (
  arrival_date: string,
  departure_date: string,
  rules: StayRestriction[],
  unit_type = DOUBLE,
) =>
  restrictionViolations(
    { arrival_date, departure_date, nights: stayNights(arrival_date, departure_date), unit_type },
    rules,
  );

describe('LodgingRestrictionValidator (H2.3)', () => {
  /** 7-dic "Mín. 3 noches" and 8-dic "Cerrado a la llegada". */
  const LONG_WEEKEND = [
    rule('2026-12-07', { min_stay: 3 }),
    rule('2026-12-08', { closed_to_arrival: true }),
  ];

  it('MLOS se lee en la noche de llegada', () => {
    expect(check('2026-12-07', '2026-12-08', LONG_WEEKEND)).toEqual([
      'Estancia mínima de 3 noches para llegar el 7-dic',
    ]);
    expect(check('2026-12-07', '2026-12-10', LONG_WEEKEND)).toEqual([]);
    // Arriving the day before, the 7-dic minimum does not apply.
    expect(check('2026-12-06', '2026-12-08', LONG_WEEKEND)).toEqual([]);
  });

  it('CTA cierra solo las llegadas de esa fecha', () => {
    expect(check('2026-12-08', '2026-12-09', LONG_WEEKEND)).toEqual([
      'No se admiten llegadas el 8-dic',
    ]);
    // Staying through the 8th (arrived before) is fine.
    expect(check('2026-12-07', '2026-12-11', LONG_WEEKEND)).toEqual([]);
  });

  it('CTD se lee en la fecha de salida', () => {
    const rules = [rule('2026-12-10', { closed_to_departure: true })];
    expect(check('2026-12-08', '2026-12-10', rules)).toEqual(['No se admiten salidas el 10-dic']);
    expect(check('2026-12-08', '2026-12-11', rules)).toEqual([]);
  });

  it('estancia máxima y la regla más restrictiva cuando aplican dos', () => {
    const rules = [
      rule('2026-12-07', { min_stay: 2, max_stay: 5 }),
      rule('2026-12-07', { unit_type_id: 11, min_stay: 4, max_stay: 4 }),
    ];
    expect(check('2026-12-07', '2026-12-10', rules)).toEqual([
      'Estancia mínima de 4 noches para llegar el 7-dic',
    ]);
    expect(check('2026-12-07', '2026-12-12', rules)).toEqual([
      'Estancia máxima de 4 noches para llegar el 7-dic',
    ]);
    // The Suite only has the all-types rule.
    expect(check('2026-12-07', '2026-12-10', rules, SUITE)).toEqual([]);
  });

  it('stop-sell cierra cualquier noche vendida, no la de salida, y solo su tipo', () => {
    const rules = [rule('2026-12-09', { unit_type_id: 11, stop_sell: true })];
    expect(check('2026-12-08', '2026-12-10', rules)).toEqual(['Venta cerrada de Doble el 9-dic']);
    expect(check('2026-12-08', '2026-12-09', rules)).toEqual([]);
    expect(check('2026-12-08', '2026-12-10', rules, SUITE)).toEqual([]);
  });

  it('acumula todos los mensajes', () => {
    const rules = [
      rule('2026-12-08', { min_stay: 2, closed_to_arrival: true }),
      rule('2026-12-09', { closed_to_departure: true }),
    ];
    expect(check('2026-12-08', '2026-12-09', rules)).toEqual([
      'Estancia mínima de 2 noches para llegar el 8-dic',
      'No se admiten llegadas el 8-dic',
      'No se admiten salidas el 9-dic',
    ]);
  });
});
