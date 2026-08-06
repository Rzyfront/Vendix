import { OpenAICompatibleProvider } from './openai-compatible.provider';
import {
  AIModelType,
  AIProviderConfig,
} from '../interfaces/ai-provider.interface';

describe('OpenAICompatibleProvider', () => {
  const buildProvider = (
    baseUrl: string,
    settings: Record<string, any> = {},
  ): OpenAICompatibleProvider => {
    const config: AIProviderConfig = {
      provider: 'Custom',
      sdkType: 'openai_compatible',
      apiKey: 'test-key',
      modelId: 'test-model',
      baseUrl,
      settings,
    };

    return new OpenAICompatibleProvider(config);
  };

  it('keeps the configured base URL trimmed but otherwise unchanged', () => {
    const provider = buildProvider('  https://api.example.com/v1/responses/  ');

    expect((provider as any).config.baseUrl).toBe(
      'https://api.example.com/v1/responses/',
    );
  });

  it('derives the SDK base URL from a full chat completions endpoint', () => {
    const provider = buildProvider(
      'https://openrouter.ai/api/v1/chat/completions/',
    );

    expect((provider as any).client.baseURL).toBe(
      'https://openrouter.ai/api/v1',
    );
    expect(
      (provider as any).toOpenAIClientBaseUrl((provider as any).config.baseUrl),
    ).toBe('https://openrouter.ai/api/v1');
  });

  it('derives the SDK base URL from non-chat endpoint URLs', () => {
    const provider = buildProvider('https://openrouter.ai/api/v1/embeddings/');

    expect((provider as any).client.baseURL).toBe(
      'https://openrouter.ai/api/v1',
    );
    expect(
      (provider as any).toApiRootBaseUrl((provider as any).config.baseUrl),
    ).toBe('https://openrouter.ai/api/v1');
  });

  it('builds capability endpoint URLs from the configured API root', () => {
    const provider = buildProvider(
      'https://openrouter.ai/api/v1/chat/completions',
    );

    expect((provider as any).buildProviderUrl('/videos')).toBe(
      'https://openrouter.ai/api/v1/videos',
    );
    expect((provider as any).buildProviderUrl('/audio/speech')).toBe(
      'https://openrouter.ai/api/v1/audio/speech',
    );
  });

  it('leaves SDK base URLs unchanged when no endpoint suffix is present', () => {
    const provider = buildProvider('https://openrouter.ai/api/v1');

    expect(
      (provider as any).toOpenAIClientBaseUrl((provider as any).config.baseUrl),
    ).toBe('https://openrouter.ai/api/v1');
  });

  it('does not treat every OpenRouter text model as image generation', () => {
    const provider = buildProvider('https://openrouter.ai/api/v1');

    expect((provider as any).getModelType()).toBe('text');
    expect((provider as any).usesChatModalitiesImageGeneration()).toBe(false);
  });

  it('uses chat modalities for OpenRouter image model configs', () => {
    const provider = buildProvider('https://openrouter.ai/api/v1', {
      model_type: 'image',
    });

    expect((provider as any).getModelType()).toBe('image');
    expect((provider as any).usesChatModalitiesImageGeneration()).toBe(true);
  });

  it('returns a failed image response when chat-modalities image generation rejects', async () => {
    const provider = buildProvider('https://openrouter.ai/api/v1', {
      model_type: 'image',
    });
    jest
      .spyOn((provider as any).client.chat.completions, 'create')
      .mockRejectedValueOnce(new Error('User not found'));

    const response = await provider.generateImage('connection test');

    expect(response).toMatchObject({
      success: false,
      error: 'User not found',
    });
  });

  it('keeps explicit image generation settings compatible with existing configs', () => {
    const provider = buildProvider('https://openrouter.ai/api/v1', {
      image_generation_mode: 'chat_completions',
    });

    expect((provider as any).getModelType()).toBe('image');
    expect((provider as any).usesChatModalitiesImageGeneration()).toBe(true);
  });

  it('lets explicit text model type override stale image settings', () => {
    const provider = buildProvider('https://openrouter.ai/api/v1', {
      model_type: 'text',
      image_generation_mode: 'chat_completions',
      modalities: ['image'],
    });

    expect((provider as any).getModelType()).toBe('text');
    expect((provider as any).usesChatModalitiesImageGeneration()).toBe(false);
  });

  it('uses the video endpoint for video model configs', async () => {
    const provider = buildProvider('https://openrouter.ai/api/v1', {
      model_type: 'video',
    });
    const postJson = jest.spyOn(provider as any, 'postJson').mockResolvedValue({
      id: 'job-1',
      polling_url: 'https://openrouter.ai/api/v1/videos/job-1',
      status: 'pending',
      generation_id: 'gen-1',
    });

    const response = await provider.generateVideo('mountain sunset');

    expect(postJson).toHaveBeenCalledWith(
      '/videos',
      expect.objectContaining({
        model: 'test-model',
        prompt: 'mountain sunset',
      }),
    );
    expect(response).toMatchObject({
      success: true,
      id: 'job-1',
      status: 'pending',
    });
  });

  it('uses the rerank endpoint for rerank model configs', async () => {
    const provider = buildProvider('https://openrouter.ai/api/v1', {
      model_type: 'rerank',
    });
    const postJson = jest.spyOn(provider as any, 'postJson').mockResolvedValue({
      id: 'rerank-1',
      model: 'test-model',
      results: [
        {
          index: 0,
          relevance_score: 0.98,
          document: { text: 'Paris is the capital of France.' },
        },
      ],
    });

    const response = await provider.rerank({
      query: 'capital of France',
      documents: ['Paris is the capital of France.'],
    });

    expect(postJson).toHaveBeenCalledWith(
      '/rerank',
      expect.objectContaining({
        model: 'test-model',
        query: 'capital of France',
      }),
    );
    expect(response.results?.[0]).toEqual({
      index: 0,
      relevanceScore: 0.98,
      text: 'Paris is the capital of France.',
    });
  });

  describe('transcribeAudio', () => {
    const originalFetch = global.fetch;
    let fetchMock: jest.Mock;

    beforeEach(() => {
      fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'cuántas ventas tuve hoy' }),
      });
      global.fetch = fetchMock as any;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    // wav is what the super-admin test button sends; webm is what the browser
    // records. Both must reach the endpoint as a file part.
    const silentWavBase64 = Buffer.from('RIFFfake').toString('base64');

    it('sends multipart with a file part instead of a JSON body', async () => {
      const provider = buildProvider('https://api.openai.com/v1');

      const response = await provider.transcribeAudio({
        inputAudio: { data: silentWavBase64, format: 'wav' },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');

      // The whole point: a JSON body here is refused with a 400 naming the
      // missing `file` field.
      expect(init.body).toBeInstanceOf(FormData);
      expect(typeof init.body).not.toBe('string');

      const form = init.body as FormData;
      expect(form.get('model')).toBe('test-model');

      const file = form.get('file') as Blob & { name?: string };
      expect(file).toBeInstanceOf(Blob);
      expect(file.type).toBe('audio/wav');
      // The extension is load-bearing: the API sniffs the filename to pick a
      // decoder and refuses a container it cannot name.
      expect((file as any).name).toBe('audio.wav');

      expect(response.success).toBe(true);
      expect(response.text).toBe('cuántas ventas tuve hoy');
    });

    it('lets fetch own the Content-Type so the boundary matches the body', async () => {
      const provider = buildProvider('https://api.openai.com/v1');

      await provider.transcribeAudio({
        inputAudio: { data: silentWavBase64, format: 'webm' },
      });

      const [, init] = fetchMock.mock.calls[0];
      // Setting it by hand produces a body the server cannot split, because the
      // boundary token would not match the one FormData generated.
      expect(init.headers['Content-Type']).toBeUndefined();
      expect(init.headers.Authorization).toBe('Bearer test-key');
    });

    it('maps the container to a MIME type and falls back honestly', async () => {
      const provider = buildProvider('https://api.openai.com/v1');
      const mime = (format: string) =>
        (provider as any).audioMimeType(format) as string;

      expect(mime('webm')).toBe('audio/webm');
      expect(mime('mp3')).toBe('audio/mpeg');
      expect(mime('m4a')).toBe('audio/mp4');
      // A wrong specific type is worse than a vague one: it makes the server
      // pick a decoder instead of sniffing.
      expect(mime('aiff')).toBe('application/octet-stream');
    });

    it('forwards language and temperature as form fields when set', async () => {
      const provider = buildProvider('https://api.openai.com/v1');

      await provider.transcribeAudio({
        inputAudio: { data: silentWavBase64, format: 'webm' },
        language: 'es',
        temperature: 0,
      });

      const form = fetchMock.mock.calls[0][1].body as FormData;
      expect(form.get('language')).toBe('es');
      // Zero is a legitimate temperature meaning "most deterministic"; a
      // truthiness check here would drop it.
      expect(form.get('temperature')).toBe('0');
    });

    it('omits language and temperature when neither is configured', async () => {
      const provider = buildProvider('https://api.openai.com/v1');

      await provider.transcribeAudio({
        inputAudio: { data: silentWavBase64, format: 'webm' },
      });

      const form = fetchMock.mock.calls[0][1].body as FormData;
      expect(form.get('language')).toBeNull();
      expect(form.get('temperature')).toBeNull();
    });

    it('reports a provider error as data rather than throwing', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid file format',
        json: async () => ({ error: { message: 'Invalid file format' } }),
        headers: new Map(),
      });
      const provider = buildProvider('https://api.openai.com/v1');

      const response = await provider.transcribeAudio({
        inputAudio: { data: silentWavBase64, format: 'webm' },
      });

      expect(response.success).toBe(false);
      expect(response.error).toBeTruthy();
    });

    it('treats a response without text as a failure', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      const provider = buildProvider('https://api.openai.com/v1');

      const response = await provider.transcribeAudio({
        inputAudio: { data: silentWavBase64, format: 'webm' },
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe('Transcription model returned no text');
    });
  });

  describe('model type resolution', () => {
    const withType = (
      modelType: AIModelType | undefined,
      settings: Record<string, any> = {},
    ) =>
      new OpenAICompatibleProvider({
        provider: 'OpenAI',
        sdkType: 'openai_compatible',
        apiKey: 'test-key',
        modelId: 'gpt-4o-mini-transcribe',
        baseUrl: 'https://api.openai.com/v1',
        modelType,
        settings,
      });

    // The defect this closes: the column was the only field the superadmin form
    // writes, and the provider only read `settings.model_type`. Every audio
    // configuration therefore resolved to `text`, so its connection test called
    // `/chat/completions` with an audio model and came back "Model <id> does not
    // exist" — a message that blames the model for an endpoint fault.
    it('reads the model type from the column when settings do not carry it', () => {
      expect((withType('transcription') as any).getModelType()).toBe(
        'transcription',
      );
      expect((withType('speech') as any).getModelType()).toBe('speech');
    });

    it('lets an explicit settings override win over the column', () => {
      expect(
        (withType('speech', { model_type: 'text' }) as any).getModelType(),
      ).toBe('text');
    });

    it('still infers image from settings when the column holds its default', () => {
      expect(
        (withType('text', { image_model: 'gpt-image-1' }) as any).getModelType(),
      ).toBe('image');
    });

    it('falls back to text when neither source says anything', () => {
      expect((withType(undefined) as any).getModelType()).toBe('text');
    });
  });

  describe('audio failure diagnostics', () => {
    const audioProvider = (baseUrl: string, apiKey = 'test-key') =>
      new OpenAICompatibleProvider({
        provider: 'Custom',
        sdkType: 'openai_compatible',
        apiKey,
        modelId: 'whisper-1',
        baseUrl,
        modelType: 'transcription',
        settings: {},
      });

    it('names the host and endpoint instead of the model on a 404', () => {
      const message = (
        audioProvider('https://openrouter.ai/api/v1') as any
      ).describeAudioFailure('/audio/transcriptions', '404 Not Found');

      expect(message).toContain('openrouter.ai');
      expect(message).toContain('/audio/transcriptions');
      expect(message).toContain('not its model');
    });

    it('leaves a genuine model error untouched', () => {
      const original = 'The model `whisper-9` does not exist';
      const message = (
        audioProvider('https://api.openai.com/v1') as any
      ).describeAudioFailure('/audio/transcriptions', original);

      expect(message).toBe(original);
    });

    // This provider cannot be constructed without a key — the OpenAI SDK throws
    // on an empty one — so a "no API key" message cannot live at this layer. It
    // belongs to `AIEngineService.describeInitFailure`, which is the only place
    // that observes the failed construction. Asserted here so the constraint is
    // not rediscovered by moving the check back down.
    it('refuses to construct without a key', () => {
      expect(() => audioProvider('https://api.openai.com/v1', '')).toThrow();
    });
  });
});
