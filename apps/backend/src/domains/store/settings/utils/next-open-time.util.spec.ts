import { computeNextOpenMessage } from './next-open-time.util';

describe('computeNextOpenMessage', () => {
  // 2026-11-13 is Friday, 2026-11-14 is Saturday, 2026-11-15 is Sunday (UTC).
  const at = (iso: string) => jest.useFakeTimers().setSystemTime(new Date(iso));

  afterEach(() => jest.useRealTimers());

  it('skips days with blocks: [] in custom mode even when legacy open/close exist', () => {
    at('2026-11-13T07:00:00Z'); // Friday 07:00 (before legacy 08:00)
    const hours = {
      friday: { open: '08:00', close: '18:00', blocks: [] },
      saturday: { open: '08:00', close: '18:00', blocks: [] },
      sunday: {
        open: '09:00',
        close: '13:00',
        blocks: [{ open: '09:00', close: '13:00' }],
      },
    };
    expect(computeNextOpenMessage(hours, 'UTC', 'custom')).toBe(
      'Reabrimos: Domingo 09:00 - 13:00',
    );
  });

  it('returns null when every day in custom mode has blocks: []', () => {
    at('2026-11-13T10:00:00Z');
    const closedWeek = {
      sunday: { open: '08:00', close: '18:00', blocks: [] },
      monday: { open: '08:00', close: '18:00', blocks: [] },
      tuesday: { open: '08:00', close: '18:00', blocks: [] },
      wednesday: { open: '08:00', close: '18:00', blocks: [] },
      thursday: { open: '08:00', close: '18:00', blocks: [] },
      friday: { open: '08:00', close: '18:00', blocks: [] },
      saturday: { open: '08:00', close: '18:00', blocks: [] },
    };
    expect(computeNextOpenMessage(closedWeek, 'UTC', 'custom')).toBeNull();
  });

  it('keeps continuous mode behavior using open/close when scheduleMode is omitted or continuous', () => {
    at('2026-11-13T07:00:00Z');
    const hours = {
      friday: { open: '08:00', close: '18:00', blocks: [] },
    };
    expect(computeNextOpenMessage(hours, 'UTC', 'continuous')).toBe(
      'Reabrimos: Hoy 08:00 - 18:00',
    );
    expect(computeNextOpenMessage(hours, 'UTC')).toBe(
      'Reabrimos: Hoy 08:00 - 18:00',
    );
  });
});
