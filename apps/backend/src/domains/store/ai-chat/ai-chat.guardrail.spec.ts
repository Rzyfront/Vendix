import { AIChatService } from './ai-chat.service';
import { RequestContextService } from '../../../common/context/request-context.service';

/**
 * Guardarraíl previo al turno en el chat de la tienda (Vex texto, voz y
 * diseño de apps): fuera de tema/abuso responde la redirección y no corren
 * ni el modelo principal, ni las tools, ni la compactación ni el título; un
 * `pass` (o sin guardarraíl) deja el turno exactamente como hoy.
 */
const context = {
  store_id: 5,
  organization_id: 2,
  user_id: 9,
  is_super_admin: false,
  is_owner: true,
  roles: ['owner'],
};

const REDIRECT = {
  action: 'redirect' as const,
  verdict: 'off_topic' as const,
  reply: 'Eso no es lo mío; te ayudo con tu tienda. ¿Qué necesitas?',
  reply_source: 'model' as const,
  strikes: 1,
  rate_penalty: 1,
  tokens: 90,
  cost_usd: 0.00004,
};

function conversation() {
  return {
    id: 11,
    store_id: 5,
    user_id: 9,
    title: 'Hilo',
    status: 'active',
    app_key: null,
    metadata: { agent_key: 'vex' },
    messages: [
      { id: 1, role: 'user', content: '¿ventas de hoy?', tokens_used: 0 },
      { id: 2, role: 'assistant', content: 'Vendiste $100', tokens_used: 3000 },
      { id: 3, role: 'assistant', content: 'Algo más', tokens_used: 5000 },
    ],
  };
}

function build(decision: unknown) {
  const created: any[] = [];
  const check = jest.fn().mockResolvedValue(decision);
  const runAgent = jest.fn().mockResolvedValue({
    content: 'Respuesta del agente',
    total_tokens: 4000,
    cost_usd: 0.01,
    tools_used: [],
  });
  const runAgentStream = jest.fn(async function* () {
    yield { type: 'text', content: 'Respuesta del agente' };
    yield { type: 'done', usage: { totalTokens: 4000 } };
    return {
      success: true,
      content: 'Respuesta del agente',
      total_tokens: 4000,
      tools_used: [],
    };
  });
  const compactVexHistory = jest.fn(async (c: unknown) => ({
    conversation: c,
    frame: null,
  }));
  const titles = { start: jest.fn(), waitFor: jest.fn() };
  const pushed: string[] = [];
  const voiceTurn = {
    filler: jest.fn().mockResolvedValue(null),
    usedFiller: jest.fn(),
    push: jest.fn((t: string) => pushed.push(t)),
    flush: jest.fn(),
    settle: jest.fn().mockResolvedValue(undefined),
    drain: jest.fn(() => [{ type: 'audio', seq: 0 }]),
    timings: jest.fn(() => []),
    abort: jest.fn(),
  };
  const service = Object.assign(
    Object.create(AIChatService.prototype) as AIChatService,
    {
      logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() },
      guardrail: { check },
      titles,
      classifier: undefined,
      prisma: {
        ai_messages: {
          create: jest.fn(async (args: any) => {
            created.push(args.data);
            return { id: 100 + created.length };
          }),
        },
        ai_conversations: { update: jest.fn().mockResolvedValue({}) },
      },
      aiAgent: { runAgent, runAgentStream },
      aiEngine: { getApplication: jest.fn().mockResolvedValue(null) },
      eventEmitter: { emit: jest.fn() },
      streamIntents: { consume: jest.fn(), claimTurn: jest.fn() },
      uiChannel: {
        registerTurn: jest.fn(),
        releaseTurn: jest.fn(),
      },
      speech: {
        openTurn: jest.fn().mockResolvedValue(voiceTurn),
        lastFiller: jest.fn(),
        rememberFiller: jest.fn(),
      },
      getConversation: jest.fn().mockResolvedValue(conversation()),
      assertVexTurnAccess: jest.fn().mockResolvedValue(undefined),
      compactVexHistory,
      resolveChatAgent: jest.fn().mockResolvedValue({
        key: 'vex',
        app_key: 'vex_assistant',
      }),
      resolveTurnVoice: jest
        .fn()
        .mockResolvedValue({ speak: true, agentKey: 'vex' }),
      resolveVexTurnBlocks: jest.fn().mockResolvedValue([]),
      vexTurnMetadata: jest.fn().mockReturnValue(null),
      estimateTurnBudget: jest.fn().mockReturnValue(undefined),
      attachVexTurnBlocks: jest.fn(),
      turnQuota: jest.fn().mockResolvedValue(undefined),
      withBlockSelection: jest.fn(async (goal: string) => goal),
      planState: { getActive: jest.fn(), get: jest.fn() },
      resolveAgentLoopArgs: jest.fn().mockReturnValue({}),
      buildVexVariables: jest.fn().mockResolvedValue({ store_memory: '' }),
      durableTurnArgs: jest.fn().mockResolvedValue({}),
    },
  );
  return {
    service: service as any,
    check,
    runAgent,
    runAgentStream,
    compactVexHistory,
    titles,
    created,
    voiceTurn,
    pushed,
  };
}

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
  const frames: any[] = [];
  for await (const f of gen) frames.push(f);
  return frames;
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: 11,
    content: 'escríbeme un poema sobre el mar',
    speak: false,
    ...overrides,
  };
}

