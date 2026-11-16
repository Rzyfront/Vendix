import {
  buildWhatsappDisconnectData,
  resolveWhatsappDisconnectionMessage,
} from './whatsapp-channel-disconnect';

describe('buildWhatsappDisconnectData', () => {
  const now = new Date('2026-11-16T10:00:00.000Z');

  it('disconnects, drops the token and keeps previous metadata', () => {
    const data = buildWhatsappDisconnectData({ keep: { a: 1 } }, { now });

    expect(data).toEqual({
      status: 'disconnected',
      access_token_encrypted: null,
      last_error: null,
      disconnected_at: now,
      metadata: { keep: { a: 1 }, disconnected_at: now.toISOString() },
    });
  });

  it('accepts null metadata', () => {
    const data = buildWhatsappDisconnectData(null, { now });

    expect(data.metadata).toEqual({ disconnected_at: now.toISOString() });
  });

  it('stores the last error and the disconnection details when given', () => {
    const disconnection = {
      event: 'PARTNER_REMOVED',
      reason: null,
      initiated_by: 'USER',
      at: now.toISOString(),
    };
    const data = buildWhatsappDisconnectData(
      { keep: true },
      { now, last_error: 'texto', disconnection },
    );

    expect(data.last_error).toBe('texto');
    expect(data.metadata).toEqual({
      keep: true,
      disconnected_at: now.toISOString(),
      disconnection,
    });
  });
});

describe('resolveWhatsappDisconnectionMessage', () => {
  it('explains a disconnect initiated by the user from the app', () => {
    expect(
      resolveWhatsappDisconnectionMessage({
        event: 'PARTNER_REMOVED',
        initiated_by: 'USER',
      }),
    ).toBe('Desconectaste Vendix desde la app WhatsApp Business.');
  });

  it('explains primary inactivity', () => {
    expect(
      resolveWhatsappDisconnectionMessage({
        event: 'PARTNER_REMOVED',
        reason: 'PRIMARY_INACTIVITY',
        initiated_by: 'BUSINESS',
      }),
    ).toBe(
      'Tu WhatsApp Business estuvo inactivo en el celular unos 14 días y se desconectó de Vendix. Vuelve a conectarlo.',
    );
  });

  it('uses the generic text otherwise', () => {
    expect(
      resolveWhatsappDisconnectionMessage({ event: 'ACCOUNT_OFFBOARDED' }),
    ).toBe('Tu número se desconectó de Vendix. Vuelve a conectarlo.');
    expect(
      resolveWhatsappDisconnectionMessage({
        event: 'ACCOUNT_OFFBOARDED',
        initiated_by: 'USER',
      }),
    ).toBe('Tu número se desconectó de Vendix. Vuelve a conectarlo.');
  });
});
