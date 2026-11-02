import { onlineCheckinPath, onlineCheckinState } from './booking-checkin';

/** Apps · booking (Fase 4): when the page opens the PMS online check-in. */
describe('onlineCheckinState', () => {
  const TODAY = '2026-11-10';
  const stay = (status: string, departure = '2026-11-12', completed: Date | null = null) => ({
    status,
    departure_date: new Date(`${departure}T00:00:00.000Z`),
    precheckin_completed_at: completed,
  });

  it('opens it for a confirmed stay inside the window', () => {
    expect(onlineCheckinState(stay('confirmed'), TODAY)).toBe('available');
  });

  it('keeps it open while the guest is in house', () => {
    expect(onlineCheckinState(stay('checked_in'), TODAY)).toBe('available');
  });

  it('waits for the payment of an unpaid web hold', () => {
    expect(onlineCheckinState(stay('tentative'), TODAY)).toBe('not_confirmed');
  });

  it('closes it after the departure day', () => {
    expect(onlineCheckinState(stay('confirmed', '2026-11-09'), TODAY)).toBe('closed');
  });

  it('opens it on the departure day itself (PMS window)', () => {
    expect(onlineCheckinState(stay('confirmed', TODAY), TODAY)).toBe('available');
  });

  it.each(['cancelled', 'no_show', 'checked_out'])('closes it for a %s stay', (status) => {
    expect(onlineCheckinState(stay(status), TODAY)).toBe('closed');
  });

  it('reports a finished check-in as completed', () => {
    expect(onlineCheckinState(stay('confirmed', '2026-11-12', new Date()), TODAY)).toBe('completed');
  });

  it('builds the PMS form path', () => {
    expect(onlineCheckinPath('abc_123')).toBe('/pre-registro/abc_123');
  });
});
