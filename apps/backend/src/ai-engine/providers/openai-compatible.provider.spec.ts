import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { AIProviderConfig } from '../interfaces/ai-provider.interface';

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
});
