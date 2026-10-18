import { VexiRealtimeService } from './vexi-realtime.service';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { ToolRouterService } from '../../../ai-engine/tools/tool-router.service';
import { RequestContextService } from '../../../common/context/request-context.service';

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

  describe('describeRealtimeCapability', () => {
    const describeFor = (config: Record<string, any> | null) =>
      (service as any).describeRealtimeCapability(config);

    it('permite una config OpenAI-compatible', () => {
      expect(
        describeFor({ ...audioConfig, sdk_type: 'openai_compatible' }),
      ).toBeNull();
    });

    it('permite una config ausente, porque cae al host de OpenAI', () => {
      // No es un fallo: `createSession` usa DEFAULT_BASE_URL. Lo que falta ahí
      // es la clave, y de eso se ocupa la comprobación siguiente — reportar
      // "incapaz" mandaría a revisar el sdk_type de una fila que no existe.
      expect(describeFor(null)).toBeNull();
    });

    it('rechaza MiniMax T2A nombrando la config y el sdk_type', () => {
      // El caso real de producción: `vexi_realtime_voice` apuntando a la config
      // 16. Antes de esto el POST salía hacia
      // https://api.minimax.io/v1/t2a_v2/realtime/client_secrets y el 4xx se
      // reportaba como "el proveedor rechazó la sesión".
      const message = describeFor({
        ...audioConfig,
        label: 'MiniMax — Dictado de voz (T2A)',
        provider: 'MiniMax',
        sdk_type: 'minimax_t2a',
        model_id: 'speech-2.8-hd',
        base_url: 'https://api.minimax.io/v1/t2a_v2',
      });

      expect(message).toContain('vexi_realtime_voice');
      expect(message).toContain('MiniMax — Dictado de voz (T2A)');
      expect(message).toContain('minimax_t2a');
      // Tiene que decir la salida, no sólo el problema.
      expect(message).toContain('pipeline');
    });

    it('rechaza anthropic_compatible, que tampoco expone Realtime API', () => {
      expect(
        describeFor({ ...audioConfig, sdk_type: 'anthropic_compatible' }),
      ).toContain('anthropic_compatible');
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

describe('VexiRealtimeService G session authority', () => {
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const confirmationToken = '22222222-2222-4222-8222-222222222222';
  const objectiveId = '33333333-3333-4333-8333-333333333333';
  const context = {
    user_id: 3,
    organization_id: 2,
    store_id: 1,
    roles: ['owner'],
    permissions: ['catalog:read', 'catalog:write'],
    is_owner: true,
    is_super_admin: false,
  };
  let savedFlag: string | undefined;
  let savedRouting: string | undefined;
  let service: VexiRealtimeService;
  let registry: AIToolRegistry;
  let consent: Record<string, jest.Mock>;
  let authorityService: Record<string, jest.Mock>;
  let handler: jest.Mock;
  let preview: jest.Mock;
  let read: jest.Mock;
  let router: ToolRouterService;
  let subscription: { consumeAIQuota: jest.Mock };
  let session: any;
  let authority: any;
  const run = <T>(fn: () => T) =>
    RequestContextService.runIsolated(context, fn);

  beforeEach(() => {
    handler = jest.fn().mockResolvedValue('{"applied":true}');
    preview = jest.fn().mockResolvedValue({
      status: 'ok',
      target: 'Producto QA',
      changes: [
        { field: 'name', label: 'Nombre', before: 'Antes', after: 'Después' },
      ],
    });
    read = jest.fn().mockResolvedValue('{"id":7,"name":"Producto QA"}');
    registry = new AIToolRegistry({
      issue: jest.fn().mockResolvedValue(confirmationToken),
      redeem: jest.fn().mockResolvedValue('ok'),
    } as any);
    registry.registerMany([
      {
        name: 'read_product',
        version: '1',
        domain: 'products',
        readOnly: true,
        description: 'Leer',
        parameters: {
          type: 'object',
          properties: { id: { type: 'integer' } },
          required: ['id'],
        },
        requiredPermissions: ['catalog:read'],
        handler: read,
      },
      {
        name: 'change_product',
        version: '1',
        domain: 'products',
        requiresConfirmation: true,
        description: 'Cambiar',
        parameters: {
          type: 'object',
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
          required: ['id', 'name'],
        },
        requiredPermissions: ['catalog:write'],
        preview,
        handler,
      },
      {
        name: 'write_without_preview',
        version: '1',
        domain: 'products',
        requiresConfirmation: true,
        description: 'No preview',
        parameters: { type: 'object', properties: {} },
        handler,
      },
      {
        name: 'unclassified',
        version: '1',
        domain: 'products',
        description: 'No read flag',
        parameters: { type: 'object', properties: {} },
        handler,
      },
      {
        name: 'ui_navigate',
        version: '1',
        domain: 'ui',
        clientSide: true,
        description: 'Navegar',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'propose_plan',
        version: '1',
        domain: 'planning',
        readOnly: true,
        description: 'Plan',
        parameters: { type: 'object', properties: {} },
        handler,
      },
      {
        name: 'search_tools',
        version: '1',
        domain: 'discovery',
        readOnly: true,
        description: 'Buscar',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        handler,
      },
      {
        name: 'search_playbooks',
        version: '1',
        domain: 'playbooks',
        readOnly: true,
        description: 'Buscar procesos',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        handler,
      },
      {
        name: 'load_playbook',
        version: '1',
        domain: 'playbooks',
        readOnly: true,
        description: 'Leer proceso',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' }, version: { type: 'string' } },
          required: ['id', 'version'],
        },
        handler,
      },
    ]);
    authority = {
      conversation_id: 9,
      agent_key: 'vexi',
      objective_id: objectiveId,
      step_id: 'plan:abc:1',
      goal: 'Revisar producto QA',
      plan: null,
      authorizedDefinitions: registry.getAvailableDefinitions(
        context.permissions,
      ),
    };
    router = new ToolRouterService(registry, {
      rank: jest.fn(async (_query, docs) => ({
        names: docs.map((d) => d.name),
        degraded: [],
      })),
    } as any);
    session = {
      sessionId,
      conversationId: 9,
      agentKey: 'vexi',
      objectiveId,
      stepId: authority.step_id,
      userId: 3,
      organizationId: 2,
      storeId: 1,
      expiresAt: Date.now() + 300000,
      revision: 0,
      playbookTokens: 0,
      channel: 'realtime',
      tools: registry
        .getAll()
        .map((tool) => ({ name: tool.name, version: tool.version })),
      routing: router.createSession(authority.goal, 'initial'),
    };
    consent = {
      createSession: jest.fn().mockResolvedValue({
        session_id: sessionId,
        expires_at: new Date(session.expiresAt).toISOString(),
      }),
      validateSession: jest.fn().mockImplementation(async (id: string) => {
        const current = RequestContextService.asyncLocalStorage.getStore();
        if (
          id !== sessionId ||
          current?.user_id !== session.userId ||
          current?.organization_id !== session.organizationId ||
          current?.store_id !== session.storeId ||
          session.expiresAt <= Date.now()
        )
          throw new Error('session_unavailable');
        return JSON.parse(JSON.stringify(session));
      }),
      updateSessionCatalog: jest
        .fn()
        .mockImplementation(
          async (_id, tools, routing, revision, playbookTokens) => {
            if (revision !== session.revision)
              throw new Error('session_changed');
            session = {
              ...session,
              tools,
              routing: routing ?? session.routing,
              revision: revision + 1,
              playbookTokens: playbookTokens ?? session.playbookTokens,
            };
            return session;
          },
        ),
      registerProposal: jest.fn().mockResolvedValue({
        session_id: sessionId,
        proposal_id: 'public-proposal',
        preview_hash: 'hash',
        expires_at: new Date(Date.now() + 60000).toISOString(),
      }),
      closeSession: jest.fn().mockResolvedValue(undefined),
      closeSessionForBilling: jest
        .fn()
        .mockImplementation(async (id: string) => {
          const current = RequestContextService.asyncLocalStorage.getStore();
          if (
            id !== sessionId ||
            current?.user_id !== session.userId ||
            current?.store_id !== session.storeId ||
            current?.organization_id !== session.organizationId ||
            session.channel !== 'realtime'
          )
            throw new Error('session_unavailable');
          return JSON.parse(JSON.stringify(session));
        }),
    };
    authorityService = {
      resolveAuthority: jest.fn().mockImplementation(async () => authority),
      prepareAuthority: jest.fn().mockImplementation(async () => authority),
      runAuthorized: jest
        .fn()
        .mockImplementation(async (fresh, callback) => callback(fresh)),
      executePlanningTool: jest.fn().mockResolvedValue('{"ok":true}'),
      recordResult: jest.fn().mockResolvedValue(undefined),
    };
    subscription = { consumeAIQuota: jest.fn().mockResolvedValue(undefined) };
    service = new VexiRealtimeService(
      {} as any,
      {} as any,
      registry,
      subscription as any,
      consent as any,
      authorityService as any,
      router,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects arbitrary legacy calls ON before any registry dispatch', async () => {
    await expect(
      run(() => service.executeToolCall('read_product', { id: 7 })),
    ).rejects.toThrow('session not found');
    expect(read).not.toHaveBeenCalled();
  });

  it('requires the owned conversation before any provider request', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('provider must not be called'));
    await expect(run(() => service.createSession({}))).rejects.toThrow(
      'Selecciona una conversación',
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(consent.createSession).not.toHaveBeenCalled();
  });

  it('creates a versioned server catalog and keeps provider expiry separate from session expiry', async () => {
    jest.spyOn(service as any, 'resolveVoiceSetup').mockResolvedValue({
      config: {
        sdk_type: 'openai_compatible',
        api_key_ref: 'sk-test',
        settings: {},
        model_id: 'current-model',
      },
      instructions: 'Persona actual',
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ value: 'ephemeral-test', expires_at: 123456 }),
    } as Response);
    const result = await run(() =>
      service.createSession({ conversation_id: 9, agent_key: 'vexi' }),
    );
    expect(result).toMatchObject({
      session_id: sessionId,
      expires_at: 123456,
      session_expires_at: new Date(session.expiresAt).toISOString(),
      conversation_id: 9,
      agent_key: 'vexi',
      objective_id: objectiveId,
      model: 'current-model',
    });
    expect(result.tools.map((tool) => tool.name)).toContain('change_product');
    expect(result.tools.map((tool) => tool.name)).not.toContain(
      'write_without_preview',
    );
    expect(result.tools.map((tool) => tool.name)).not.toContain('unclassified');
    expect(consent.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 9,
        agentKey: 'vexi',
        objectiveId,
        channel: 'realtime',
        tools: expect.arrayContaining([
          { name: 'change_product', version: '1' },
        ]),
      }),
    );
    expect(authorityService.prepareAuthority).toHaveBeenCalledWith(
      9,
      'vexi',
      undefined,
    );
    expect(result.instructions).toContain('Persona actual');
    expect(result.instructions).toContain('SOLO preparan una propuesta');
    expect(result.instructions).not.toContain(confirmationToken);
  });

  it('keeps Vex UI out of a new grant independently of a misconfigured agent row', async () => {
    authority.agent_key = 'vex';
    jest.spyOn(service as any, 'resolveVoiceSetup').mockResolvedValue({
      config: {
        sdk_type: 'openai_compatible',
        api_key_ref: 'sk-test',
        settings: {},
      },
      instructions: null,
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ value: 'ephemeral-test' }),
    } as Response);
    const result = await run(() =>
      service.createSession({ conversation_id: 9, agent_key: 'vex' }),
    );
    expect(result.tools.map((tool) => tool.name)).not.toContain('ui_navigate');
  });

  it.each(['read_product', 'change_product', 'ui_navigate'])(
    'rejects unoffered %s before preview/UI/read',
    async (name) => {
      session.tools = [];
      await expect(
        run(() =>
          service.executeSessionToolCall(sessionId, name, {
            id: 7,
            name: 'Otro',
          }),
        ),
      ).rejects.toThrow('not offered');
      expect(preview).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it.each([{ user_id: 999 }, { organization_id: 999 }, { store_id: 999 }])(
    'rejects another principal binding %j',
    async (foreign) => {
      await expect(
        RequestContextService.runIsolated({ ...context, ...foreign }, () =>
          service.executeSessionToolCall(sessionId, 'read_product', { id: 7 }),
        ),
      ).rejects.toThrow('session_unavailable');
      expect(authorityService.resolveAuthority).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    },
  );

  it('rejects an expired or pipeline session', async () => {
    session.expiresAt = Date.now() - 1;
    await expect(
      run(() =>
        service.executeSessionToolCall(sessionId, 'read_product', { id: 7 }),
      ),
    ).rejects.toThrow('session_unavailable');
    session.expiresAt = Date.now() + 60000;
    session.channel = 'pipeline';
    await expect(
      run(() =>
        service.executeSessionToolCall(sessionId, 'read_product', { id: 7 }),
      ),
    ).rejects.toThrow('session not found');
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects a changed release version before dispatch', async () => {
    session.tools.find((tool: any) => tool.name === 'read_product').version =
      'old';
    await expect(
      run(() =>
        service.executeSessionToolCall(sessionId, 'read_product', { id: 7 }),
      ),
    ).rejects.toThrow('Cambió la herramienta');
    expect(read).not.toHaveBeenCalled();
  });

  it('rebuilds current authority for each read and cannot retain revoked access', async () => {
    await run(() =>
      service.executeSessionToolCall(sessionId, 'read_product', { id: 7 }),
    );
    authority.authorizedDefinitions = [];
    await expect(
      run(() =>
        service.executeSessionToolCall(sessionId, 'read_product', { id: 7 }),
      ),
    ).rejects.toThrow('current voice scope');
    expect(authorityService.resolveAuthority).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('runs the real registry under narrowed explicit ALS rather than the request role fallback', async () => {
    authorityService.runAuthorized.mockImplementation(async (fresh, callback) =>
      RequestContextService.runIsolated(
        { ...context, permissions: [], roles: [] },
        () => callback(fresh),
      ),
    );
    await expect(
      run(() =>
        service.executeSessionToolCall(sessionId, 'read_product', { id: 7 }),
      ),
    ).rejects.toThrow('Insufficient permissions');
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['objective_id', 'step_id'])(
    'rejects changed durable %s',
    async (key) => {
      authority[key] = 'another';
      await expect(
        run(() =>
          service.executeSessionToolCall(sessionId, 'read_product', { id: 7 }),
        ),
      ).rejects.toThrow('Cambió el objetivo');
      expect(read).not.toHaveBeenCalled();
    },
  );

  it('creates an exact proposal through the real registry without mutating or exposing its token to the model', async () => {
    const execute = jest.spyOn(registry, 'executeTool');
    const args = {
      id: 7,
      name: 'Después',
      confirmation_token: confirmationToken,
    };
    const result = await run(() =>
      service.executeSessionToolCall(sessionId, 'change_product', args),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(preview).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('change_product', args, {
      proposalOnly: true,
      conversationId: 9,
    });
    expect(result.proposal).toMatchObject({
      proposal_id: 'public-proposal',
      arguments: args,
    });
    expect(result.proposal?.confirmation_token).toBeUndefined();
    expect(result.output).not.toContain(confirmationToken);
    expect(result.output).not.toContain('confirmation_token');
    expect(JSON.parse(result.output)).toMatchObject({
      status: 'pending_confirmation',
      applied: false,
    });
    expect(consent.registerProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'change_product',
        toolVersion: '1',
        arguments: args,
        confirmationToken,
      }),
    );
  });

  it('new arguments or repeated voice calls never redeem a browser-supplied token', async () => {
    await run(() =>
      service.executeSessionToolCall(sessionId, 'change_product', {
        id: 7,
        name: 'A',
        confirmation_token: confirmationToken,
      }),
    );
    await run(() =>
      service.executeSessionToolCall(sessionId, 'change_product', {
        id: 7,
        name: 'B',
        confirmation_token: confirmationToken,
      }),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(consent.registerProposal).toHaveBeenCalledTimes(2);
  });

  it('persists the same single-step Vex approval identity before registering voice consent', async () => {
    session.agentKey = 'vex';
    authority.agent_key = 'vex';
    const plans = {
      persistVoiceWriteProposal: jest
        .fn()
        .mockResolvedValue({ planId: 'approval-plan', stepId: 's1' }),
    };
    service = new VexiRealtimeService(
      {} as any,
      {} as any,
      registry,
      subscription as any,
      consent as any,
      authorityService as any,
      router,
      undefined,
      undefined,
      plans as any,
    );
    const result = await run(() =>
      service.executeSessionToolCall(sessionId, 'change_product', {
        id: 7,
        name: 'Después',
      }),
    );
    expect(plans.persistVoiceWriteProposal).toHaveBeenCalledWith(
      9,
      'change_product',
      { id: 7, name: 'Después' },
      await preview.mock.results[0].value,
    );
    expect(consent.registerProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'approval-plan',
        actionLabel: 'cambiar Producto QA Nombre',
      }),
    );
    expect(result.proposal).toMatchObject({
      plan_id: 'approval-plan',
      step_id: 's1',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(['write_without_preview', 'unclassified'])(
    'does not offer/execute unsafe %s classifications',
    async (name) => {
      await expect(
        run(() => service.executeSessionToolCall(sessionId, name, {})),
      ).rejects.toThrow('current voice scope');
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('refuses Vex UI even if a forged stored catalog includes it', async () => {
    session.agentKey = 'vex';
    authority.agent_key = 'vex';
    await expect(
      run(() => service.executeSessionToolCall(sessionId, 'ui_navigate', {})),
    ).rejects.toThrow('current voice scope');
    expect(handler).not.toHaveBeenCalled();
  });

  it('authorizes Vexi UI without falsely reporting that it ran', async () => {
    const execute = jest.spyOn(registry, 'executeTool');
    const result = await run(() =>
      service.executeSessionToolCall(sessionId, 'ui_navigate', {}),
    );
    expect(result.ui_authorized).toBe(true);
    expect(JSON.parse(result.output)).toMatchObject({
      status: 'ui_authorized',
      applied: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps invalid arguments away from registry preview and mutation', async () => {
    const result = await run(() =>
      service.executeSessionToolCall(sessionId, 'change_product', { id: 7 }),
    );
    expect(JSON.parse(result.output).error_code).toBe('INVALID_ARGS');
    expect(preview).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps an impossible preview out of consent registration', async () => {
    preview.mockResolvedValue({
      status: 'error',
      target: 'Producto QA',
      message: 'No existe',
    });
    const result = await run(() =>
      service.executeSessionToolCall(sessionId, 'change_product', {
        id: 7,
        name: 'X',
      }),
    );
    expect(result.proposal).toBeUndefined();
    expect(JSON.parse(result.output)).toMatchObject({
      status: 'blocked',
      applied: false,
    });
    expect(consent.registerProposal).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('sanitizes secret-bearing structured read output before the provider and D1 checkpoint', async () => {
    read.mockResolvedValue(
      JSON.stringify({
        id: 7,
        confirmation_token: confirmationToken,
        nested: {
          client_secret: 'secret',
          expected_phrase: 'nonce spoken',
          value: 2,
        },
      }),
    );
    const result = await run(() =>
      service.executeSessionToolCall(sessionId, 'read_product', { id: 7 }),
    );
    expect(JSON.parse(result.output)).toEqual({ id: 7, nested: { value: 2 } });
    expect(authorityService.recordResult).toHaveBeenCalledWith(
      authority,
      'read_product',
      { id: 7 },
      result.output,
      undefined,
    );
  });

  it('fails closed rather than returning the original unsanitized deeply nested output', async () => {
    let nested: any = { confirmation_token: confirmationToken };
    for (let i = 0; i < 80; i++) nested = { child: nested };
    read.mockResolvedValue(JSON.stringify(nested));
    const result = await run(() =>
      service.executeSessionToolCall(sessionId, 'read_product', { id: 7 }),
    );
    expect(JSON.parse(result.output).error_code).toBe(
      'VOICE_OUTPUT_UNAVAILABLE',
    );
    expect(result.output).not.toContain(confirmationToken);
  });

  it('pins conversation args before registry dispatch', async () => {
    await expect(
      run(() =>
        service.executeSessionToolCall(sessionId, 'read_product', {
          id: 7,
          conversation_id: 99,
        }),
      ),
    ).rejects.toThrow('conversation not found');
    expect(read).not.toHaveBeenCalled();
  });

  it('uses the same planning hook and never a stateless registry planning stub', async () => {
    const result = await run(() =>
      service.executeSessionToolCall(sessionId, 'propose_plan', {}),
    );
    expect(result.output).toBe('{"ok":true}');
    expect(authorityService.executePlanningTool).toHaveBeenCalledWith(
      authority,
      'propose_plan',
      {},
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('uses the existing router and CAS-swaps only currently authorized definitions', async () => {
    jest.spyOn(router, 'search').mockResolvedValue('{"expanded":true}');
    jest.spyOn(router, 'select').mockResolvedValue({
      definitions: authority.authorizedDefinitions.filter(
        (d: any) => d.function.name === 'read_product',
      ),
      operationalCount: 1,
      degraded: [],
      catalogHash: 'hash',
    });
    const result = await run(() =>
      service.executeSessionToolCall(sessionId, 'search_tools', {
        query: 'read_product',
      }),
    );
    expect(result.tools?.map((tool) => tool.name)).toEqual(['read_product']);
    expect(consent.updateSessionCatalog).toHaveBeenCalledWith(
      sessionId,
      [{ name: 'read_product', version: '1' }],
      expect.any(Object),
      0,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('loads C through its scoped session with shared D1 pins and persists a bounded Redis budget', async () => {
    const handle = { session_kind: 'playbook-turn' };
    const pins = [
      { id: 'inventory-replenishment', version: '1', hash: 'hash' },
    ];
    const value = {
      id: 'inventory-replenishment',
      version: '1',
      hash: 'hash',
      section: { id: 'prepare', body: 'Guía curada', steps: [] },
    };
    const playbooks = {
      createSession: jest.fn().mockReturnValue(handle),
      refreshAuthorization: jest.fn(),
      load: jest.fn().mockReturnValue(value),
      getActiveToolDependencies: jest.fn().mockReturnValue(['read_product']),
      searchHybrid: jest.fn(),
    };
    const objectives = { listPlaybookPins: jest.fn().mockResolvedValue(pins) };
    service = new VexiRealtimeService(
      {} as any,
      {} as any,
      registry,
      subscription as any,
      consent as any,
      authorityService as any,
      router,
      playbooks as any,
      objectives as any,
    );
    const result = await run(() =>
      service.executeSessionToolCall(sessionId, 'load_playbook', {
        id: 'inventory-replenishment',
        version: '1',
      }),
    );
    expect(JSON.parse(result.output)).toEqual(value);
    expect(playbooks.createSession).toHaveBeenCalledWith({
      scope: { store_id: 1, organization_id: 2, user_id: 3 },
      authorizedDefinitions: expect.any(Array),
      activePins: pins,
    });
    expect(objectives.listPlaybookPins).toHaveBeenCalledWith(objectiveId);
    expect(consent.updateSessionCatalog).toHaveBeenCalledWith(
      sessionId,
      expect.any(Array),
      expect.objectContaining({ dependencies: ['read_product'] }),
      0,
      Buffer.byteLength(JSON.stringify(value)),
    );
    expect(authorityService.recordResult).toHaveBeenCalledWith(
      authority,
      'load_playbook',
      { id: 'inventory-replenishment', version: '1' },
      result.output,
      undefined,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not reset the persisted playbook budget on a worker-local handle miss', async () => {
    session.playbookTokens = 1999;
    const playbooks = {
      createSession: jest
        .fn()
        .mockReturnValue({ session_kind: 'playbook-turn' }),
      refreshAuthorization: jest.fn(),
      load: jest.fn().mockReturnValue({ section: { body: 'No budget reset' } }),
      getActiveToolDependencies: jest.fn(),
    };
    service = new VexiRealtimeService(
      {} as any,
      {} as any,
      registry,
      subscription as any,
      consent as any,
      authorityService as any,
      router,
      playbooks as any,
      { listPlaybookPins: jest.fn().mockResolvedValue([]) } as any,
    );
    const result = await run(() =>
      service.executeSessionToolCall(sessionId, 'load_playbook', {
        id: 'inventory-replenishment',
        version: '1',
      }),
    );
    expect(JSON.parse(result.output).error_code).toBe(
      'PLAYBOOK_BUDGET_EXHAUSTED',
    );
    expect(result.output).not.toContain('No budget reset');
    expect(consent.updateSessionCatalog).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not expose a playbook response after a stale catalog CAS', async () => {
    const playbooks = {
      createSession: jest
        .fn()
        .mockReturnValue({ session_kind: 'playbook-turn' }),
      refreshAuthorization: jest.fn(),
      load: jest.fn().mockReturnValue({ id: 'doc' }),
      getActiveToolDependencies: jest.fn().mockReturnValue([]),
    };
    service = new VexiRealtimeService(
      {} as any,
      {} as any,
      registry,
      subscription as any,
      consent as any,
      authorityService as any,
      router,
      playbooks as any,
      { listPlaybookPins: jest.fn().mockResolvedValue([]) } as any,
    );
    consent.updateSessionCatalog.mockRejectedValue(
      new Error('session_changed'),
    );
    await expect(
      run(() =>
        service.executeSessionToolCall(sessionId, 'load_playbook', {
          id: 'inventory-replenishment',
          version: '1',
        }),
      ),
    ).rejects.toThrow('session_changed');
    expect(authorityService.recordResult).not.toHaveBeenCalled();
  });

  it('uses a stable server session id when closing the billing loop', async () => {
    await run(() => service.closeSession(sessionId, 13));
    expect(subscription.consumeAIQuota).toHaveBeenCalledWith(
      1,
      'realtime_voice',
      13,
      `vexi-voice-${sessionId}`,
    );
    expect(consent.closeSessionForBilling).toHaveBeenCalledWith(sessionId);
    expect(consent.closeSession).not.toHaveBeenCalled();
  });

  it('allows a scoped late billing close without reviving expired tool authority', async () => {
    session.expiresAt = Date.now() - 1;
    await expect(
      run(() =>
        service.executeSessionToolCall(sessionId, 'read_product', { id: 7 }),
      ),
    ).rejects.toThrow('session_unavailable');
    await run(() => service.closeSession(sessionId, 300));
    expect(subscription.consumeAIQuota).toHaveBeenCalledWith(
      1,
      'realtime_voice',
      300,
      `vexi-voice-${sessionId}`,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it('does not charge twice after the core atomic close has been consumed', async () => {
    consent.closeSessionForBilling
      .mockResolvedValueOnce(session)
      .mockRejectedValueOnce(new Error('session_unavailable'));
    await run(() => service.closeSession(sessionId, 10));
    await expect(
      run(() => service.closeSession(sessionId, 10)),
    ).rejects.toThrow('session_unavailable');
    expect(subscription.consumeAIQuota).toHaveBeenCalledTimes(1);
  });

  it('does not charge a foreign or pipeline session through the realtime close', async () => {
    await expect(
      RequestContextService.runIsolated({ ...context, store_id: 999 }, () =>
        service.closeSession(sessionId, 10),
      ),
    ).rejects.toThrow('session_unavailable');
    session.channel = 'pipeline';
    await expect(
      run(() => service.closeSession(sessionId, 10)),
    ).rejects.toThrow('session_unavailable');
    expect(subscription.consumeAIQuota).not.toHaveBeenCalled();
  });
});
