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
});
