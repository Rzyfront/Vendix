import {
  WeekHoursDay,
  applyPreset,
  copyDay,
  daySegments,
  endsNextDay,
  formatTime12,
  summarizeWeek,
  timeOptions,
  validateWeek,
  weekFromBlockRows,
  weekFromPosHours,
  weekFromStoreRows,
  weekToBlockRows,
  weekToPosHours,
  weekToStoreRows,
} from './weekly-hours.util';

const day = (week: WeekHoursDay[], dow: number) => week.find((d) => d.day_of_week === dow)!;

describe('weekly-hours.util (one schedule editor: store, Ajustes → Venta, providers)', () => {
  const storeRows = [
    { day_of_week: 1, start_time: '17:00', end_time: '04:00', is_active: true },
    { day_of_week: 3, start_time: '00:00', end_time: '00:00', is_active: true },
    { day_of_week: 4, start_time: '00:00', end_time: '00:00', is_active: true },
    {
      day_of_week: 5,
      start_time: '08:00',
      end_time: '18:00',
      is_active: true,
      blocks: [
        { start_time: '14:00', end_time: '18:00' },
        { start_time: '08:00', end_time: '12:00' },
      ],
    },
    { day_of_week: 0, start_time: null, end_time: null, is_active: false },
  ];

  describe('store rows (Agenda → Horario de la tienda)', () => {
    it('reads night shifts, 24 h days, split shifts and closed days, Monday first', () => {
      const week = weekFromStoreRows(storeRows);
      expect(week.map((d) => d.day_of_week)).toEqual([1, 2, 3, 4, 5, 6, 0]);
      expect(day(week, 1)).toEqual({
        day_of_week: 1,
        is_active: true,
        is_24h: false,
        blocks: [{ start_time: '17:00', end_time: '04:00' }],
      });
      expect(day(week, 3).is_24h).toBeTrue();
      expect(day(week, 5).blocks.map((b) => b.start_time)).toEqual(['08:00', '14:00']);
      expect(day(week, 0).is_active).toBeFalse();
      expect(day(week, 2).is_active).toBeFalse();
    });

    it('sends every day, 24 h as 00:00-00:00 and split shifts as blocks (same payload as before)', () => {
      const payload = weekToStoreRows(weekFromStoreRows(storeRows));
      expect(payload.length).toBe(7);
      expect(payload.find((p) => p.day_of_week === 3)).toEqual({
        day_of_week: 3,
        start_time: '00:00',
        end_time: '00:00',
        is_active: true,
      });
      expect(payload.find((p) => p.day_of_week === 5)).toEqual({
        day_of_week: 5,
        start_time: '08:00',
        end_time: '18:00',
        is_active: true,
        blocks: [
          { start_time: '08:00', end_time: '12:00' },
          { start_time: '14:00', end_time: '18:00' },
        ],
      });
      expect(payload.find((p) => p.day_of_week === 0)?.is_active).toBeFalse();
    });
  });

  describe('provider / station rows', () => {
    it('round-trips one row per block with block_order by start time', () => {
      const week = weekFromBlockRows([
        { day_of_week: 5, block_order: 1, start_time: '20:00', end_time: '03:00' },
        { day_of_week: 5, block_order: 0, start_time: '08:00', end_time: '12:00' },
        { day_of_week: 2, start_time: '00:00', end_time: '00:00' },
        { day_of_week: 3, start_time: 'xx', end_time: '10:00' },
      ]);
      expect(day(week, 3).is_active).toBeFalse();
      expect(day(week, 2).is_24h).toBeTrue();
      expect(weekToBlockRows(week)).toEqual([
        { day_of_week: 2, block_order: 0, is_active: true, start_time: '00:00', end_time: '00:00' },
        { day_of_week: 5, block_order: 0, is_active: true, start_time: '08:00', end_time: '12:00' },
        { day_of_week: 5, block_order: 1, is_active: true, start_time: '20:00', end_time: '03:00' },
      ]);
    });
  });

  describe('Ajustes → Venta (pos.business_hours)', () => {
    it('reads continuous and custom days like the API, closed strings and 24:00 included', () => {
      const week = weekFromPosHours(
        {
          monday: { open: '09:00', close: '19:00' },
          tuesday: { open: 'closed', close: 'closed' },
          wednesday: { open: '00:00', close: '24:00' },
          thursday: { open: '08:00', close: '18:00', blocks: [{ open: '08:00', close: '12:00' }, { open: '14:00', close: '18:00' }] },
          friday: { open: '17:00', close: '04:00' },
        },
        'continuous',
      );
      expect(day(week, 1).blocks).toEqual([{ start_time: '09:00', end_time: '19:00' }]);
      expect(day(week, 2).is_active).toBeFalse();
      expect(day(week, 3).is_24h).toBeTrue();
      expect(day(week, 4).blocks.length).toBe(2);
      expect(day(week, 5).blocks).toEqual([{ start_time: '17:00', end_time: '04:00' }]);
      expect(day(week, 6).is_active).toBeFalse();
    });

    it('shows a custom-mode day with an empty block list as closed (what the operator closed)', () => {
      const week = weekFromPosHours({ monday: { open: '08:00', close: '12:00', blocks: [] } }, 'custom');
      expect(day(week, 1).is_active).toBeFalse();
    });

    it('writes continuous mode while every day has one block, closed days as «closed»', () => {
      const week = weekFromPosHours({ monday: { open: '17:00', close: '04:00' } }, 'continuous');
      const out = weekToPosHours(week, 'continuous');
      expect(out.schedule_mode).toBe('continuous');
      expect(out.business_hours['monday']).toEqual({ open: '17:00', close: '04:00' });
      expect(out.business_hours['sunday']).toEqual({ open: 'closed', close: 'closed' });
    });

    it('switches to custom when a day gets a second block, and every day carries blocks', () => {
      const week = weekFromPosHours({ monday: { open: '09:00', close: '18:00' } }, 'continuous').map((d) =>
        d.day_of_week === 1
          ? { ...d, blocks: [{ start_time: '08:00', end_time: '12:00' }, { start_time: '14:00', end_time: '18:00' }] }
          : d,
      );
      const out = weekToPosHours(week, 'continuous');
      expect(out.schedule_mode).toBe('custom');
      expect(out.business_hours['monday']).toEqual({
        open: '08:00',
        close: '18:00',
        blocks: [{ open: '08:00', close: '12:00' }, { open: '14:00', close: '18:00' }],
      });
      expect(out.business_hours['tuesday']).toEqual({ open: 'closed', close: 'closed', blocks: [] });
    });
  });

  it('flags only real night shifts as ending the next day', () => {
    expect(endsNextDay({ start_time: '17:00', end_time: '04:00' })).toBeTrue();
    expect(endsNextDay({ start_time: '09:00', end_time: '18:00' })).toBeFalse();
    expect(endsNextDay({ start_time: '09:00', end_time: '00:00' })).toBeFalse();
    expect(endsNextDay({ start_time: '00:00', end_time: '00:00' })).toBeFalse();
  });

  describe('validateWeek (inline, on the block)', () => {
    it('accepts a 17:00-04:00 shift and consecutive 24 h days', () => {
      expect(validateWeek(weekFromStoreRows(storeRows)).count).toBe(0);
    });

    it('marks the block that runs into the previous night shift, naming that day', () => {
      const week = weekFromStoreRows([
        { day_of_week: 1, start_time: '17:00', end_time: '04:00', is_active: true },
        { day_of_week: 2, start_time: '03:00', end_time: '12:00', is_active: true },
      ]);
      const issues = validateWeek(week);
      expect(issues.blocks['2:0']).toContain('lunes');
      expect(issues.blocks['1:0']).toBeUndefined();
    });

    it("sees Saturday's night shift running into Sunday", () => {
      const week = weekFromStoreRows([
        { day_of_week: 6, start_time: '20:00', end_time: '05:00', is_active: true },
        { day_of_week: 0, start_time: '04:00', end_time: '10:00', is_active: true },
      ]);
      expect(validateWeek(week).blocks['0:0']).toContain('sábado');
    });

    it('marks both overlapping blocks of the same day', () => {
      const week = weekFromBlockRows([
        { day_of_week: 4, start_time: '08:00', end_time: '12:00' },
        { day_of_week: 4, start_time: '11:00', end_time: '15:00' },
      ]);
      const issues = validateWeek(week);
      expect(Object.keys(issues.blocks).sort()).toEqual(['4:0', '4:1']);
    });

    it('rejects a zero-length block and points to «24 horas»', () => {
      const week = weekFromBlockRows([{ day_of_week: 4, start_time: '09:00', end_time: '09:00' }]);
      expect(validateWeek(week).blocks['4:0']).toContain('24 horas');
    });

    it('asks to open at least one day only when required', () => {
      const closed = weekFromStoreRows([]);
      expect(validateWeek(closed).count).toBe(0);
      expect(validateWeek(closed, { requireOpenDay: true }).week).toContain('al menos un día');
    });
  });

  describe('summary and bar', () => {
    it('says «Abierto todos los días, 24 horas» for 24/7', () => {
      expect(summarizeWeek(applyPreset(weekFromStoreRows([]), 'always'))).toBe('Abierto todos los días, 24 horas');
    });

    it('groups consecutive days with the same hours', () => {
      let week = applyPreset(weekFromStoreRows([]), 'weekdays');
      week = week.map((d) =>
        d.day_of_week === 6 ? { ...d, is_active: true, blocks: [{ start_time: '09:00', end_time: '13:00' }] } : d,
      );
      expect(summarizeWeek(week)).toBe('Lun–Vie 8 a. m. – 6 p. m. · Sáb 9 a. m. – 1 p. m. · Dom cerrado');
    });

    it('paints the night shift on its day and its spill on the next one', () => {
      const week = applyPreset(weekFromStoreRows([]), 'night');
      const monday = daySegments(week, 1);
      expect(monday.length).toBe(2);
      const spill = monday.find((s) => s.kind === 'spill')!;
      expect(spill.left).toBe(0);
      expect(spill.width).toBeCloseTo((4 / 24) * 100, 5);
      const own = monday.find((s) => s.kind === 'open')!;
      expect(own.continues).toBeTrue();
      expect(own.left).toBeCloseTo((17 / 24) * 100, 5);
    });
  });

  describe('shortcuts', () => {
    it('copies a day to the weekdays only', () => {
      const week = weekFromBlockRows([{ day_of_week: 1, start_time: '17:00', end_time: '04:00' }]);
      const out = copyDay(week, 1, 'weekdays');
      expect([1, 2, 3, 4, 5].every((dow) => day(out, dow).blocks[0].end_time === '04:00' && day(out, dow).is_active)).toBeTrue();
      expect(day(out, 6).is_active).toBeFalse();
      expect(day(out, 0).is_active).toBeFalse();
    });

    it('offers 12 h hour labels every 15 minutes and keeps an off-grid value', () => {
      expect(formatTime12('17:00')).toBe('5:00 p. m.');
      expect(formatTime12('00:30')).toBe('12:30 a. m.');
      expect(timeOptions().length).toBe(96);
      expect(timeOptions('08:10').some((o) => o.value === '08:10')).toBeTrue();
    });
  });
});
