import {
  clampBlockHeight,
  clampBlockTop,
  expandRangeToSpans,
  generateTimeSlots,
  parseClockToMinutes,
  resolveCalendarRange,
  snapRangeToStep,
  storeRangeForDates,
  storeRangeForDay,
} from './calendar-range.util';

describe('calendar-range.util (QUI-977)', () => {
  describe('parseClockToMinutes', () => {
    it('acepta HH:mm, H:mm y variantes con segundos/zona', () => {
      expect(parseClockToMinutes('09:00')).toBe(540);
      expect(parseClockToMinutes('9:30')).toBe(570);
      expect(parseClockToMinutes('08:40:00')).toBe(520);
      expect(parseClockToMinutes('08:40:00.000Z')).toBe(520);
    });

    it('rechaza closed, vacío y valores malformados', () => {
      expect(parseClockToMinutes('closed')).toBeNull();
      expect(parseClockToMinutes('')).toBeNull();
      expect(parseClockToMinutes('xx')).toBeNull();
      expect(parseClockToMinutes('25:00')).toBeNull();
    });
  });

  describe('storeRangeForDay', () => {
    it('une open/close con los bloques', () => {
      expect(
        storeRangeForDay({
          open: '09:00',
          close: '13:00',
          blocks: [{ open: '14:00', close: '18:00' }],
        }),
      ).toEqual({ start: 540, end: 1080 });
    });

    it('ignora closed y usa los bloques abiertos', () => {
      expect(
        storeRangeForDay({
          open: 'closed',
          close: 'closed',
          blocks: [{ open: '10:00', close: '12:00' }],
        }),
      ).toEqual({ start: 600, end: 720 });
    });

    it('devuelve null si el día está cerrado o es desconocido', () => {
      expect(storeRangeForDay({ open: 'closed', close: 'closed' })).toBeNull();
      expect(storeRangeForDay(undefined)).toBeNull();
    });

    it('ignora tramos nocturnos (close <= open)', () => {
      expect(storeRangeForDay({ open: '18:00', close: '02:00' })).toBeNull();
    });
  });

  describe('storeRangeForDates', () => {
    // Lunes 2, martes 3 y miércoles 4 de noviembre de 2026.
    const mon = new Date(2026, 10, 2);
    const tue = new Date(2026, 10, 3);
    const wed = new Date(2026, 10, 4);
    const hours = {
      monday: { open: '09:00', close: '18:00' },
      tuesday: { open: '08:00', close: '20:00' },
      wednesday: { open: 'closed', close: 'closed' },
    };

    it('une los rangos de los días visibles', () => {
      expect(storeRangeForDates(hours, [mon, tue, wed])).toEqual({ start: 480, end: 1200 });
    });

    it('devuelve null si ningún día tiene horario', () => {
      expect(storeRangeForDates(hours, [wed])).toBeNull();
      expect(storeRangeForDates(null, [mon])).toBeNull();
    });
  });

  describe('expandRangeToSpans', () => {
    it('expande para que ninguna cita quede oculta', () => {
      expect(expandRangeToSpans({ start: 540, end: 1080 }, [{ start: '06:30', end: '07:30' }])).toEqual({
        start: 390,
        end: 1080,
      });
      expect(expandRangeToSpans({ start: 540, end: 1080 }, [{ start: '21:00', end: '23:30' }])).toEqual({
        start: 540,
        end: 1410,
      });
    });

    it('deja igual el rango si la cita ya cabe', () => {
      expect(expandRangeToSpans({ start: 540, end: 1080 }, [{ start: '10:00', end: '11:00' }])).toEqual({
        start: 540,
        end: 1080,
      });
    });

    it('ignora inicios inválidos y rescata el inicio aunque el fin degenere', () => {
      expect(expandRangeToSpans({ start: 540, end: 1080 }, [{ start: 'xx', end: '23:00' }])).toEqual({
        start: 540,
        end: 1080,
      });
      expect(expandRangeToSpans({ start: 540, end: 1080 }, [{ start: '05:00', end: '04:00' }])).toEqual({
        start: 300,
        end: 1080,
      });
    });
  });

  describe('snapRangeToStep', () => {
    it('piso al inicio y techo al fin', () => {
      expect(snapRangeToStep({ start: 545, end: 1070 }, 30)).toEqual({ start: 540, end: 1080 });
      expect(snapRangeToStep({ start: 540, end: 1080 }, 30)).toEqual({ start: 540, end: 1080 });
    });
  });

  describe('resolveCalendarRange', () => {
    const mon = new Date(2026, 10, 2);

    it('horario de tienda + cita fuera de horario', () => {
      expect(
        resolveCalendarRange({ monday: { open: '09:00', close: '18:00' } }, [mon], [
          { start: '06:30', end: '07:30' },
        ], 30),
      ).toEqual({ start: 390, end: 1080 });
    });

    it('sin horario cae al legado 07:00–22:00 y también expande a las citas', () => {
      expect(resolveCalendarRange(null, [mon], [], 30)).toEqual({ start: 420, end: 1320 });
      expect(resolveCalendarRange(null, [mon], [{ start: '21:00', end: '23:15' }], 30)).toEqual({
        start: 420,
        end: 1410,
      });
    });
  });

  describe('generateTimeSlots', () => {
    it('genera etiquetas de inicio a fin inclusive', () => {
      expect(generateTimeSlots(540, 600, 30)).toEqual(['09:00', '09:30', '10:00']);
    });

    it('reproduce el legado 07:00–22:00 cada 30 min', () => {
      const legacy = generateTimeSlots(420, 1320, 30);
      expect(legacy.length).toBe(31);
      expect(legacy[0]).toBe('07:00');
      expect(legacy[30]).toBe('22:00');
    });
  });

  describe('clamp', () => {
    it('recorta bloques fuera del rango y deja intactos los visibles', () => {
      expect(clampBlockTop(-50, 30)).toBe(0);
      expect(clampBlockHeight(-50, 30)).toBe(0);
      expect(clampBlockTop(150, 10)).toBe(100);
      expect(clampBlockHeight(150, 10)).toBe(0);
      expect(clampBlockHeight(-25, 50)).toBe(25);
      expect(clampBlockHeight(90, 30)).toBe(10);
      expect(clampBlockTop(20, 10)).toBe(20);
      expect(clampBlockHeight(20, 10)).toBe(10);
    });
  });
});