describe('Guardarraíl en el chat de la tienda — POST sendMessage', () => {
  it('fuera de tema: responde la redirección sin llamar al agente ni compactar', async () => {
    const t = build(REDIRECT);
    const result = await RequestContextService.run(context, () =>
      t.service.sendMessage(11, { content: 'escríbeme un poema sobre el mar' }),
    );
    expect(t.runAgent).not.toHaveBeenCalled();
    expect(t.compactVexHistory).not.toHaveBeenCalled();
    expect(result.assistant_message.content).toBe(REDIRECT.reply);
    const assistant = t.created.find((row) => row.role === 'assistant');
    expect(assistant).toMatchObject({
      content: REDIRECT.reply,
      tokens_used: 90,
      cost_usd: 0.00004,
      metadata: {
        guardrail: { action: 'redirect', verdict: 'off_topic', reply_source: 'model' },
      },
    });
    expect(t.check).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'vex',
        subject: 's5:u9',
        message: 'escríbeme un poema sobre el mar',
        surface: 'text',
        quotaAgent: 'vex',
        conversationId: 11,
        tokensSavedEstimate: 4000,
      }),
    );
    // La conversación previa viaja como contexto (para «sí», «el rojo»…).
    expect(t.check.mock.calls[0][0].history).toHaveLength(3);
  });

  it('pass: el turno corre igual que hoy', async () => {
    const t = build({ action: 'pass', verdict: 'in_scope' });
    const result = await RequestContextService.run(context, () =>
      t.service.sendMessage(11, { content: '¿cuánto vendí hoy?' }),
    );
    expect(t.compactVexHistory).toHaveBeenCalledTimes(1);
    expect(t.runAgent).toHaveBeenCalledTimes(1);
    expect(result.assistant_message.content).toBe('Respuesta del agente');
    const assistant = t.created.find((row) => row.role === 'assistant');
    expect(assistant.metadata).toBeUndefined();
  });

  it('sin guardarraíl inyectado: idéntico a hoy', async () => {
    const t = build(REDIRECT);
    t.service.guardrail = undefined;
    await RequestContextService.run(context, () =>
      t.service.sendMessage(11, { content: 'escríbeme un poema' }),
    );
    expect(t.runAgent).toHaveBeenCalledTimes(1);
  });
});

