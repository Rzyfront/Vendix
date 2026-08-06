import { VexiRealtimeService } from './vexi-realtime.service';

describe('VexiRealtimeService', () => {
  let service: VexiRealtimeService;
  let prisma: {
    ai_engine_applications: { findUnique: jest.Mock };
    ai_engine_configs: { findFirst: jest.Mock };
  };

  const audioConfig = {
    id: 5,
    provider: 'OpenAI',
    model_id: 'gpt-realtime-2.1',
    model_type: 'audio',
    base_url: null,
    api_key_ref: 'sk-test',
    is_active: true,
    is_default: false,
    settings: {},
  };

  const voiceApp = {
    id: 18,
    key: 'vexi_realtime_voice',
    is_active: true,
    system_prompt: 'Eres Vexi, responde breve.',
    config_id: 5,
    config: audioConfig,
  };

  beforeEach(() => {
    prisma = {
      ai_engine_applications: { findUnique: jest.fn() },
      ai_engine_configs: { findFirst: jest.fn() },
    };

    service = new VexiRealtimeService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  describe('resolveVoiceSetup', () => {
    it('uses the application and its linked config when both are active', async () => {
      prisma.ai_engine_applications.findUnique.mockResolvedValueOnce(voiceApp);

      const result = await (service as any).resolveVoiceSetup();

      expect(result.config).toBe(audioConfig);
      expect(result.instructions).toBe('Eres Vexi, responde breve.');
      // The linked config short-circuits the scan entirely.
      expect(prisma.ai_engine_configs.findFirst).not.toHaveBeenCalled();
    });

    it('keeps the persona but falls back on transport when no config is linked', async () => {
      // State right after the migration: the row exists with config_id NULL.
      prisma.ai_engine_applications.findUnique.mockResolvedValueOnce({
        ...voiceApp,
        config_id: null,
        config: null,
      });
      prisma.ai_engine_configs.findFirst.mockResolvedValueOnce(audioConfig);

      const result = await (service as any).resolveVoiceSetup();

      expect(result.config).toBe(audioConfig);
      // Editing the prompt must work before anyone touches the config selector.
      expect(result.instructions).toBe('Eres Vexi, responde breve.');
      expect(prisma.ai_engine_configs.findFirst).toHaveBeenCalled();
    });

    it('ignores an inactive application without muting the voice', async () => {
      // An inactive app is "not configured", never an off switch:
      // VexiEnabledGuard is the only thing that mutes the voice.
      prisma.ai_engine_applications.findUnique.mockResolvedValueOnce({
        ...voiceApp,
        is_active: false,
      });
      prisma.ai_engine_configs.findFirst.mockResolvedValueOnce(audioConfig);

      const result = await (service as any).resolveVoiceSetup();

      expect(result.config).toBe(audioConfig);
      expect(result.instructions).toBeNull();
    });

    it('ignores a linked config that is inactive and scans instead', async () => {
      prisma.ai_engine_applications.findUnique.mockResolvedValueOnce({
        ...voiceApp,
        config: { ...audioConfig, is_active: false },
      });
      prisma.ai_engine_configs.findFirst.mockResolvedValueOnce(null);

      const result = await (service as any).resolveVoiceSetup();

      expect(result.config).toBeNull();
      expect(prisma.ai_engine_configs.findFirst).toHaveBeenCalled();
    });

    it('falls back completely when the application row does not exist', async () => {
      // An install where neither the seed nor the migration ran.
      prisma.ai_engine_applications.findUnique.mockResolvedValueOnce(null);
      prisma.ai_engine_configs.findFirst.mockResolvedValueOnce(audioConfig);

      const result = await (service as any).resolveVoiceSetup();

      expect(result.config).toBe(audioConfig);
      expect(result.instructions).toBeNull();
    });

    it('treats a blank system prompt as no instructions', async () => {
      prisma.ai_engine_applications.findUnique.mockResolvedValueOnce({
        ...voiceApp,
        system_prompt: '   ',
      });

      const result = await (service as any).resolveVoiceSetup();

      // Whitespace must degrade to the browser baseline rather than send the
      // model an empty instruction string.
      expect(result.instructions).toBeNull();
    });
  });

  describe('buildSessionPatch', () => {
    const build = (settings: Record<string, any>) =>
      (service as any).buildSessionPatch(settings);

    it('omits the audio key entirely when nothing is configured', () => {
      const patch = build({});

      expect(patch).toEqual({ tool_choice: 'auto' });
      expect(patch.audio).toBeUndefined();
    });

    it('nests turn detection under audio.input, not at the root', () => {
      // A turn_detection placed at the session root is ignored silently by the
      // provider, so the nesting is the whole point of this method.
      const patch = build({
        turn_detection_type: 'semantic_vad',
        turn_detection_silence_ms: 700,
      });

      expect(patch.audio.input.turn_detection).toEqual({
        type: 'semantic_vad',
        silence_duration_ms: 700,
      });
      expect((patch as any).turn_detection).toBeUndefined();
    });

    it('scopes threshold to server VAD', () => {
      const server = build({
        turn_detection_type: 'server_vad',
        turn_detection_threshold: 0.4,
      });
      expect(server.audio.input.turn_detection.threshold).toBe(0.4);

      // Semantic VAD decides on meaning, not loudness: an amplitude cutoff
      // there would be accepted and ignored.
      const semantic = build({
        turn_detection_type: 'semantic_vad',
        turn_detection_threshold: 0.4,
      });
      expect(semantic.audio.input.turn_detection.threshold).toBeUndefined();
    });

    it('distinguishes explicit off from absent', () => {
      // null tells the provider to disable the stage; omitting the key leaves
      // the provider default. They are different outcomes.
      const off = build({ turn_detection_type: 'off', noise_reduction: 'off' });
      expect(off.audio.input.turn_detection).toBeNull();
      expect(off.audio.input.noise_reduction).toBeNull();

      const absent = build({});
      expect(absent.audio).toBeUndefined();
    });

    it('rejects an unknown turn detection value instead of forwarding it', () => {
      const patch = build({ turn_detection_type: 'magic_vad' });

      expect(patch.audio).toBeUndefined();
    });

    it('maps noise reduction and transcription', () => {
      const patch = build({
        noise_reduction: 'near_field',
        transcription_model: '  gpt-4o-mini-transcribe  ',
      });

      expect(patch.audio.input.noise_reduction).toEqual({
        type: 'near_field',
      });
      expect(patch.audio.input.transcription).toEqual({
        model: 'gpt-4o-mini-transcribe',
      });
    });

    it('drops a blank transcription model', () => {
      const patch = build({ transcription_model: '   ' });

      expect(patch.audio).toBeUndefined();
    });

    it('drops an out-of-range threshold and a non-positive silence', () => {
      const patch = build({
        turn_detection_type: 'server_vad',
        turn_detection_threshold: 1.5,
        turn_detection_silence_ms: 0,
      });

      expect(patch.audio.input.turn_detection).toEqual({ type: 'server_vad' });
    });

    it('treats a cleared threshold as unset rather than as zero', () => {
      // Regression: `Number(null)` and `Number('')` are both 0, and 0 is a
      // legitimate threshold meaning "any sound is speech". A cleared field must
      // omit the key, not invert the setting.
      for (const cleared of [null, undefined, '']) {
        const patch = build({
          turn_detection_type: 'server_vad',
          turn_detection_threshold: cleared,
          turn_detection_silence_ms: cleared,
        });

        expect(patch.audio.input.turn_detection).toEqual({
          type: 'server_vad',
        });
      }
    });
  });

  describe('resolveTtlSeconds', () => {
    const ttl = (settings: Record<string, any>) =>
      (service as any).resolveTtlSeconds(settings);

    it('defaults to 60 when unset or unparseable', () => {
      expect(ttl({})).toBe(60);
      expect(ttl({ client_secret_ttl_seconds: 'abc' })).toBe(60);
      expect(ttl({ client_secret_ttl_seconds: null })).toBe(60);
    });

    it('passes through a value inside the allowed range', () => {
      expect(ttl({ client_secret_ttl_seconds: 90 })).toBe(90);
    });

    it('clamps a runaway value so the browser never holds a long-lived bearer token', () => {
      expect(ttl({ client_secret_ttl_seconds: 100000 })).toBe(300);
    });

    it('clamps a value below the handshake floor', () => {
      expect(ttl({ client_secret_ttl_seconds: 1 })).toBe(10);
      expect(ttl({ client_secret_ttl_seconds: -5 })).toBe(10);
    });

    it('truncates fractional seconds', () => {
      expect(ttl({ client_secret_ttl_seconds: 90.7 })).toBe(90);
    });
  });
});
