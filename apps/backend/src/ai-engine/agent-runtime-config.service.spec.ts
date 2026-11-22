import {
  AgentRuntimeConfigService,
  agentVoiceFromSpeechMetadata,
} from './agent-runtime-config.service';
import { ErrorCodes } from '../common/errors';

describe('agentVoiceFromSpeechMetadata', () => {
  const speech = {
    voice: 'base-voice',
    speed: 1,
    vol: 1.5,
    agent_voices: { vex: { voice: 'vex-voice', speed: 0.9 } },
  };

  it('returns the base values when the agent has no override', () => {
    expect(agentVoiceFromSpeechMetadata(speech, 'vexi')).toEqual({
      voice: 'base-voice',
      speed: 1,
      vol: 1.5,
    });
  });

  it('overrides the base with the agent voice and keeps the rest', () => {
    expect(agentVoiceFromSpeechMetadata(speech, 'vex')).toEqual({
      voice: 'vex-voice',
      speed: 0.9,
      vol: 1.5,
    });
  });

  it('ignores invalid override values', () => {
    const bad = {
      voice: 'base-voice',
      agent_voices: { vex: { voice: '  ', speed: 'fast', vol: NaN } },
    };
    expect(agentVoiceFromSpeechMetadata(bad, 'vex')).toEqual({
      voice: 'base-voice',
    });
  });

  it('returns empty for non-object speech', () => {
    expect(agentVoiceFromSpeechMetadata(null, 'vex')).toEqual({});
    expect(agentVoiceFromSpeechMetadata('x', 'vex')).toEqual({});
  });
});