describe('Guardarraíl en el chat de la tienda — stream (texto, voz, diseño)', () => {
  it('fuera de tema en voz: texto + audio de la redirección, sin modelo principal ni título', async () => {
    const t = build({ ...REDIRECT, action: 'cooldown', verdict: 'cooldown', reply: 'Pausa.' });
    t.service.streamIntents.consume.mockResolvedValue(intent({ speak: true }));
    // Primer turno del hilo: sin el corte, aquí se generaría el título.
    t.service.getConversation.mockResolvedValue({ ...conversation(), messages: [] });
    const frames = await RequestContextService.run(context, () =>
      collect(t.service.executeMessageStream(11, 'stream-1')),
    );
    expect(t.runAgentStream).not.toHaveBeenCalled();
    expect(t.compactVexHistory).not.toHaveBeenCalled();
    expect(t.titles.start).not.toHaveBeenCalled();
    expect(t.check.mock.calls[0][0].surface).toBe('voice');
    expect(frames).toContainEqual({ type: 'text', content: 'Pausa.' });
    expect(t.pushed).toEqual(['Pausa.']);
    const done = frames[frames.length - 1];
    expect(done).toMatchObject({ type: 'done', message_id: expect.any(Number) });
    // El costo es interno: se persiste en la fila, nunca viaja al cliente.
    expect(done.cost_usd).toBeUndefined();
    const assistant = t.created.find((row) => row.role === 'assistant');
    expect(assistant).toMatchObject({
      content: 'Pausa.',
      cost_usd: 0.00004,
      metadata: { guardrail: { action: 'cooldown', verdict: 'cooldown' } },
    });
    expect(t.service.uiChannel.releaseTurn).toHaveBeenCalledWith('stream-1');
  });

  it('primer mensaje cortado: el siguiente turno real sí genera el título del hilo', async () => {
    const t = build({ action: 'pass', verdict: 'in_scope' });
    t.service.streamIntents.consume.mockResolvedValue(
      intent({ content: '¿cuánto vendí hoy?' }),
    );
    t.service.getConversation.mockResolvedValue({
      ...conversation(),
      title: null,
      messages: [
        { id: 1, role: 'user', content: 'escríbeme un poema', tokens_used: 0 },
        {
          id: 2,
          role: 'assistant',
          content: REDIRECT.reply,
          tokens_used: 90,
          metadata: { guardrail: { action: 'redirect', verdict: 'off_topic' } },
        },
      ],
    });
    await RequestContextService.run(context, () =>
      collect(t.service.executeMessageStream(11, 'stream-1')),
    );
    expect(t.titles.start).toHaveBeenCalledWith(11, '¿cuánto vendí hoy?', expect.any(Number));
  });

  it('hilo con un turno real previo: no se regenera el título', async () => {
    const t = build({ action: 'pass', verdict: 'in_scope' });
    t.service.streamIntents.consume.mockResolvedValue(
      intent({ content: '¿y ayer?' }),
    );
    await RequestContextService.run(context, () =>
      collect(t.service.executeMessageStream(11, 'stream-1')),
    );
    expect(t.titles.start).not.toHaveBeenCalled();
  });

  it('chat de diseño de apps: comparte la entrada y se clasifica como superficie design', async () => {
    const t = build({ action: 'pass', verdict: 'in_scope' });
    t.service.streamIntents.consume.mockResolvedValue(
      intent({ content: 'haz la portada roja', design_context: { app_kind: 'store_ecommerce' } }),
    );
    t.service.getConversation.mockResolvedValue({
      ...conversation(),
      metadata: { agent_key: 'vex', surface: 'apps_design', app_kind: 'store_ecommerce' },
    });
    await RequestContextService.run(context, () =>
      collect(t.service.executeMessageStream(11, 'stream-2', undefined, undefined, 'store_ecommerce')),
    );
    expect(t.check.mock.calls[0][0].surface).toBe('design');
    expect(t.runAgentStream).toHaveBeenCalledTimes(1);
  });

  it('continuaciones («Continuar», aprobar) no pasan por el guardarraíl', async () => {
    const t = build(REDIRECT);
    t.service.streamIntents.consume.mockResolvedValue(
      intent({ content: undefined, continuation: 'approved' }),
    );
    t.service.planState.getActive.mockResolvedValue(null);
    t.service.findContinuationSourceMessageId = jest.fn().mockReturnValue(null);
    await RequestContextService.run(context, () =>
      collect(t.service.executeMessageStream(11, 'stream-3')),
    );
    expect(t.check).not.toHaveBeenCalled();
  });
});
