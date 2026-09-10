import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { AIProviderConfig } from '../interfaces/ai-provider.interface';

describe('OpenAICompatibleProvider.generateEmbedding', () => {
  const buildProvider = (
    settings: Record<string, any> = {},
    modelId = 'config-model',
  ): OpenAICompatibleProvider => {
    const config: AIProviderConfig = {
      provider: 'Custom',
      sdkType: 'openai_compatible',
      apiKey: 'test-key',
      modelId,
      baseUrl: 'https://api.example.com/v1',
      settings,
    };

    return new OpenAICompatibleProvider(config);
  };

  const mockEmbeddingsCreate = (provider: OpenAICompatibleProvider) =>
    jest
      .spyOn((provider as any).client.embeddings, 'create')
      .mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        model: 'response-model',
        usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
      } as any);

  it('prefers options.model over settings.embedding_model and the config modelId', async () => {
    const provider = buildProvider({ embedding_model: 'settings-model' });
    const create = mockEmbeddingsCreate(provider);

    await provider.generateEmbedding('hello', { model: 'options-model' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'options-model', input: 'hello' }),
    );
  });

  it('falls back to settings.embedding_model, then to the config modelId', async () => {
    const withSettings = buildProvider({ embedding_model: 'settings-model' });
    const createSettings = mockEmbeddingsCreate(withSettings);
    await withSettings.generateEmbedding('hello');
    expect(createSettings).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'settings-model' }),
    );

    const bare = buildProvider();
    const createBare = mockEmbeddingsCreate(bare);
    await bare.generateEmbedding('hello');
    expect(createBare).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'config-model' }),
    );
  });

  it('defaults encoding_format to float', async () => {
    const provider = buildProvider();
    const create = mockEmbeddingsCreate(provider);

    await provider.generateEmbedding('hello');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ encoding_format: 'float' }),
    );
  });

  it('prefers options.encodingFormat, then settings.encoding_format', async () => {
    const provider = buildProvider({ encoding_format: 'base64' });
    const create = mockEmbeddingsCreate(provider);

    await provider.generateEmbedding('hello', { encodingFormat: 'base64' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ encoding_format: 'base64' }),
    );

    create.mockClear();
    await provider.generateEmbedding('hello');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ encoding_format: 'base64' }),
    );
  });

  it('passes dimensions through only when provided', async () => {
    const provider = buildProvider();
    const create = mockEmbeddingsCreate(provider);

    await provider.generateEmbedding('hello', { dimensions: 512 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 512 }),
    );

    create.mockClear();
    await provider.generateEmbedding('hello');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).not.toHaveProperty('dimensions');
  });

  it('returns the first embedding with the response model', async () => {
    const provider = buildProvider();

    mockEmbeddingsCreate(provider);
    const response = await provider.generateEmbedding('hello');

    expect(response).toMatchObject({
      success: true,
      embedding: [0.1, 0.2, 0.3],
      model: 'response-model',
    });
    expect(response.embeddings).toEqual([[0.1, 0.2, 0.3]]);
  });

  it('reports an SDK rejection as data rather than throwing', async () => {
    const provider = buildProvider();
    jest
      .spyOn((provider as any).client.embeddings, 'create')
      .mockRejectedValueOnce(new Error('rate limited'));

    const response = await provider.generateEmbedding('hello');

    expect(response).toEqual({ success: false, error: 'rate limited' });
  });

  it('reports an empty data array as a failure', async () => {
    const provider = buildProvider();
    jest
      .spyOn((provider as any).client.embeddings, 'create')
      .mockResolvedValueOnce({ data: [], model: 'm' } as any);

    const response = await provider.generateEmbedding('hello');

    expect(response.success).toBe(false);
    expect(response.error).toBe('Embedding model returned no data');
  });
});
