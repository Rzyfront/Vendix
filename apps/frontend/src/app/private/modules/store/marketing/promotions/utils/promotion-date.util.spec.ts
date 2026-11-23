import {
  buildPromotionDate,
  formatPromotionDate,
  splitPromotionDate,
  storeOffsetForWallClock,
} from './promotion-date.util';

describe('promotion-date.util', () => {
  it('sin hora envía YYYY-MM-DD', () => {
    expect(buildPromotionDate('2026-11-21', '', 'America/Bogota')).toBe('2026-11-21');
    expect(buildPromotionDate('', '15:00', 'America/Bogota')).toBe('');
  });

  it('con hora envía ISO con el offset de la zona de la tienda', () => {
    expect(buildPromotionDate('2026-11-21', '15:00', 'America/Bogota')).toBe(
      '2026-11-21T15:00:00-05:00',
    );
  });

  it('el offset sigue el horario de verano de la zona, no un -05:00 fijo', () => {
    expect(storeOffsetForWallClock('2026-07-10', '15:00', 'America/New_York')).toBe('-04:00');
    expect(storeOffsetForWallClock('2026-12-10', '15:00', 'America/New_York')).toBe('-05:00');
    expect(storeOffsetForWallClock('2026-07-10', '15:00', 'Europe/Madrid')).toBe('+02:00');
  });

  it('zona desconocida: envía la hora sin offset (el backend la toma como hora de tienda)', () => {
    expect(buildPromotionDate('2026-11-21', '15:00', 'Mars/Phobos')).toBe(
      '2026-11-21T15:00:00',
    );
  });

  it('separa fecha y hora leyendo el reloj de la tienda; todo el día = sin hora', () => {
    expect(splitPromotionDate('2026-11-21T00:00:00.000Z', 'start')).toEqual({ date: '2026-11-21', time: '' });
    expect(splitPromotionDate('2026-11-21T23:59:59.999Z', 'end')).toEqual({ date: '2026-11-21', time: '' });
    expect(splitPromotionDate('2026-11-21T00:00:00.000Z', 'end')).toEqual({ date: '2026-11-21', time: '' });
    expect(splitPromotionDate('2026-11-21T15:00:00.000Z', 'end')).toEqual({ date: '2026-11-21', time: '15:00' });
    expect(splitPromotionDate(null, 'end')).toEqual({ date: '', time: '' });
  });

  it('la lista muestra dd/MM/yyyy y agrega la hora solo si existe', () => {
    expect(formatPromotionDate('2026-11-21T23:59:59.999Z', 'end')).toBe('21/11/2026');
    expect(formatPromotionDate('2026-11-21T15:00:00.000Z', 'end')).toBe('21/11/2026 15:00');
    expect(formatPromotionDate('2026-11-20T08:30:00.000Z', 'start')).toBe('20/11/2026 08:30');
    expect(formatPromotionDate(undefined, 'end')).toBe('');
  });
});
