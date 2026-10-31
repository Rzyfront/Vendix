import { SesEmailMessagingProvider } from './ses-email.provider';
import { OutboundMessage, ResolvedChannel } from '../interfaces/messaging.interface';

function setup(result: { success: boolean; messageId?: string; error?: string } = { success: true, messageId: '<m1@ses>' }) {
  const email = { sendEmail: jest.fn().mockResolvedValue(result) };
  return { provider: new SesEmailMessagingProvider(email as never), email };
}

const channel = (settings: Record<string, unknown> = {}): ResolvedChannel => ({
  id: 8,
  store_id: 10,
  channel_type: 'email',
  provider: 'ses_email',
  phone_number_id: null,
  waba_id: null,
  access_token: null,
  graph_version: '',
  settings,
  store_name: 'Tienda Centro',
});

const message = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  store_id: 10,
  channel: 'email',
  to: ' Cliente@Example.com ',
  body: 'Hola <b>Ana</b>\nTu pedido salió.',
  idempotency_key: '90',
  ...overrides,
});

describe('SesEmailMessagingProvider', () => {
  it('sends through EmailService with the store name as sender and reply_to as Reply-To', async () => {
    const { provider, email } = setup();

    const result = await provider.send(
      message(),
      channel({ from_name: 'Tienda Centro Norte', reply_to: 'hola@tienda.co' }),
    );

    expect(email.sendEmail).toHaveBeenCalledWith(
      'cliente@example.com',
      'Mensaje de Tienda Centro',
      expect.stringContaining('Hola &lt;b&gt;Ana&lt;/b&gt;<br>Tu pedido salió.'),
      'Hola <b>Ana</b>\nTu pedido salió.',
      { name: 'Tienda Centro Norte', email: 'hola@tienda.co' },
    );
    expect(result).toEqual({
      status: 'sent',
      provider: 'ses_email',
      provider_message_id: '<m1@ses>',
      retryable: false,
    });
  });

  it('defaults the sender to the store name and keeps a custom subject on one line', async () => {
    const { provider, email } = setup();
    await provider.send(message({ subject: 'Tu\r\npedido' }), channel());
    expect(email.sendEmail).toHaveBeenCalledWith(
      'cliente@example.com',
      'Tu pedido',
      expect.any(String),
      expect.any(String),
      { name: 'Tienda Centro', email: '' },
    );
  });

  it.each([
    [{ to: 'no-es-correo' }, 'INVALID_RECIPIENT'],
    [{ body: '  ' }, 'INVALID_REQUEST'],
    [{ template: { name: 't', language: 'es', variables: [] } }, 'INVALID_REQUEST'],
  ])('validates before sending: %p → %s', async (overrides, code) => {
    const { provider, email } = setup();
    expect(await provider.send(message(overrides), channel())).toMatchObject({ status: 'failed', error_code: code });
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['Throttling: Maximum sending rate exceeded', 'RATE_LIMITED', true],
    ['421 Service not available', 'PROVIDER_ERROR', true],
    ['550 5.1.1 Invalid recipient', 'INVALID_RECIPIENT', false],
    ['Email address is not verified', 'PROVIDER_ERROR', false],
  ])('maps "%s" to %s (retryable %s)', async (error, code, retryable) => {
    const { provider } = setup({ success: false, error });
    expect(await provider.send(message(), channel())).toMatchObject({
      status: 'failed',
      provider: 'ses_email',
      error_code: code,
      retryable,
    });
  });
});
