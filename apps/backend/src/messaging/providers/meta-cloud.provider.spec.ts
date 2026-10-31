import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { MetaCloudMessagingProvider } from './meta-cloud.provider';
import {
  OutboundMessage,
  ResolvedChannel,
} from '../interfaces/messaging.interface';

const TOKEN = 'EAAG-secret-token';

const channel: ResolvedChannel = {
  id: 5,
  store_id: 10,
  channel_type: 'whatsapp',
  provider: 'meta_cloud',
  phone_number_id: '1234567890',
  waba_id: 'waba-1',
  access_token: TOKEN,
  graph_version: 'v23.0',
};

function message(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    store_id: 10,
    channel: 'whatsapp',
    to: '+57 300 123 4567',
    body: 'Hola',
    idempotency_key: '77',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function metaError(status: number, code: number, extra: object = {}) {
  return jsonResponse(status, {
    error: {
      message: 'Meta error',
      type: 'OAuthException',
      code,
      fbtrace_id: 'trace',
      ...extra,
    },
  });
}

function createProvider(env: Record<string, string> = {}) {
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          MESSAGING_HTTP_TIMEOUT_MS: '50',
          MESSAGING_RETRY_BASE_MS: '0',
          ...env,
        })[key],
    ),
  } as unknown as ConfigService;
  return new MetaCloudMessagingProvider(config);
}

describe('MetaCloudMessagingProvider', () => {
  let fetchSpy: jest.SpyInstance;
  let logSpies: jest.SpyInstance[];

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    logSpies = (['log', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function loggedText(): string {
    return logSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => String(arg))
      .join('\n');
  }

  it('sends free-form text to the Graph messages endpoint and returns the wamid', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, {
        messaging_product: 'whatsapp',
        contacts: [{ input: '573001234567', wa_id: '573001234567' }],
        messages: [{ id: 'wamid.HBgM' }],
      }),
    );

    const result = await createProvider().send(message(), channel);

    expect(result).toEqual({
      status: 'sent',
      provider: 'meta_cloud',
      provider_message_id: 'wamid.HBgM',
      retryable: false,
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/1234567890/messages');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '573001234567',
      type: 'text',
      text: { body: 'Hola', preview_url: false },
    });
    expect(loggedText()).not.toContain(TOKEN);
  });

  it('builds a template payload with body variables and header media', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { messages: [{ id: 'wamid.T' }] }),
    );

    await createProvider().send(
      message({
        body: undefined,
        template: {
          name: 'order_ready',
          language: 'es_CO',
          variables: ['Ana', '#1042'],
          header_media: { type: 'image', url: 'https://cdn.test/a.png' },
        },
      }),
      channel,
    );

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '573001234567',
      type: 'template',
      template: {
        name: 'order_ready',
        language: { code: 'es_CO' },
        components: [
          {
            type: 'header',
            parameters: [
              { type: 'image', image: { link: 'https://cdn.test/a.png' } },
            ],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Ana' },
              { type: 'text', text: '#1042' },
            ],
          },
        ],
      },
    });
  });

  it('sends a document with caption and filename', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { messages: [{ id: 'wamid.D' }] }),
    );

    await createProvider().send(
      message({
        body: 'Tu factura',
        media: [
          {
            type: 'document',
            url: 'https://cdn.test/f.pdf',
            filename: 'factura.pdf',
          },
        ],
      }),
      channel,
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.type).toBe('document');
    expect(body.document).toEqual({
      link: 'https://cdn.test/f.pdf',
      caption: 'Tu factura',
      filename: 'factura.pdf',
    });
  });

  it.each([
    [400, 131047, 'WINDOW_CLOSED', false],
    [400, 131026, 'INVALID_RECIPIENT', false],
    [401, 190, 'AUTH', false],
    [400, 131050, 'OPTED_OUT', false],
    [400, 132001, 'TEMPLATE_INVALID', false],
    [400, 100, 'INVALID_REQUEST', false],
  ])(
    'maps HTTP %s Meta error %s to %s without retrying',
    async (http, code, normalized, retryable) => {
      fetchSpy.mockResolvedValue(metaError(http, code));

      const result = await createProvider().send(message(), channel);

      expect(result).toMatchObject({
        status: 'failed',
        provider: 'meta_cloud',
        error_code: normalized,
        provider_error_code: String(code),
        retryable,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  it('retries rate limits with backoff and succeeds', async () => {
    fetchSpy
      .mockResolvedValueOnce(metaError(429, 130429))
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { messages: [{ id: 'wamid.OK' }] }),
      );

    const result = await createProvider().send(message(), channel);

    expect(result.status).toBe('sent');
    expect(result.provider_message_id).toBe('wamid.OK');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('returns a retryable RATE_LIMITED failure after exhausting in-call retries', async () => {
    fetchSpy.mockResolvedValue(metaError(429, 130429));

    const result = await createProvider({ MESSAGING_HTTP_RETRIES: '1' }).send(
      message(),
      channel,
    );

    expect(result).toMatchObject({
      status: 'failed',
      error_code: 'RATE_LIMITED',
      provider_error_code: '130429',
      retryable: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('aborts on timeout and does not resend (Meta may have accepted it)', async () => {
    fetchSpy.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    const result = await createProvider().send(message(), channel);

    expect(result).toMatchObject({
      status: 'failed',
      error_code: 'TIMEOUT',
      retryable: false,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries a network error raised before any response', async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        jsonResponse(200, { messages: [{ id: 'wamid.NET' }] }),
      );

    const result = await createProvider().send(message(), channel);

    expect(result.provider_message_id).toBe('wamid.NET');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('fails with CHANNEL_NOT_CONFIGURED when the channel lacks token or phone id', async () => {
    const result = await createProvider().send(message(), {
      ...channel,
      access_token: null,
    });

    expect(result).toMatchObject({
      status: 'failed',
      error_code: 'CHANNEL_NOT_CONFIGURED',
      retryable: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
