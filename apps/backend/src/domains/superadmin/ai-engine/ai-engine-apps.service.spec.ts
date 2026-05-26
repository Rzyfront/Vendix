import { AIEngineAppsService } from './ai-engine-apps.service';

describe('AIEngineAppsService', () => {
  let service: AIEngineAppsService;
  let prisma: {
    ai_engine_applications: {
      findUnique: jest.Mock;
    };
  };
  let aiEngine: {
    getApplicationModelType: jest.Mock;
    run: jest.Mock;
    runImage: jest.Mock;
    runEmbedding: jest.Mock;
    runVideo: jest.Mock;
    runSpeech: jest.Mock;
    runTranscription: jest.Mock;
    runRerank: jest.Mock;
  };

  const app = {
    id: 10,
    key: 'test_app',
    name: 'Test App',
    output_format: 'text',
    is_active: true,
  };

  beforeEach(() => {
    prisma = {
      ai_engine_applications: {
        findUnique: jest.fn(),
      },
    };
    aiEngine = {
      getApplicationModelType: jest.fn(),
      run: jest.fn(),
      runImage: jest.fn(),
      runEmbedding: jest.fn(),
      runVideo: jest.fn(),
      runSpeech: jest.fn(),
      runTranscription: jest.fn(),
      runRerank: jest.fn(),
    };

    service = new AIEngineAppsService(prisma as any, aiEngine as any);
  });

  it('tests embedding applications with the embedding contract', async () => {
    prisma.ai_engine_applications.findUnique.mockResolvedValueOnce(app);
    aiEngine.getApplicationModelType.mockResolvedValueOnce('embedding');
    aiEngine.runEmbedding.mockResolvedValueOnce({
      success: true,
      embedding: [0.1, 0.2],
    });

    const result = await service.testApplication(10);

    expect(aiEngine.runEmbedding).toHaveBeenCalledWith(
      'test_app',
      expect.objectContaining({ name: 'Test', context: 'Testing' }),
    );
    expect(aiEngine.run).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      content: '[0.1,0.2]',
      model_type: 'embedding',
    });
  });

  it('uses the app output format when it declares a specialized contract', async () => {
    prisma.ai_engine_applications.findUnique.mockResolvedValueOnce({
      ...app,
      output_format: 'video',
    });
    aiEngine.getApplicationModelType.mockResolvedValueOnce('text');
    aiEngine.runVideo.mockResolvedValueOnce({
      success: true,
      id: 'job_123',
      status: 'queued',
    });

    const result = await service.testApplication(10);

    expect(aiEngine.runVideo).toHaveBeenCalledWith(
      'test_app',
      expect.objectContaining({ name: 'Test', context: 'Testing' }),
    );
    expect(aiEngine.run).not.toHaveBeenCalled();
    expect(result.model_type).toBe('video');
  });

  it('uses image execution when the app output format is image', async () => {
    prisma.ai_engine_applications.findUnique.mockResolvedValueOnce({
      ...app,
      output_format: 'image',
    });
    aiEngine.getApplicationModelType.mockResolvedValueOnce('text');
    aiEngine.runImage.mockResolvedValueOnce({
      success: true,
      imageBase64: 'data:image/png;base64,abc',
    });

    const result = await service.testApplication(10);

    expect(aiEngine.runImage).toHaveBeenCalledWith(
      'test_app',
      expect.objectContaining({ name: 'Test', context: 'Testing' }),
    );
    expect(result.model_type).toBe('image');
  });

  it('adds sample audio when testing audio chat applications', async () => {
    prisma.ai_engine_applications.findUnique.mockResolvedValueOnce(app);
    aiEngine.getApplicationModelType.mockResolvedValueOnce('audio');
    aiEngine.run.mockResolvedValueOnce({
      success: true,
      content: 'OK',
    });

    await service.testApplication(10);

    expect(aiEngine.run).toHaveBeenCalledWith(
      'test_app',
      expect.objectContaining({ name: 'Test', context: 'Testing' }),
      [
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({ type: 'input_audio' }),
          ]),
        }),
      ],
    );
  });

  describe('model_type cross-validation', () => {
    let prismaFull: {
      ai_engine_applications: {
        findUnique: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
        findMany: jest.Mock;
        count: jest.Mock;
      };
      ai_engine_configs: {
        findUnique: jest.Mock;
      };
    };
    let serviceFull: AIEngineAppsService;

    beforeEach(() => {
      prismaFull = {
        ai_engine_applications: {
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          findMany: jest.fn(),
          count: jest.fn(),
        },
        ai_engine_configs: {
          findUnique: jest.fn(),
        },
      };
      serviceFull = new AIEngineAppsService(
        prismaFull as any,
        aiEngine as any,
      );
    });

    it('create: throws VendixHttpException AI_APP_005 when config model_type differs from app model_type', async () => {
      prismaFull.ai_engine_applications.findUnique.mockResolvedValueOnce(null);
      prismaFull.ai_engine_configs.findUnique.mockResolvedValueOnce({
        id: 1,
        model_type: 'text',
      });

      await expect(
        serviceFull.create({
          key: 'image_app',
          name: 'Image App',
          config_id: 1,
          model_type: 'image',
        } as any),
      ).rejects.toMatchObject({ errorCode: 'AI_APP_005' });

      expect(prismaFull.ai_engine_applications.create).not.toHaveBeenCalled();
    });

    it('create: succeeds and persists model_type when DTO and config types match', async () => {
      prismaFull.ai_engine_applications.findUnique.mockResolvedValueOnce(null);
      prismaFull.ai_engine_configs.findUnique.mockResolvedValueOnce({
        id: 2,
        model_type: 'image',
      });
      prismaFull.ai_engine_applications.create.mockResolvedValueOnce({
        id: 99,
        key: 'image_app',
        model_type: 'image',
      });

      await serviceFull.create({
        key: 'image_app',
        name: 'Image App',
        config_id: 2,
        model_type: 'image',
      } as any);

      expect(prismaFull.ai_engine_applications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            key: 'image_app',
            model_type: 'image',
            config_id: 2,
          }),
        }),
      );
    });

    it("create: when DTO omits model_type, falls back to the config's model_type", async () => {
      prismaFull.ai_engine_applications.findUnique.mockResolvedValueOnce(null);
      prismaFull.ai_engine_configs.findUnique.mockResolvedValueOnce({
        id: 3,
        model_type: 'embedding',
      });
      prismaFull.ai_engine_applications.create.mockResolvedValueOnce({
        id: 100,
        key: 'emb_app',
        model_type: 'embedding',
      });

      await serviceFull.create({
        key: 'emb_app',
        name: 'Embedding App',
        config_id: 3,
      } as any);

      expect(prismaFull.ai_engine_applications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            model_type: 'embedding',
          }),
        }),
      );
    });

    it('create: defaults to text when neither DTO nor config declare a model_type', async () => {
      prismaFull.ai_engine_applications.findUnique.mockResolvedValueOnce(null);
      prismaFull.ai_engine_applications.create.mockResolvedValueOnce({
        id: 101,
        key: 'plain_app',
        model_type: 'text',
      });

      await serviceFull.create({
        key: 'plain_app',
        name: 'Plain App',
      } as any);

      expect(prismaFull.ai_engine_configs.findUnique).not.toHaveBeenCalled();
      expect(prismaFull.ai_engine_applications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            model_type: 'text',
          }),
        }),
      );
    });

    it('update: throws AI_APP_005 when a new config_id has a different model_type than the existing app', async () => {
      // First findUnique call inside update() resolves the existing row.
      prismaFull.ai_engine_applications.findUnique.mockResolvedValueOnce({
        id: 50,
        key: 'image_app',
        model_type: 'image',
      });
      prismaFull.ai_engine_configs.findUnique.mockResolvedValueOnce({
        id: 7,
        model_type: 'text',
      });

      await expect(
        serviceFull.update(50, {
          config_id: 7,
        } as any),
      ).rejects.toMatchObject({ errorCode: 'AI_APP_005' });

      expect(prismaFull.ai_engine_applications.update).not.toHaveBeenCalled();
    });

    it('findAll: passes the model_type filter to the Prisma where clause', async () => {
      prismaFull.ai_engine_applications.findMany.mockResolvedValueOnce([]);
      prismaFull.ai_engine_applications.count.mockResolvedValueOnce(0);

      await serviceFull.findAll({
        page: 1,
        limit: 10,
        model_type: 'image',
      } as any);

      expect(prismaFull.ai_engine_applications.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ model_type: 'image' }),
        }),
      );
      expect(prismaFull.ai_engine_applications.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ model_type: 'image' }),
        }),
      );
    });
  });
});
