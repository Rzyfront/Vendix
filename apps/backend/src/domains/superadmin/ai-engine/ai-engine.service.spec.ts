import { AIEngineConfigService } from './ai-engine.service';

describe('AIEngineConfigService', () => {
  let service: AIEngineConfigService;
  let prisma: {
    ai_engine_configs: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let aiEngine: { reloadConfigurations: jest.Mock };

  beforeEach(() => {
    prisma = {
      ai_engine_configs: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    aiEngine = { reloadConfigurations: jest.fn() };

    service = new AIEngineConfigService(
      prisma as any,
      aiEngine as any,
      {} as any,
    );
  });

  describe('cleanBaseUrl', () => {
    it('trims whitespace without stripping endpoint paths or trailing slashes', () => {
      const baseUrl = '  https://api.example.com/v1/chat/completions/  ';

      expect((service as any).cleanBaseUrl(baseUrl)).toBe(
        'https://api.example.com/v1/chat/completions/',
      );
    });

    it('returns undefined for empty values', () => {
      expect((service as any).cleanBaseUrl('   ')).toBeUndefined();
      expect((service as any).cleanBaseUrl(null)).toBeUndefined();
      expect((service as any).cleanBaseUrl(undefined)).toBeUndefined();
    });
  });

  describe('update', () => {
    const existingConfig = {
      id: 7,
      provider: 'Custom',
      sdk_type: 'openai_compatible',
      label: 'Custom model',
      model_id: 'custom-model',
      base_url: 'https://old.example.com/v1',
      api_key_ref: null,
      is_default: false,
      is_active: true,
      settings: {},
    };

    it('persists the edited base URL without altering the path', async () => {
      prisma.ai_engine_configs.findUnique.mockResolvedValueOnce(existingConfig);
      prisma.ai_engine_configs.update.mockResolvedValueOnce({
        ...existingConfig,
        base_url: 'https://api.example.com/v1/responses/',
      });

      await service.update(7, {
        base_url: '  https://api.example.com/v1/responses/  ',
      } as any);

      expect(prisma.ai_engine_configs.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7 },
          data: expect.objectContaining({
            base_url: 'https://api.example.com/v1/responses/',
          }),
        }),
      );
      expect(aiEngine.reloadConfigurations).toHaveBeenCalled();
    });

    it('clears the previous base URL when the edit sends null', async () => {
      prisma.ai_engine_configs.findUnique.mockResolvedValueOnce(existingConfig);
      prisma.ai_engine_configs.update.mockResolvedValueOnce({
        ...existingConfig,
        base_url: null,
      });

      await service.update(7, { base_url: null } as any);

      expect(prisma.ai_engine_configs.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7 },
          data: expect.objectContaining({ base_url: null }),
        }),
      );
    });
  });
});
