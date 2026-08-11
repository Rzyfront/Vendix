import { MinimaxSpeechProvider } from './minimax-speech.provider';
import { AIProviderConfig } from '../interfaces/ai-provider.interface';

describe('MinimaxSpeechProvider', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  /** Two bytes that differ under hex and utf8 decoding, so the test can tell them apart. */
  const AUDIO_HEX = 'deadbeef';

  const buildProvider = (
    settings: Record<string, any> = {},
    overrides: Partial<AIProviderConfig> = {},
  ): MinimaxSpeechProvider =>
    new MinimaxSpeechProvider({
      provider: 'MiniMax',
      sdkType: 'minimax_t2a',
      apiKey: 'test-key',
      modelId: 'speech-2.8-hd',
      baseUrl: 'https://api.minimax.io/v1/t2a_v2',
      modelType: 'speech',
      settings,
      ...overrides,
    });

  // `null` rather than `undefined` marks an absent payload: passing `undefined`
  // triggers the default parameter and would send valid audio instead.
  const okResponse = (audio: string | null = AUDIO_HEX, extra = {}) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      data: audio === null ? {} : { audio },
      trace_id: 'trace-1',
      base_resp: { status_code: 0, status_msg: 'success' },
      ...extra,
    }),
  });

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  describe('request shape', () => {
    it('nests voice and audio parameters instead of sending them flat', async () => {
      const provider = buildProvider();

      await provider.generateSpeech('Tenés 47 ventas hoy', {
        voice: 'Spanish_MaturePartner',
        speed: 1.7,
        responseFormat: 'mp3',
      });

      const body = sentBody();

      // The whole reason this provider exists: OpenAI takes `voice`,
      // `response_format` and `speed` at the top level; MiniMax refuses that
      // shape and wants them nested.
      expect(body.voice).toBeUndefined();
      expect(body.response_format).toBeUndefined();
      expect(body.input).toBeUndefined();

      expect(body).toMatchObject({
        model: 'speech-2.8-hd',
        text: 'Tenés 47 ventas hoy',
        output_format: 'hex',
        voice_setting: {
          voice_id: 'Spanish_MaturePartner',
          speed: 1.7,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          format: 'mp3',
          sample_rate: 32000,
          bitrate: 128000,
          channel: 1,
        },
      });
    });

    it('posts to the configured endpoint without rewriting it', async () => {
      await buildProvider().generateSpeech('OK');

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.minimax.io/v1/t2a_v2',
      );
    });

    it('appends the T2A path when only a host was configured', async () => {
      await buildProvider({}, { baseUrl: 'https://api.minimax.io/' }).generateSpeech(
        'OK',
      );

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.minimax.io/v1/t2a_v2',
      );
    });

    it('appends GroupId only when the account configured one', async () => {
      await buildProvider().generateSpeech('OK');
      expect(fetchMock.mock.calls[0][0]).not.toContain('GroupId');

      fetchMock.mockClear();
      await buildProvider({ group_id: '1899' }).generateSpeech('OK');
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.minimax.io/v1/t2a_v2?GroupId=1899',
      );
    });

    it('derives language_boost as a language name, not a locale tag', async () => {
      await buildProvider({ language: 'es-CO' }).generateSpeech('OK');
      expect(sentBody().language_boost).toBe('Spanish');

      fetchMock.mockClear();
      await buildProvider({ language: 'en-US' }).generateSpeech('OK');
      expect(sentBody().language_boost).toBe('English');

      // An unknown locale defers to the model rather than guessing Spanish.
      fetchMock.mockClear();
      await buildProvider({ language: 'sw-KE' }).generateSpeech('OK');
      expect(sentBody().language_boost).toBe('auto');
    });

    it('falls back to the seeded voice when none is configured', async () => {
      await buildProvider().generateSpeech('OK');

      expect(sentBody().voice_setting.voice_id).toBe('Spanish_MaturePartner');
    });
  });

  describe('speed clamping', () => {
    it.each([
      [3, 2],
      [0.1, 0.5],
      [1.7, 1.7],
      ['1.7', 1.7],
    ])('brings %p into range as %p', async (input, expected) => {
      await buildProvider().generateSpeech('OK', { speed: input as any });

      expect(sentBody().voice_setting.speed).toBe(expected);
    });

    it('defaults to 1 when nothing set a speed', async () => {
      await buildProvider().generateSpeech('OK');

      expect(sentBody().voice_setting.speed).toBe(1);
    });
  });

  describe('response decoding', () => {
    it('decodes the hex payload rather than reading the body as bytes', async () => {
      const response = await buildProvider().generateSpeech('OK');

      expect(response.success).toBe(true);
      expect(response.contentType).toBe('audio/mp3');
      expect(response.generationId).toBe('trace-1');

      // Reading the JSON as an arrayBuffer — what the OpenAI path does — would
      // yield the document, not the audio. Decoding as utf8 instead of hex would
      // yield 8 bytes instead of 4.
      const decoded = Buffer.from(response.audioBase64!, 'base64');
      expect(decoded).toEqual(Buffer.from(AUDIO_HEX, 'hex'));
      expect(decoded.length).toBe(4);
    });

    it('treats a non-zero base_resp as failure even on HTTP 200', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          base_resp: { status_code: 1004, status_msg: 'insufficient balance' },
        }),
      });

      const response = await buildProvider().generateSpeech('OK');

      expect(response.success).toBe(false);
      expect(response.error).toContain('1004');
      expect(response.error).toContain('insufficient balance');
    });

    it('reports a missing audio payload instead of returning empty success', async () => {
      fetchMock.mockResolvedValue(okResponse(null));

      const response = await buildProvider().generateSpeech('OK');

      expect(response.success).toBe(false);
      expect(response.error).toContain('no audio');
    });

    it('surfaces the provider message on a transport failure', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () =>
          JSON.stringify({ base_resp: { status_msg: 'invalid api key' } }),
      });

      const response = await buildProvider().generateSpeech('OK');

      expect(response.success).toBe(false);
      expect(response.error).toBe('invalid api key');
    });
  });

  describe('capabilities it does not have', () => {
    it('fails chat by naming the incapacity, without throwing', async () => {
      const provider = buildProvider();

      // Throwing would break the contract `AIEngineService.chat` relies on: it
      // reads `response.success` and never wraps the call in a try/catch.
      const response = await provider.chat([{ role: 'user', content: 'hola' }]);

      expect(response.success).toBe(false);
      expect(response.error).toContain('does not support chat');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails complete the same way', async () => {
      const response = await buildProvider().complete('hola');

      expect(response.success).toBe(false);
      expect(response.error).toContain('speech-synthesis provider');
    });
  });

  describe('testConnection', () => {
    it('synthesises a short phrase and reports the model', async () => {
      const result = await buildProvider().testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toContain('speech-2.8-hd');
      expect(sentBody().text).toBe('OK');
    });

    it('names the absent key instead of asking the provider', async () => {
      const result = await buildProvider({}, { apiKey: '' }).testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('API key');
      // No point spending a request to be told 401 by a provider we never
      // authenticated against.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('forwards the provider status message on failure', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          base_resp: { status_code: 2013, status_msg: 'invalid voice_id' },
        }),
      });

      const result = await buildProvider().testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('invalid voice_id');
    });
  });
});
