import { AIEngineConfigService } from '../../domains/superadmin/ai-engine/ai-engine.service';

/**
 * F-001 regression: the superadmin panel round-trips maskApiKey() output
 * ('****' + last4, or bare '****') when the operator did not type a new
 * secret. update() must drop such a value from the payload so the stored
 * ref survives; persisting the mask orphans the real secret and every
 * provider call fails with AI_PROVIDER_002.
 *
 * Lives under ai-engine/embeddings/ per the B.3 scope (new specs only
 * under apps/backend/src/ai-engine/); it exercises the config service
 * that owns the embedding provider's api_key_ref.
 */
describe('AIEngineConfigService.update — F-001 masked ref regression', () => {
  let service: AIEngineConfigService;
  let prisma: {
    ai_engine_configs: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let aiEngine: { reloadConfigurations: jest.Mock };

  const existingConfig = {
    id: 7,
    provider: 'OpenAI',
    sdk_type: 'openai_compatible',
    label: 'Embeddings',
    model_id: 'text-embedding-3-small',
    model_type: 'text',
    base_url: 'https://api.openai.com/v1',
    api_key_ref: 'secret-ref-real',
    is_default: false,
    is_active: true,
    settings: {},
  };

  beforeEach(() => {
    prisma = {
      ai_engine_configs: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    aiEngine = { reloadConfigurations: jest.fn() };
    service = new AIEngineConfigService(
      prisma as any,
      aiEngine as any,
      {} as any,
    );
  });

  it("drops a masked ref ('****' + last4) so the stored ref survives", async () => {
    prisma.ai_engine_configs.findUnique.mockResolvedValueOnce(existingConfig);
    prisma.ai_engine_configs.update.mockResolvedValueOnce({
      ...existingConfig,
      label: 'Embeddings v2',
    });

    const result = await service.update(7, {
      label: 'Embeddings v2',
      api_key_ref: '****real',
    } as any);

    const data = prisma.ai_engine_configs.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('api_key_ref');
    // The row kept the real ref; the caller only sees the mask.
    expect(result.api_key_ref).toBe('****real');
  });

  it("drops a bare '****' mask as well", async () => {
    prisma.ai_engine_configs.findUnique.mockResolvedValueOnce(existingConfig);
    prisma.ai_engine_configs.update.mockResolvedValueOnce(existingConfig);

    await service.update(7, { api_key_ref: '****' } as any);

    const data = prisma.ai_engine_configs.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('api_key_ref');
  });

  it('persists a genuine new ref that does not start with ****', async () => {
    prisma.ai_engine_configs.findUnique.mockResolvedValueOnce(existingConfig);
    prisma.ai_engine_configs.update.mockResolvedValueOnce({
      ...existingConfig,
      api_key_ref: 'brand-new-secret-ref',
    });

    await service.update(7, { api_key_ref: 'brand-new-secret-ref' } as any);

    const data = prisma.ai_engine_configs.update.mock.calls[0][0].data;
    expect(data).toHaveProperty('api_key_ref', 'brand-new-secret-ref');
  });

  it('leaves the payload alone when no ref is sent', async () => {
    prisma.ai_engine_configs.findUnique.mockResolvedValueOnce(existingConfig);
    prisma.ai_engine_configs.update.mockResolvedValueOnce(existingConfig);

    await service.update(7, { label: 'Embeddings v2' } as any);

    const data = prisma.ai_engine_configs.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('api_key_ref');
    expect(aiEngine.reloadConfigurations).toHaveBeenCalled();
  });
});
