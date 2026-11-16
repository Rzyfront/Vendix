import {
  allowsRegistrationRetry,
  connectedOutcome,
  isCoexistenceChannel,
  needsRegistrationNotice,
} from './channels-coexistence';

const base = {
  status: 'connected',
  phone_number_id: 'phone',
  registration_status: null,
} as const;

describe('channels coexistence display rules', () => {
  it('detects a coexistence channel only when enabled', () => {
    expect(isCoexistenceChannel(null)).toBeFalse();
    expect(isCoexistenceChannel({})).toBeFalse();
    expect(
      isCoexistenceChannel({
        coexistence: { enabled: false, contacts_sync: null, history_sync: null },
      }),
    ).toBeFalse();
    expect(
      isCoexistenceChannel({
        coexistence: { enabled: true, contacts_sync: null, history_sync: null },
      }),
    ).toBeTrue();
  });

  it('keeps the registration notice for a new number that is not registered', () => {
    expect(needsRegistrationNotice({ ...base })).toBeTrue();
    expect(
      needsRegistrationNotice({ ...base, registration_status: 'failed' }),
    ).toBeTrue();
    expect(
      needsRegistrationNotice({ ...base, registration_status: 'registered' }),
    ).toBeFalse();
  });

  it('hides the registration notice and retry for not_required', () => {
    const channel = { ...base, registration_status: 'not_required' } as const;
    expect(needsRegistrationNotice(channel)).toBeFalse();
    expect(allowsRegistrationRetry(channel)).toBeFalse();
  });

  it('keeps the retry for failed or legacy channels', () => {
    expect(allowsRegistrationRetry({ ...base })).toBeTrue();
    expect(
      allowsRegistrationRetry({ ...base, registration_status: 'failed' }),
    ).toBeTrue();
    expect(
      allowsRegistrationRetry({ ...base, status: 'disconnected' }),
    ).toBeFalse();
  });

  it('says connected for not_required and keeps the error path otherwise', () => {
    expect(
      connectedOutcome({
        status: 'connected',
        last_error: null,
        registration_status: 'not_required',
      }),
    ).toEqual({ kind: 'success', message: 'WhatsApp quedó conectado.' });
    expect(
      connectedOutcome({
        status: 'error',
        last_error: null,
        registration_status: 'failed',
      }),
    ).toEqual({
      kind: 'error',
      message: 'WhatsApp quedó conectado, pero falta registrar el número.',
    });
  });
});
