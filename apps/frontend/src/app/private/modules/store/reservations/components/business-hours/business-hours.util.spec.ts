import { daysFromRows, endsNextDay, toPayload, validateDays } from './business-hours.util';

describe('business-hours.util (one store schedule, night shifts, 24 h)', () => {
  const rows = [
    { day_of_week: 1, start_time: '17:00', end_time: '04:00', is_active: true },
    { day_of_week: 3, start_time: '00:00', end_time: '00:00', is_active: true, is_24h: true },
    { day_of_week: 4, start_time: '00:00', end_time: '00:00', is_active: true, is_24h: true },
    {
      day_of_week: 5,
      start_time: '08:00',
      end_time: '18:00',
      is_active: true,
      blocks: [
        { start_time: '08:00', end_time: '12:00' },
        { start_time: '14:00', end_time: '18:00' },
      ],
    },
    { day_of_week: 0, start_time: null, end_time: null, is_active: false },
  ];

  it('reads night shifts, 24 h days, split shifts and closed days', () => {
    const days = daysFromRows(rows);
    expect(days.length).toBe(7);
    expect(days[1]).toEqual({
      day_of_week: 1,
      is_active: true,
      is_24h: false,
      blocks: [{ start_time: '17:00', end_time: '04:00' }],
    });
    expect(days[3].is_24h).toBeTrue();
    expect(days[4].is_24h).toBeTrue();
    expect(days[5].blocks.length).toBe(2);
    expect(days[0].is_active).toBeFalse();
    expect(days[0].blocks).toEqual([{ start_time: '09:00', end_time: '18:00' }]);
  });

  it('flags only real night shifts as ending the next day', () => {
    expect(endsNextDay({ start_time: '17:00', end_time: '04:00' })).toBeTrue();
    expect(endsNextDay({ start_time: '09:00', end_time: '18:00' })).toBeFalse();
    expect(endsNextDay({ start_time: '00:00', end_time: '00:00' })).toBeFalse();
  });

  it('sends every day, 24 h as 00:00-00:00 and split shifts as blocks', () => {
    const days = daysFromRows(rows);
    const payload = toPayload(days);
    expect(payload.length).toBe(7);
    expect(payload.find((p) => p.day_of_week === 3)).toEqual({
      day_of_week: 3,
      start_time: '00:00',
      end_time: '00:00',
      is_active: true,
    });
    expect(payload.find((p) => p.day_of_week === 5)?.blocks?.length).toBe(2);
    expect(payload.find((p) => p.day_of_week === 0)?.is_active).toBeFalse();
  });

  it('accepts a 17:00-04:00 shift and consecutive 24 h days', () => {
    expect(validateDays(daysFromRows(rows))).toBeNull();
  });

  it('rejects a block that overlaps the previous night shift, naming the day', () => {
    const days = daysFromRows([
      { day_of_week: 1, start_time: '17:00', end_time: '04:00', is_active: true },
      { day_of_week: 2, start_time: '03:00', end_time: '12:00', is_active: true },
    ]);
    expect(validateDays(days)).toContain('Martes');
  });

  it('rejects a zero-length block and points to «24 horas»', () => {
    const days = daysFromRows([{ day_of_week: 4, start_time: '09:00', end_time: '09:00', is_active: true }]);
    expect(validateDays(days)).toContain('24 horas');
  });

  it('asks to open at least one day', () => {
    expect(validateDays(daysFromRows([]))).toBe('Debes abrir al menos un día');
  });
});
