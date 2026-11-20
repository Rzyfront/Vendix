import { normalizePromotionDate } from './promotion-date.util';
import {
  buildPromotionClock,
  isPromotionEnded,
  promotionDateWindowWhere,
} from '../promotion-schedule.util';

const BOGOTA = 'America/Bogota';

/** Evalúa en memoria el mismo filtro que Prisma aplica en la base. */
function isLive(
  promo: { start_date: Date; end_date: Date | null },
  nowUtc: string,
  tz = BOGOTA,
): boolean {
  const clock = buildPromotionClock(new Date(nowUtc), tz);
  const where = promotionDateWindowWhere(clock);
  const started = promo.start_date <= where.start_date.lte;
  return started && !isPromotionEnded(promo.end_date, clock);
}

describe('normalizePromotionDate (reloj de pared de la tienda)', () => {
  it('fecha sin hora de fin → 23:59:59.999 del día elegido', () => {
    expect(normalizePromotionDate('2026-11-21', 'end', BOGOTA)).toEqual(
      new Date('2026-11-21T23:59:59.999Z'),
    );
  });

  it('fecha sin hora de inicio → 00:00 del día elegido', () => {
    expect(normalizePromotionDate('2026-11-21', 'start', BOGOTA)).toEqual(
      new Date('2026-11-21T00:00:00.000Z'),
    );
  });

  it('ISO con hora y offset se respeta: 15:00 -05:00 es 15:00 en la tienda de Bogotá', () => {
    expect(
      normalizePromotionDate('2026-11-21T15:00:00-05:00', 'end', BOGOTA),
    ).toEqual(new Date('2026-11-21T15:00:00.000Z'));
  });

  it('ISO con otro offset se traduce al reloj de la tienda (mismo instante)', () => {
    // 20:00Z = 15:00 en Bogotá.
    expect(
      normalizePromotionDate('2026-11-21T20:00:00Z', 'start', BOGOTA),
    ).toEqual(new Date('2026-11-21T15:00:00.000Z'));
  });

  it('usa el offset real de la zona (DST), no un -05:00 fijo', () => {
    const tz = 'America/New_York';
    // Verano (EDT, -04:00) e invierno (EST, -05:00): el mismo 15:00 local.
    expect(
      normalizePromotionDate('2026-07-10T15:00:00-04:00', 'end', tz),
    ).toEqual(new Date('2026-07-10T15:00:00.000Z'));
    expect(
      normalizePromotionDate('2026-12-10T15:00:00-05:00', 'end', tz),
    ).toEqual(new Date('2026-12-10T15:00:00.000Z'));
    // Un cliente que mandara -05:00 fijo en verano queda a las 16:00 locales.
    expect(
      normalizePromotionDate('2026-07-10T15:00:00-05:00', 'end', tz),
    ).toEqual(new Date('2026-07-10T16:00:00.000Z'));
  });

  it('fecha y hora sin zona se toma como hora de la tienda', () => {
    expect(normalizePromotionDate('2026-11-21T15:30', 'start', BOGOTA)).toEqual(
      new Date('2026-11-21T15:30:00.000Z'),
    );
  });

  it('medianoche UTC con Z (forma heredada) sigue siendo la fecha de calendario', () => {
    expect(
      normalizePromotionDate('2026-11-21T00:00:00.000Z', 'end', BOGOTA),
    ).toEqual(new Date('2026-11-21T23:59:59.999Z'));
    expect(
      normalizePromotionDate('2026-11-21T00:00:00.000Z', 'start', BOGOTA),
    ).toEqual(new Date('2026-11-21T00:00:00.000Z'));
  });

  it('un fin a las 00:00 exactas cierra el día anterior', () => {
    expect(
      normalizePromotionDate('2026-11-21T00:00:00-05:00', 'end', BOGOTA),
    ).toEqual(new Date('2026-11-20T23:59:59.999Z'));
  });

  it('zona desconocida cae a la zona por defecto en vez de fallar', () => {
    expect(
      normalizePromotionDate('2026-11-21T15:00:00-05:00', 'end', 'Mars/Phobos'),
    ).toEqual(new Date('2026-11-21T15:00:00.000Z'));
  });
});

describe('vigencia de la promoción con las fechas normalizadas', () => {
  const start_date = normalizePromotionDate('2026-11-01', 'start', BOGOTA);

  it('fin "2026-11-21" sigue activa a las 22:00 de Bogotá del 21', () => {
    const promo = {
      start_date,
      end_date: normalizePromotionDate('2026-11-21', 'end', BOGOTA),
    };
    // 19:00 Bogotá del 20 (la hora a la que antes moría) y 22:00 del 21.
    expect(isLive(promo, '2026-11-21T00:00:00Z')).toBe(true);
    expect(isLive(promo, '2026-11-22T03:00:00Z')).toBe(true);
    // 00:00 Bogotá del 22: ya terminó.
    expect(isLive(promo, '2026-11-22T05:00:00Z')).toBe(false);
  });

  it('una promo ya guardada con fin a medianoche (sin re-guardar) también dura todo su día', () => {
    const promo = { start_date, end_date: new Date('2026-11-21T00:00:00Z') };
    expect(isLive(promo, '2026-11-22T03:00:00Z')).toBe(true);
    expect(isLive(promo, '2026-11-22T05:00:00Z')).toBe(false);
  });

  it('end_date null = sin fin', () => {
    expect(isLive({ start_date, end_date: null }, '2030-01-01T00:00:00Z')).toBe(
      true,
    );
  });

  it('con hora de fin deja de aplicar a esa hora de la tienda', () => {
    const promo = {
      start_date,
      end_date: normalizePromotionDate(
        '2026-11-21T15:00:00-05:00',
        'end',
        BOGOTA,
      ),
    };
    expect(isLive(promo, '2026-11-21T19:59:00Z')).toBe(true); // 14:59
    expect(isLive(promo, '2026-11-21T20:01:00Z')).toBe(false); // 15:01
  });

  it('con hora de inicio no aplica antes de esa hora de la tienda', () => {
    const promo = {
      start_date: normalizePromotionDate(
        '2026-11-21T18:00:00-05:00',
        'start',
        BOGOTA,
      ),
      end_date: null,
    };
    expect(isLive(promo, '2026-11-21T22:59:00Z')).toBe(false); // 17:59
    expect(isLive(promo, '2026-11-21T23:00:00Z')).toBe(true); // 18:00
  });
});
