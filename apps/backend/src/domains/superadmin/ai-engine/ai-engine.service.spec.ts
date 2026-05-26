import { AIEngineConfigService } from './ai-engine.service';

describe('AIEngineConfigService', () => {
  let service: AIEngineConfigService;
  let prisma: {
    ai_engine_configs: {
      findUnique: jest.Mock;
      update: jest.Mock;
      create?: jest.Mock;
      updateMany?: jest.Mock;
      findMany?: jest.Mock;
      count?: jest.Mock;
    };
  };
  let aiEngine: { reloadConfigurations: jest.Mock };

  beforeEach(() => {
    prisma = {
      ai_engine_configs: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
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

  describe('model_type', () => {
    it('create: persists model_type from the DTO when provided', async () => {
      prisma.ai_engine_configs.findUnique.mockResolvedValueOnce(null);
      prisma.ai_engine_configs.create!.mockResolvedValueOnce({
        id: 11,
        provider: 'OpenAI',
        sdk_type: 'openai_compatible',
        label: 'Image gen',
        model_id: 'gpt-image-1',
        model_type: 'image',
        api_key_ref: null,
      });

      await service.create({
        provider: 'OpenAI',
        sdk_type: 'openai_compatible',
        label: 'Image gen',
        model_id: 'gpt-image-1',
        model_type: 'image',
      } as any);

      expect(prisma.ai_engine_configs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ model_type: 'image' }),
        }),
      );
      expect(aiEngine.reloadConfigurations).toHaveBeenCalled();
    });

    it('findAll: passes the model_type filter to the Prisma where clause', async () => {
      prisma.ai_engine_configs.findMany!.mockResolvedValueOnce([]);
      prisma.ai_engine_configs.count!.mockResolvedValueOnce(0);

      await service.findAll({
        page: 1,
        limit: 10,
        model_type: 'embedding',
      } as any);

      expect(prisma.ai_engine_configs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ model_type: 'embedding' }),
        }),
      );
      expect(prisma.ai_engine_configs.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ model_type: 'embedding' }),
        }),
      );
    });
  });
});
