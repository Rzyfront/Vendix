import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VEX_DESIGN_TOOL_NAMES } from '../../../ai-engine/tools/domains/vex-design.tools';
import { VEX_DESIGN_CONVERSATION_SURFACE } from '../apps/vex-design/vex-design.types';
import { AIChatService } from './ai-chat.service';

const VEX_ROW = {
  key: 'vex',
  app_key: 'vex_assistant',
  system_prompt: null,
  allowed_tools: [],
  denied_tools: ['ui_navigate'],
  max_iterations: 40,
  is_active: true,
};

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    store_id: 1,
    organization_id: 1,
    user_id: 9,
    title: 'Diseño de product_page',
    app_key: null,
    status: 'active',
    metadata: {
      agent_key: 'vex',
      surface: VEX_DESIGN_CONVERSATION_SURFACE,
      app_kind: 'product_page',
    },
    messages: [],
    ...overrides,
  };
}

function buildHarness(opts: {
  conversation?: Record<string, unknown>;
  agentRow?: Record<string, unknown> | null;
  vexEnabled?: boolean;
}) {
  const prisma: any = {
    ai_conversations: {
      findFirst: jest
        .fn()
        .mockResolvedValue(makeConversation(opts.conversation)),
      update: jest.fn().mockResolvedValue({}),
      create: jest
        .fn()
        .mockImplementation(async ({ data }: any) => ({ id: 42, ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    ai_messages: {
      create: jest.fn().mockResolvedValue({ id: 100 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const runStream = jest.fn(async function* (_params: any) {
    yield { type: 'text', content: 'Listo.' };
    yield { type: 'done' };
    return { tools_used: [], content: 'Listo.' };
  });
  const runSync = jest
    .fn()
    .mockResolvedValue({ content: 'Listo.', total_tokens: 10, tools_used: [] });

  const streamIntents: any = {
    create: jest.fn().mockResolvedValue('stream-design-1'),
    consume: jest.fn(),
    claimTurn: jest.fn().mockResolvedValue(undefined),
    isCurrentTurn: jest.fn().mockResolvedValue(true),
  };

  const planState: any = {
    getActive: jest.fn().mockResolvedValue(null),
    get: jest.fn().mockResolvedValue(null),
    markCurrentChangeStep: jest.fn().mockResolvedValue(null),
    rejectPendingObjective: jest.fn().mockResolvedValue(null),
    createHook: jest.fn().mockReturnValue({ hook: true }),
    setStepHashes: jest.fn().mockResolvedValue([]),
  };

  const canUseAIFeature = jest.fn().mockResolvedValue({
    allowed: true,
    mode: 'allow',
    severity: 'info',
    subscription_state: 'active',
    plan_id: 1,
    has_record: true,
  });
  const checkExtraQuota = jest.fn().mockResolvedValue({
    exceeded: false,
    degradation: 'allow',
    cap: 100,
    used: 1,
  });

  const service = new AIChatService(
    prisma,
    {
      ai_agents: {
        findUnique: jest.fn().mockResolvedValue(opts.agentRow ?? VEX_ROW),
      },
      store_settings: {
        findUnique: jest.fn().mockResolvedValue({
          settings: { vex: { enabled: opts.vexEnabled ?? true } },
        }),
      },
    } as any,
    {
      getApplication: jest
        .fn()
        .mockResolvedValue({ metadata: { agent_enabled: true } }),
    } as any,
    {} as any,
    { runAgentStream: runStream, runAgent: runSync } as any,
    {} as any,
    { emit: jest.fn() } as any,
    {
      buildSnapshot: jest.fn().mockResolvedValue({}),
      buildVexSnapshot: jest.fn().mockResolvedValue({}),
    } as any,
    streamIntents,
    { registerTurn: jest.fn(), releaseTurn: jest.fn() } as any,
    {} as any,
    planState,
    { canUseAIFeature, checkExtraQuota } as any,
    { isEnforce: jest.fn().mockReturnValue(true) } as any,
    {
      recentSelections: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockResolvedValue({ id: 'blk-1', kind: 'markdown', version: 1 }),
      listByConversation: jest.fn().mockResolvedValue([]),
      attachToMessage: jest.fn().mockResolvedValue(0),
    } as any,
    {
      classifySteps: jest.fn((steps: any[]) => ({
        covered: steps,
        reconfirm: [],
      })),
    } as any,
    { issue: jest.fn().mockResolvedValue('su-1') } as any,
  );

  jest
    .spyOn(service as any, 'durableTurnArgs')
    .mockImplementation(async (conv: any, _key, _goal, base: any) => ({
      ...base,
      conversation_id: conv.id,
      plan: planState.createHook(conv.id),
      messages: [],
    }));

  return {
    service,
    prisma,
    runStream,
    runSync,
    streamIntents,
    canUseAIFeature,
    checkExtraQuota,
  };
}

const OWNER_CTX = {
  user_id: 9,
  store_id: 1,
  organization_id: 1,
  roles: ['owner'],
  is_owner: true,
  is_super_admin: false,
} as any;

async function collectStream(
  service: AIChatService,
  options?: { expectedDesignAppKind?: string },
) {
  const frames: any[] = [];
  await RequestContextService.runIsolated(OWNER_CTX, async () => {
    for await (const { replay: _replay, ...frame } of service.sendMessageStream(
      7,
      'stream-design-1',
      undefined,
      {},
      options,
    )) {
      frames.push(frame);
    }
  });
  return frames;
}

describe('AIChatService — seguridad y alcance del chat de diseño con Vex', () => {
  afterEach(() => jest.restoreAllMocks());

  it('createDesignStreamIntent valida agente vex, aplica gates/cuotas y guarda design_context', async () => {
    const h = buildHarness({});

    const streamId = await RequestContextService.runIsolated(OWNER_CTX, () =>
      h.service.createDesignStreamIntent(7, 'Pon fondo oscuro', {
        app_kind: 'product_page',
        prompt_context: '[CONTEXTO]',
        allowed_tools: [...VEX_DESIGN_TOOL_NAMES, 'finish_turn'],
      }),
    );

    expect(streamId).toBe('stream-design-1');
    expect(h.canUseAIFeature).toHaveBeenCalledWith(1, 'vex_agent');
    expect(h.checkExtraQuota).toHaveBeenCalled();
    expect(h.streamIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 7,
        content: 'Pon fondo oscuro',
        user_id: 9,
        design_context: expect.objectContaining({
          app_kind: 'product_page',
          allowed_tools: [...VEX_DESIGN_TOOL_NAMES, 'finish_turn'],
        }),
      }),
    );
  });

  it('createDesignStreamIntent rechaza con BadRequestException conversaciones de otro agente (vexi)', async () => {
    const h = buildHarness({
      conversation: { metadata: { agent_key: 'vexi' } },
    });

    await RequestContextService.runIsolated(OWNER_CTX, async () => {
      await expect(
        h.service.createDesignStreamIntent(7, 'Intento con hilo vexi', {
          app_kind: 'product_page',
          prompt_context: '[CONTEXTO]',
          allowed_tools: [...VEX_DESIGN_TOOL_NAMES, 'finish_turn'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    expect(h.streamIntents.create).not.toHaveBeenCalled();
  });

  it('sendMessageStream acota tools y agent_allowed_tools al design_context cuando coincide expectedDesignAppKind', async () => {
    const h = buildHarness({});
    const allowed = [...VEX_DESIGN_TOOL_NAMES, 'finish_turn'];
    h.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'Cambia el tema',
      design_context: {
        app_kind: 'product_page',
        prompt_context: '[CONTEXTO PRODUCT]',
        allowed_tools: allowed,
      },
    });

    const frames = await collectStream(h.service, {
      expectedDesignAppKind: 'product_page',
    });

    expect(frames.some((f) => f.type === 'done')).toBe(true);
    const callArgs = h.runStream.mock.calls[0][0];
    expect(callArgs.tools).toEqual(allowed);
    expect(callArgs.agent_allowed_tools).toEqual(allowed);
    expect(callArgs.agent_denied_tools).toEqual(['ui_navigate']);
    expect(callArgs.goal).toContain('[CONTEXTO PRODUCT]');
  });

  it('sendMessageStream corta con frame error si falta design_context o difiere app_kind', async () => {
    // 1. Intent sin design_context (hilo normal) usado en stream de diseño.
    const hMissing = buildHarness({});
    hMissing.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'Mensaje normal',
    });

    const missingFrames = await collectStream(hMissing.service, {
      expectedDesignAppKind: 'product_page',
    });
    // El stream puede abrir con un frame de progreso; lo que importa es que
    // corte con error y no ejecute el turno.
    expect(missingFrames.some((f) => f.type === 'error')).toBe(true);
    expect(hMissing.runStream).not.toHaveBeenCalled();

    // 2. Intent de product_page consumido desde stream de booking (cross-app).
    const hMismatch = buildHarness({});
    hMismatch.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'Cambia portada',
      design_context: {
        app_kind: 'product_page',
        prompt_context: '[CONTEXTO]',
        allowed_tools: [...VEX_DESIGN_TOOL_NAMES, 'finish_turn'],
      },
    });

    const mismatchFrames = await collectStream(hMismatch.service, {
      expectedDesignAppKind: 'booking',
    });
    expect(mismatchFrames.some((f) => f.type === 'error')).toBe(true);
    expect(hMismatch.runStream).not.toHaveBeenCalled();

    // 3. Intent de diseño consumido en el chat general (sin expectedDesignAppKind).
    const hGeneral = buildHarness({});
    hGeneral.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'Cambia portada',
      design_context: {
        app_kind: 'product_page',
        prompt_context: '[CONTEXTO]',
        allowed_tools: [...VEX_DESIGN_TOOL_NAMES, 'finish_turn'],
      },
    });

    const generalFrames = await collectStream(hGeneral.service);
    expect(generalFrames.some((f) => f.type === 'error')).toBe(true);
    expect(hGeneral.runStream).not.toHaveBeenCalled();
  });

  it('excluye VEX_DESIGN_TOOL_NAMES en turnos normales de /admin/vex (sin design_context)', async () => {
    const h = buildHarness({
      conversation: { metadata: { agent_key: 'vex' } },
    });
    h.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'Dame el resumen de ventas',
    });

    await collectStream(h.service);

    const streamArgs = h.runStream.mock.calls[0][0];
    for (const toolName of VEX_DESIGN_TOOL_NAMES) {
      expect(streamArgs.agent_denied_tools).toContain(toolName);
    }

    // También en sendMessage (camino síncrono).
    await RequestContextService.runIsolated(OWNER_CTX, () =>
      h.service.sendMessage(7, { content: 'Resumen de inventario' }),
    );
    const syncArgs = h.runSync.mock.calls[0][0];
    for (const toolName of VEX_DESIGN_TOOL_NAMES) {
      expect(syncArgs.agent_denied_tools).toContain(toolName);
    }
  });

  it('etiqueta hilos de diseño al crear y los excluye del listado en listConversations', async () => {
    const h = buildHarness({});

    await RequestContextService.runIsolated(OWNER_CTX, async () => {
      await h.service.createConversation(
        { agent_key: 'vex', title: 'Diseño de product_page' },
        {
          surface: VEX_DESIGN_CONVERSATION_SURFACE,
          app_kind: 'product_page',
        },
      );

      expect(h.prisma.ai_conversations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: {
              agent_key: 'vex',
              surface: VEX_DESIGN_CONVERSATION_SURFACE,
              app_kind: 'product_page',
            },
          }),
        }),
      );

      await h.service.listConversations({ agent_key: 'vex' } as any);
      const where = h.prisma.ai_conversations.findMany.mock.calls[0][0].where;
      expect(where.metadata).toEqual({ path: ['agent_key'], equals: 'vex' });
      expect(where.AND).toEqual([
        {
          OR: [
            { metadata: { equals: Prisma.AnyNull } },
            { metadata: { path: ['surface'], equals: Prisma.AnyNull } },
            {
              NOT: {
                metadata: {
                  path: ['surface'],
                  equals: VEX_DESIGN_CONVERSATION_SURFACE,
                },
              },
            },
          ],
        },
      ]);
    });
  });
});
