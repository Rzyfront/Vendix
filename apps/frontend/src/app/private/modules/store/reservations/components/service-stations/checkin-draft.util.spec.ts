import { CheckinDraft, hasCheckinCapturedData } from './checkin-draft.util';

/** QUI-1059: «Nuevo ingreso» only asks to discard when the person captured something. */
describe('QUI-1059 checkin-draft.util', () => {
  const defaults = { stationId: 7, productId: 3, durationMinutes: 45 };

  function draft(overrides: Partial<CheckinDraft> = {}): CheckinDraft {
    return {
      texts: ['', '', '   '],
      hasCustomer: false,
      providerId: null,
      budgetAmount: null,
      lineCount: 0,
      intakeValues: {},
      current: { ...defaults },
      opened: { ...defaults },
      ...overrides,
    };
  }

  it('freshly opened modal (only its own defaults) has nothing to discard', () => {
    expect(hasCheckinCapturedData(draft())).toBeFalse();
  });

  it('typed text (plate, customer name, notes…) counts as captured', () => {
    expect(hasCheckinCapturedData(draft({ texts: ['', 'ABC-123'] }))).toBeTrue();
  });

  it('a chosen customer, provider or budget counts as captured', () => {
    expect(hasCheckinCapturedData(draft({ hasCustomer: true }))).toBeTrue();
    expect(hasCheckinCapturedData(draft({ providerId: 12 }))).toBeTrue();
    expect(hasCheckinCapturedData(draft({ budgetAmount: 150000 }))).toBeTrue();
  });

  it('product lines count as captured', () => {
    expect(hasCheckinCapturedData(draft({ lineCount: 1 }))).toBeTrue();
  });

  it('intake answers count, empty answers do not', () => {
    expect(hasCheckinCapturedData(draft({ intakeValues: { 4: '', 5: null, 6: [] } }))).toBeFalse();
    expect(hasCheckinCapturedData(draft({ intakeValues: { 4: 'Rayón en la puerta' } }))).toBeTrue();
  });

  it('changing station, service or minutes counts; the same value as text does not', () => {
    expect(hasCheckinCapturedData(draft({ current: { ...defaults, stationId: 8 } }))).toBeTrue();
    expect(hasCheckinCapturedData(draft({ current: { ...defaults, productId: 4 } }))).toBeTrue();
    expect(hasCheckinCapturedData(draft({ current: { ...defaults, durationMinutes: 60 } }))).toBeTrue();
    expect(hasCheckinCapturedData(draft({ current: { ...defaults, durationMinutes: '45' } }))).toBeFalse();
  });
});
