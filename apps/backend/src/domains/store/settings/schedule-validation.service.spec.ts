import { ScheduleValidationService } from './schedule-validation.service';

/**
 * S21: business hours may cross midnight. A block belongs to the day it starts
 * (A5), so "open at 01:00 Saturday" must also look at Friday's overnight block.
 */
describe('ScheduleValidationService.validateBusinessHours (S21)', () => {
  const build = (
    business_hours: Record<string, unknown>,
    schedule_mode?: 'continuous' | 'custom',
  ) => {
    const prisma: any = {
      store_settings: {
        findUnique: jest.fn().mockResolvedValue({
          settings: {
            general: { timezone: 'UTC' },
            pos: {
              enable_schedule_validation: true,
              ...(schedule_mode ? { schedule_mode } : {}),
              business_hours,
            },
          },
        }),
      },
    };
    return new ScheduleValidationService(prisma);
  };

  // 2026-11-13 is a Friday, 2026-11-14 a Saturday (UTC).
  const at = (iso: string) => jest.useFakeTimers().setSystemTime(new Date(iso));

  afterEach(() => jest.useRealTimers());

  describe('overnight continuous block', () => {
    const hours = { friday: { open: '18:00', close: '03:00' } };

    it('is open on Friday evening', async () => {
      at('2026-11-13T22:00:00Z');
      expect((await build(hours).validateBusinessHours(1)).isWithinBusinessHours).toBe(true);
    });

    it('is open at 01:00 Saturday through Friday spill (A5)', async () => {
      at('2026-11-14T01:00:00Z');
      expect((await build(hours).validateBusinessHours(1)).isWithinBusinessHours).toBe(true);
    });

    it('is closed after the spill ends', async () => {
      at('2026-11-14T04:00:00Z');
      const saturdayHours = { ...hours, saturday: { open: '18:00', close: '03:00' } };
      expect((await build(saturdayHours).validateBusinessHours(1)).isWithinBusinessHours).toBe(false);
    });

    it('is closed on Friday morning before the block starts', async () => {
      at('2026-11-13T10:00:00Z');
      expect((await build(hours).validateBusinessHours(1)).isWithinBusinessHours).toBe(false);
    });
  });

  describe('overnight custom blocks', () => {
    const hours = {
      friday: { blocks: [{ open: '12:00', close: '14:00' }, { open: '20:00', close: '02:00' }] },
      saturday: { blocks: [{ open: '12:00', close: '14:00' }] },
    };

    it('is open at 01:00 Saturday through Friday spill', async () => {
      at('2026-11-14T01:00:00Z');
      expect((await build(hours).validateBusinessHours(1)).isWithinBusinessHours).toBe(true);
    });

    it('is closed at 03:00 Saturday', async () => {
      at('2026-11-14T03:00:00Z');
      expect((await build(hours).validateBusinessHours(1)).isWithinBusinessHours).toBe(false);
    });
  });

  describe('daytime blocks keep their previous behavior', () => {
    const hours = { friday: { open: '09:00', close: '18:00' }, saturday: { open: '09:00', close: '18:00' } };

    it('is open inside the block, inclusive of the close minute', async () => {
      at('2026-11-13T18:00:00Z');
      expect((await build(hours).validateBusinessHours(1)).isWithinBusinessHours).toBe(true);
    });

    it('is closed after close', async () => {
      at('2026-11-13T18:01:00Z');
      expect((await build(hours).validateBusinessHours(1)).isWithinBusinessHours).toBe(false);
    });

    it('does not open at 01:00 Saturday from a daytime Friday block', async () => {
      at('2026-11-14T01:00:00Z');
      expect((await build(hours).validateBusinessHours(1)).isWithinBusinessHours).toBe(false);
    });
  });

  it('treats a close at 00:00 as the end of the day', async () => {
    at('2026-11-13T23:30:00Z');
    const result = await build({ friday: { open: '09:00', close: '00:00' } }).validateBusinessHours(1);
    expect(result.isWithinBusinessHours).toBe(true);
  });

  describe('custom mode closed days with empty blocks[]', () => {
    const hours = {
      friday: { open: '08:00', close: '18:00', blocks: [] },
      saturday: { open: '08:00', close: '18:00', blocks: [] },
      sunday: { open: '09:00', close: '13:00', blocks: [{ open: '09:00', close: '13:00' }] },
    };

    it('treats today with blocks: [] as closed in custom mode and skips closed days for nextOpenTime', async () => {
      at('2026-11-13T10:00:00Z'); // Friday 10:00
      const result = await build(hours, 'custom').validateBusinessHours(1);
      expect(result.isWithinBusinessHours).toBe(false);
      expect(result.nextOpenTime).toBe('Domingo 09:00 - 13:00');
    });

    it('ignores overnight spill from yesterday when yesterday has blocks: [] in custom mode', async () => {
      at('2026-11-14T01:00:00Z'); // Saturday 01:00
      const spillHours = {
        friday: { open: '18:00', close: '03:00', blocks: [] },
        saturday: { open: '09:00', close: '18:00', blocks: [{ open: '09:00', close: '18:00' }] },
      };
      const result = await build(spillHours, 'custom').validateBusinessHours(1);
      expect(result.isWithinBusinessHours).toBe(false);
      expect(result.nextOpenTime).toBe('Hoy 09:00 - 18:00');
    });

    it('keeps continuous mode fallback to open/close when schedule_mode is continuous', async () => {
      at('2026-11-13T10:00:00Z'); // Friday 10:00
      const result = await build(hours, 'continuous').validateBusinessHours(1);
      expect(result.isWithinBusinessHours).toBe(true);
    });
  });
});