describe('AgentRuntimeConfigService', () => {
  const metadata = {
    other_key: { keep: true },
    speech: {
      voice: 'base-voice',
      response_format: 'mp3',
      agent_voices: { vexi: { voice: 'vexi-voice' } },
    },
  };
  let prisma: any;
  let audit: { log: jest.Mock };
  let aiEngine: { runSpeech: jest.Mock };
  let service: AgentRuntimeConfigService;

  beforeEach(() => {
    prisma = {
      ai_agents: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          key: 'vex',
          name: 'Vex',
          description: null,
          app_key: 'vex_app',
          system_prompt: null,
          allowed_tools: [],
          denied_tools: [],
          max_iterations: 10,
          timeout_seconds: 60,
          is_active: true,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      ai_engine_applications: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          where.key === 'vexi_voice_tts'
            ? { id: 2, key: 'vexi_voice_tts', metadata }
            : {
                id: 1,
                key: 'vex_app',
                name: 'Vex app',
                config_id: 3,
                model_type: 'text',
                is_active: true,
                temperature: 0.7,
                max_tokens: 1000,
              },
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      ai_engine_configs: {
        findUnique: jest.fn().mockResolvedValue({
          id: 3,
          label: 'L',
          provider: 'p',
          model_id: 'm',
          model_type: 'text',
          is_active: true,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ai_voice_profiles: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      store_settings: { findUnique: jest.fn() },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    aiEngine = { runSpeech: jest.fn() };
    service = new AgentRuntimeConfigService(
      prisma,
      audit as any,
      aiEngine as any,
      { resolveEffectiveEntitlements: jest.fn() } as any,
    );
  });

  it('rejects an invalid agentKey with SYS_VALIDATION_001', async () => {
    await expect(service.getAgentSheet('other')).rejects.toMatchObject({
      errorCode: ErrorCodes.SYS_VALIDATION_001.code,
    });
  });

  it('answers SYS_NOT_FOUND_001 when the agent row is missing', async () => {
    prisma.ai_agents.findUnique.mockResolvedValue(null);
    await expect(service.getAgentSheet('vex')).rejects.toMatchObject({
      errorCode: ErrorCodes.SYS_NOT_FOUND_001.code,
    });
  });

  it('marks temperature and max_tokens as unused by agents', async () => {
    const sheet = await service.getAgentSheet('vex');
    expect(sheet.unused_by_agents.temperature.unused_by_agents).toBe(true);
    expect(sheet.unused_by_agents.max_tokens.unused_by_agents).toBe(true);
    expect(sheet.voice.effective.voice).toBe('base-voice');
  });

  it('merges the voice without losing metadata or speech keys, and audits', async () => {
    await service.updateAgentSheet(
      'vex',
      { voice: { voice: 'new-voice', speed: 1.1 } },
      99,
    );
    const call = prisma.ai_engine_applications.update.mock.calls.find(
      ([a]: any) => a.where.key === 'vexi_voice_tts',
    );
    const saved = call[0].data.metadata;
    expect(saved.other_key).toEqual({ keep: true });
    expect(saved.speech.voice).toBe('base-voice');
    expect(saved.speech.response_format).toBe('mp3');
    expect(saved.speech.agent_voices.vexi).toEqual({ voice: 'vexi-voice' });
    expect(saved.speech.agent_voices.vex).toEqual({
      voice: 'new-voice',
      speed: 1.1,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 99,
        resource: 'ai_agents',
        resourceId: 7,
      }),
    );
  });

  it('points the agent app at another config', async () => {
    await service.updateAgentSheet('vex', { config_id: 3 }, 1);
    expect(prisma.ai_engine_applications.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'vex_app' },
        data: expect.objectContaining({ config_id: 3 }),
      }),
    );
  });

  it('rejects an invalid agentKey on update without writing', async () => {
    await expect(
      service.updateAgentSheet('x', { config_id: 3 }, 1),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.SYS_VALIDATION_001.code });
    expect(prisma.ai_engine_applications.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('previews with the effective voice of the agent', async () => {
    aiEngine.runSpeech.mockResolvedValue({
      success: true,
      audioBase64: 'AAA',
      contentType: 'audio/mpeg',
    });
    prisma.ai_agents.findUnique.mockResolvedValue({ id: 8, key: 'vexi' });
    const out = await service.previewVoice('vexi');
    expect(out).toEqual({ audioBase64: 'AAA', contentType: 'audio/mpeg' });
    expect(aiEngine.runSpeech).toHaveBeenCalledWith(
      'vexi_voice_tts',
      { text: expect.any(String) },
      expect.objectContaining({ voice: 'vexi-voice', responseFormat: 'mp3' }),
    );
  });

  describe('catalog voice (F8 T49)', () => {
    const profile = {
      id: 5,
      name: 'Kore',
      voice_id: 'Kore',
      language: 'es',
      speed: null,
      vol: null,
      is_active: true,
      config: {
        id: 42,
        label: 'Gemini TTS',
        provider: 'google',
        model_id: 'gemini-tts',
        is_active: true,
      },
    };

    it('shows the assigned profile and the active catalog on the sheet', async () => {
      prisma.ai_agents.findUnique.mockResolvedValue({
        id: 7,
        key: 'vex',
        app_key: 'vex_app',
        voice_profile_id: 5,
      });
      prisma.ai_voice_profiles.findUnique.mockResolvedValue(profile);
      prisma.ai_voice_profiles.findMany.mockResolvedValue([profile]);

      const sheet = await service.getAgentSheet('vex');

      expect(sheet.voice.profile).toEqual({
        id: 5,
        name: 'Kore',
        voice_id: 'Kore',
        language: 'es',
        provider: 'google',
        config_label: 'Gemini TTS',
        is_active: true,
      });
      expect(sheet.available_voice_profiles).toEqual([
        {
          id: 5,
          name: 'Kore',
          voice_id: 'Kore',
          language: 'es',
          provider: 'google',
          config_label: 'Gemini TTS',
        },
      ]);
      expect(prisma.ai_voice_profiles.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { is_active: true, config: { is_active: true } },
        }),
      );
    });

    it('assigns the voice to that agent row only', async () => {
      prisma.ai_voice_profiles.findUnique.mockResolvedValue(profile);

      await service.updateAgentSheet('vex', { voice_profile_id: 5 }, 99);

      expect(prisma.ai_agents.update).toHaveBeenCalledTimes(1);
      expect(prisma.ai_agents.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ voice_profile_id: 5 }),
      });
      // The fallback voice of the transition is read-only here.
      expect(prisma.ai_engine_applications.update).not.toHaveBeenCalled();
    });

    it('clears the voice with null without validating a profile', async () => {
      await service.updateAgentSheet('vex', { voice_profile_id: null }, 99);

      expect(prisma.ai_agents.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ voice_profile_id: null }),
      });
    });

    it.each([
      ['missing', null],
      ['inactive', { ...profile, is_active: false }],
      [
        'on an inactive provider',
        { ...profile, config: { ...profile.config, is_active: false } },
      ],
    ])('rejects a %s voice without writing', async (_name, row) => {
      prisma.ai_voice_profiles.findUnique.mockResolvedValue(row);

      await expect(
        service.updateAgentSheet('vex', { voice_profile_id: 5 }, 99),
      ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
      expect(prisma.ai_agents.update).not.toHaveBeenCalled();
    });

    it('previews with the assigned profile on its own provider', async () => {
      prisma.ai_agents.findUnique.mockResolvedValue({
        id: 7,
        key: 'vex',
        voice_profile_id: 5,
      });
      prisma.ai_voice_profiles.findUnique.mockResolvedValue(profile);
      aiEngine.runSpeech.mockResolvedValue({
        success: true,
        audioBase64: 'AAAA',
        contentType: 'audio/wav',
      });

      await service.previewVoice('vex');

      expect(aiEngine.runSpeech).toHaveBeenCalledWith(
        'vexi_voice_tts',
        expect.any(Object),
        expect.objectContaining({ voice: 'Kore', model: 'gemini-tts' }),
        { configId: 42 },
      );
    });
  });

  it('rejects preview text over 120 characters', async () => {
    await expect(
      service.previewVoice('vex', 'x'.repeat(121)),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.SYS_VALIDATION_001.code });
  });
});
