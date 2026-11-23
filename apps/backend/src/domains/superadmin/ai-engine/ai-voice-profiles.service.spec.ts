import { ErrorCodes } from '../../../common/errors';
import { AIVoiceProfilesService } from './ai-voice-profiles.service';

describe('AIVoiceProfilesService', () => {
  const config = {
    id: 42,
    label: 'Gemini TTS',
    provider: 'google',
    sdk_type: 'gemini_tts',
    model_id: 'gemini-tts',
    is_active: true,
  };
  const row = (over: Record<string, unknown> = {}) => ({
    id: 5,
    name: 'Kore',
    voice_id: 'Kore',
    language: 'es',
    speed: null,
    vol: null,
    sample_text: null,
    is_active: true,
    created_at: null,
    updated_at: null,
    config,
    agents: [],
    ...over,
  });

  let prisma: any;
  let audit: { log: jest.Mock };
  let aiEngine: { runSpeech: jest.Mock };
  let service: AIVoiceProfilesService;

  beforeEach(() => {
    prisma = {
      ai_voice_profiles: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(row()),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(row()),
        update: jest.fn().mockResolvedValue(row()),
      },
      ai_engine_configs: {
        findUnique: jest.fn().mockResolvedValue({
          id: 42,
          is_active: true,
          model_type: 'speech',
        }),
        findMany: jest.fn().mockResolvedValue([config]),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    aiEngine = {
      runSpeech: jest.fn().mockResolvedValue({
        success: true,
        audioBase64: 'AAAA',
        contentType: 'audio/wav',
      }),
    };
    service = new AIVoiceProfilesService(prisma, audit as any, aiEngine as any);
  });

  it('lists voices with the agents that read with them and no secrets', async () => {
    prisma.ai_voice_profiles.findMany.mockResolvedValue([
      row({ speed: '1.10', agents: [{ key: 'vex' }] }),
    ]);

    const [voice] = await service.list();

    expect(voice.assigned_agents).toEqual(['vex']);
    expect(voice.speed).toBe(1.1);
    const select = prisma.ai_voice_profiles.findMany.mock.calls[0][0].select;
    expect(select.config.select).not.toHaveProperty('api_key_ref');
    expect(select.config.select).not.toHaveProperty('settings');
  });

  it('offers only active speech providers, without secrets', async () => {
    const out = await service.listSpeechConfigs();

    expect(prisma.ai_engine_configs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { is_active: true, model_type: 'speech' },
      }),
    );
    expect(out).toEqual([
      {
        id: 42,
        label: 'Gemini TTS',
        provider: 'google',
        sdk_type: 'gemini_tts',
        model_id: 'gemini-tts',
      },
    ]);
  });

  it('registers a voice trimmed, in Spanish by default, and audits it', async () => {
    await service.create(
      { config_id: 42, voice_id: ' Kore ', name: ' Kore ' },
      9,
    );

    expect(prisma.ai_voice_profiles.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          config_id: 42,
          voice_id: 'Kore',
          name: 'Kore',
          language: 'es',
          speed: null,
          vol: null,
          sample_text: null,
          is_active: true,
        },
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ resource: 'ai_voice_profiles', userId: 9 }),
    );
  });

  it.each([
    ['missing', null],
    ['inactive', { id: 42, is_active: false, model_type: 'speech' }],
    ['not a speech one', { id: 42, is_active: true, model_type: 'text' }],
  ])('rejects a %s provider without writing', async (_name, found) => {
    prisma.ai_engine_configs.findUnique.mockResolvedValue(found);

    await expect(
      service.create({ config_id: 42, voice_id: 'Kore', name: 'Kore' }, 9),
    ).rejects.toMatchObject({
      errorCode: ErrorCodes.SYS_VALIDATION_001.code,
    });
    expect(prisma.ai_voice_profiles.create).not.toHaveBeenCalled();
  });

  it('rejects the same voice twice under one provider', async () => {
    prisma.ai_voice_profiles.findFirst.mockResolvedValue({
      id: 1,
      name: 'Otra',
    });

    await expect(
      service.create({ config_id: 42, voice_id: 'Kore', name: 'Kore' }, 9),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.SYS_CONFLICT_001.code });
    expect(prisma.ai_voice_profiles.create).not.toHaveBeenCalled();
  });

  it('refuses to deactivate a voice an agent reads with', async () => {
    prisma.ai_voice_profiles.findUnique.mockResolvedValue(
      row({ agents: [{ key: 'vex' }] }),
    );

    await expect(
      service.update(5, { is_active: false }, 9),
    ).rejects.toMatchObject({
      errorCode: ErrorCodes.SYS_VALIDATION_001.code,
    });
    expect(prisma.ai_voice_profiles.update).not.toHaveBeenCalled();
  });

  it('deactivates an unassigned voice and audits before/after', async () => {
    prisma.ai_voice_profiles.update.mockResolvedValue(
      row({ is_active: false }),
    );

    const out = await service.update(5, { is_active: false }, 9);

    expect(out.is_active).toBe(false);
    expect(prisma.ai_voice_profiles.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({ is_active: false }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValues: expect.objectContaining({ is_active: true }),
        newValues: expect.objectContaining({ is_active: false }),
      }),
    );
  });

  it('answers SYS_NOT_FOUND_001 for an unknown voice', async () => {
    prisma.ai_voice_profiles.findUnique.mockResolvedValue(null);

    await expect(service.update(77, { name: 'x' }, 9)).rejects.toMatchObject({
      errorCode: ErrorCodes.SYS_NOT_FOUND_001.code,
    });
  });

  it('previews on the voice own provider, model and voice id', async () => {
    const out = await service.preview(5);

    expect(aiEngine.runSpeech).toHaveBeenCalledWith(
      'vexi_voice_tts',
      { text: expect.any(String) },
      { model: 'gemini-tts', voice: 'Kore', responseFormat: 'mp3' },
      { configId: 42 },
    );
    expect(out).toEqual({ audioBase64: 'AAAA', contentType: 'audio/wav' });
  });

  it('previews an inactive voice: listening is how it gets activated', async () => {
    prisma.ai_voice_profiles.findUnique.mockResolvedValue(
      row({ is_active: false, sample_text: 'Hola.' }),
    );

    await service.preview(5);

    expect(aiEngine.runSpeech).toHaveBeenCalledWith(
      'vexi_voice_tts',
      { text: 'Hola.' },
      expect.any(Object),
      { configId: 42 },
    );
  });

  it('rejects a sample over 120 characters without calling the provider', async () => {
    await expect(service.preview(5, 'x'.repeat(121))).rejects.toMatchObject({
      errorCode: ErrorCodes.SYS_VALIDATION_001.code,
    });
    expect(aiEngine.runSpeech).not.toHaveBeenCalled();
  });

  it('surfaces a provider failure as AI_PROVIDER_001', async () => {
    aiEngine.runSpeech.mockResolvedValue({ success: false, error: 'boom' });

    await expect(service.preview(5)).rejects.toMatchObject({
      errorCode: ErrorCodes.AI_PROVIDER_001.code,
    });
  });
});
