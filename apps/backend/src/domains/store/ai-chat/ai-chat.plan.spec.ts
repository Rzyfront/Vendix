import { AIChatService } from './ai-chat.service';
import { VexiStreamIntentService } from '../vexi/vexi-stream-intent.service';
import { VexiController } from '../vexi/vexi.controller';
import { renderPlanForModel } from '../vexi/vexi-plan-state.service';
import { RequestContextService } from '@common/context/request-context.service';
import type { AgentPlan } from '../../../ai-engine/interfaces/agent-plan.interface';

const PLAN: AgentPlan = {
  id: 'p1',
  status: 'active',
  goal: 'Subir precios',
  deliverables: [{ id: 'd1', description: 'Precios nuevos', verified: false }],
  steps: [
    {
      order: 1,
      title: 'Cambiar precio',
      kind: 'cambio',
      done_when: 'precio actualizado',
      status: 'in_progress',
      attempts: 0,
    },
  ],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const conversation = (messages: any[] = []) => ({
  id: 7,
  store_id: 1,
  organization_id: 1,
  user_id: 9,
  title: 'x',
  app_key: null,
  status: 'active',
  metadata: null,
  messages,
});

function agentGen(chunks: any[], result: any) {
  return jest.fn(async function* () {
    for (const c of chunks) yield c;
    return result;
  });
}

const EMPTY_RESULT = { tools_used: [], content: '' };

function build(opts: {
  plan?: AgentPlan | null;
  paused?: AgentPlan | null;
  run?: jest.Mock;
  messages?: any[];
  conversation?: Record<string, unknown>;
  agentRow?: Record<string, unknown> | null;
}) {
  const prisma: any = {
    ai_conversations: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ ...conversation(opts.messages), ...opts.conversation }),
      update: jest.fn().mockResolvedValue({}),
    },
    ai_messages: { create: jest.fn().mockResolvedValue({ id: 1 }) },
  };
  const run = opts.run ?? agentGen([{ type: 'done' }], EMPTY_RESULT);
  const runSync = jest.fn().mockResolvedValue({ content: 'ok', total_tokens: 1 });
  const aiAgent = { runAgentStream: run, runAgent: runSync };
  const findAgent = jest.fn().mockResolvedValue(opts.agentRow ?? null);
  const planState: any = {
    getActive: jest.fn().mockResolvedValue(opts.plan ?? null),
    get: jest.fn().mockResolvedValue(opts.paused ?? opts.plan ?? null),
    markCurrentChangeStep: jest.fn().mockResolvedValue(null),
    createHook: jest.fn().mockReturnValue({ hook: true }),
  };
  const streamIntents: any = {
    consume: jest.fn(),
    claimTurn: jest.fn().mockResolvedValue(undefined),
    isCurrentTurn: jest.fn().mockResolvedValue(true),
  };
  const service = new AIChatService(
    prisma,
    { ai_agents: { findUnique: findAgent } } as any,
    {
      getApplication: jest
        .fn()
        .mockResolvedValue({ metadata: { agent_enabled: true } }),
    } as any,
    {} as any,
    aiAgent as any,
    {} as any,
    { emit: jest.fn() } as any,
    { buildSnapshot: jest.fn().mockResolvedValue({}) } as any,
    streamIntents,
    { registerTurn: jest.fn(), releaseTurn: jest.fn() } as any,
    {} as any,
    planState,
  );
  return { service, prisma, run, runSync, findAgent, planState, streamIntents };
}

async function collect(service: AIChatService, intent: any) {
  const frames: any[] = [];
  for await (const f of service.sendMessageStream(7, 's1')) frames.push(f);
  return frames;
}

describe('AIChatService — plan interno de Vexi', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  const withIntent = (b: ReturnType<typeof build>, intent: any) =>
    b.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      content: '',
      user_id: 9,
      ...intent,
    });

  it('continuation sin plan activo: done sin texto, sin agente y sin persistir', async () => {
    const b = build({ plan: null });
    withIntent(b, { continuation: 'approved' });
    const frames = await collect(b.service, null);
    expect(frames).toEqual([{ type: 'done' }]);
    expect(b.run).not.toHaveBeenCalled();
    expect(b.prisma.ai_messages.create).not.toHaveBeenCalled();
  });

  it('rejected marca el paso, compone el goal y no persiste fila de usuario', async () => {
    const b = build({ plan: PLAN });
    withIntent(b, { continuation: 'rejected' });
    await collect(b.service, null);
    expect(b.planState.markCurrentChangeStep).toHaveBeenCalledWith(
      7,
      'rejected',
    );
    const params = b.run.mock.calls[0][0];
    expect(params.goal).toBe(
      '(interno) La persona rechazó el cambio propuesto; no se aplicó. Decide si lo demás sigue teniendo sentido: si sí, continúa; si no, pregúntale con naturalidad.',
    );
    expect(
      b.prisma.ai_messages.create.mock.calls.map((c: any) => c[0].data.role),
    ).not.toContain('user');
  });

  it('approved no marca el paso, no persiste usuario, y el plan va como system al agente', async () => {
    const b = build({ plan: PLAN });
    withIntent(b, { continuation: 'approved' });
    await collect(b.service, null);
    expect(b.planState.markCurrentChangeStep).not.toHaveBeenCalled();
    expect(
      b.prisma.ai_messages.create.mock.calls.map((c: any) => c[0].data.role),
    ).not.toContain('user');
    const params = b.run.mock.calls[0][0];
    expect(params.goal).toBe(
      '(interno) La persona aprobó el cambio propuesto y ya quedó aplicado. Continúa con lo que sigue sin avisarle que retomas.',
    );
    expect(params.messages).toEqual([
      { role: 'system', content: renderPlanForModel(PLAN) },
    ]);
    expect(params.plan).toEqual({ hook: true });
    expect(b.planState.createHook).toHaveBeenCalledWith(7);
    expect(b.streamIntents.claimTurn).toHaveBeenCalledWith(7, 's1');
  });

  it('resume usa su goal', async () => {
    const b = build({ plan: PLAN });
    withIntent(b, { continuation: 'resume' });
    await collect(b.service, null);
    expect(b.run.mock.calls[0][0].goal).toBe('(interno) Continúa donde ibas.');
  });

  it('mensaje normal con plan activo: plan + regla de clasificación y fila de usuario', async () => {
    const b = build({ plan: PLAN });
    withIntent(b, { content: 'hola' });
    await collect(b.service, null);
    const msgs = b.run.mock.calls[0][0].messages;
    expect(msgs[0]).toEqual({
      role: 'system',
      content: renderPlanForModel(PLAN),
    });
    expect(msgs[1].role).toBe('system');
    expect(msgs[1].content).toContain('pause_plan');
    expect(b.prisma.ai_messages.create).toHaveBeenCalledWith({
      data: { conversation_id: 7, role: 'user', content: 'hola' },
    });
  });

  it('plan pausado: system de trabajo en pausa', async () => {
    const paused = { ...PLAN, status: 'paused' as const };
    const b = build({ plan: null, paused });
    b.planState.get.mockResolvedValue(paused);
    withIntent(b, { content: 'hola' });
    await collect(b.service, null);
    expect(b.run.mock.calls[0][0].messages).toEqual([
      {
        role: 'system',
        content:
          '(interno) Tienes un trabajo en pausa: Subir precios. Si ya atendiste lo nuevo, pregúntale con naturalidad si retomas.',
      },
    ]);
  });

  it.each([true, false])(
    'frame de propuesta lleva plan_active=%s',
    async (active) => {
      const run = agentGen(
        [{ type: 'text', content: 'ok' }, { type: 'done' }],
        {
          tools_used: [],
          content: 'ok',
          pending_confirmation: {
            tool: 'write_endpoint',
            confirmation_token: 'tok',
            arguments: { method: 'PATCH', path: '/x' },
            preview: {},
          },
        },
      );
      const b = build({ plan: active ? PLAN : null, run });
      withIntent(b, { content: 'hola' });
      const frames = await collect(b.service, null);
      const frame = frames.find((f) => f.type === 'tool_result');
      expect(JSON.parse(frame.tool.summary).plan_active).toBe(active);
    },
  );

  it('plan_continue: se reenvía antes de done, sin fallback ni asistente persistido', async () => {
    const run = agentGen([{ type: 'plan_continue' }, { type: 'done' }], {
      tools_used: [],
      content: '',
      plan_continue: true,
    });
    const b = build({ plan: PLAN, run });
    withIntent(b, { content: 'hola' });
    const frames = await collect(b.service, null);
    expect(frames).toEqual([{ type: 'plan_continue' }, { type: 'done' }]);
    const roles = b.prisma.ai_messages.create.mock.calls.map(
      (c: any) => c[0].data.role,
    );
    expect(roles).toEqual(['user']);
  });

  it('aborted: sin fallback ni asistente persistido', async () => {
    const run = agentGen([], { tools_used: [], content: '', aborted: true });
    const b = build({ plan: null, run });
    withIntent(b, { content: 'hola' });
    const frames = await collect(b.service, null);
    expect(frames.some((f) => f.type === 'text')).toBe(false);
    const roles = b.prisma.ai_messages.create.mock.calls.map(
      (c: any) => c[0].data.role,
    );
    expect(roles).toEqual(['user']);
  });

  it('shouldAbort consulta isCurrentTurn y niega su resultado', async () => {
    const b = build({ plan: null });
    withIntent(b, { content: 'hola' });
    await collect(b.service, null);
    const { shouldAbort } = b.run.mock.calls[0][0];
    b.streamIntents.isCurrentTurn.mockResolvedValue(false);
    expect(await shouldAbort()).toBe(true);
    b.streamIntents.isCurrentTurn.mockResolvedValue(true);
    expect(await shouldAbort()).toBe(false);
    expect(b.streamIntents.isCurrentTurn).toHaveBeenCalledWith(7, 's1');
  });
});

describe('AIChatService — agente configurable del chat por defecto', () => {
  const vexi = {
    key: 'vexi',
    app_key: 'chat_assistant',
    system_prompt: null,
    allowed_tools: ['list_orders', 'ui_navigate'],
    max_iterations: 9,
    is_active: true,
  };

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([null, 'chat_assistant'])(
    'usa la fila vexi en un hilo sin agente y app_key=%s, en sync y SSE',
    async (appKey) => {
      const b = build({ agentRow: vexi, conversation: { app_key: appKey } });
      await b.service.sendMessage(7, { content: 'últimas órdenes' });
      expect(b.runSync).toHaveBeenCalledWith(
        expect.objectContaining({
          app_key: 'chat_assistant',
          tools: ['list_orders', 'ui_navigate'],
          max_iterations: 9,
        }),
      );
      b.streamIntents.consume.mockResolvedValue({
        conversation_id: 7,
        user_id: 9,
        content: 'llévame',
      });
      await collect(b.service, null);
      expect(b.run).toHaveBeenCalledWith(
        expect.objectContaining({
          app_key: 'chat_assistant',
          tools: ['list_orders', 'ui_navigate'],
          max_iterations: 9,
        }),
      );
      expect(b.findAgent).toHaveBeenCalledWith({ where: { key: 'vexi' } });
    },
  );

  it('respeta el agente explícito del hilo y el override sync', async () => {
    const b = build({
      agentRow: { ...vexi, key: 'soporte', allowed_tools: ['list_products'] },
      conversation: { metadata: { agent_key: 'soporte' } },
    });
    await b.service.sendMessage(7, { content: 'hola', agent_key: 'otro' });
    expect(b.findAgent).toHaveBeenLastCalledWith({ where: { key: 'otro' } });
    b.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'hola',
    });
    await collect(b.service, null);
    expect(b.findAgent).toHaveBeenLastCalledWith({ where: { key: 'soporte' } });
    expect(b.run.mock.calls[0][0].tools).toEqual(['list_products']);
  });

  it('no usa vexi para una app distinta sin agente explícito', async () => {
    const b = build({ conversation: { app_key: 'otra_app' } });
    await b.service.sendMessage(7, { content: 'hola' });
    b.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'hola',
    });
    await collect(b.service, null);
    expect(b.findAgent).not.toHaveBeenCalled();
    expect(b.runSync.mock.calls[0][0]).toMatchObject({ app_key: 'otra_app' });
    expect(b.run.mock.calls[0][0]).toMatchObject({ app_key: 'otra_app' });
    expect(b.run.mock.calls[0][0]).not.toHaveProperty('tools');
  });

  it.each([null, { ...vexi, is_active: false }])(
    'fila vexi ausente o inactiva conserva el fallback del chat',
    async (agentRow) => {
      const b = build({ agentRow });
      await b.service.sendMessage(7, { content: 'hola' });
      expect(b.runSync.mock.calls[0][0]).toMatchObject({
        app_key: 'chat_assistant',
      });
      expect(b.runSync.mock.calls[0][0]).not.toHaveProperty('tools');
      expect(b.runSync.mock.calls[0][0]).not.toHaveProperty('max_iterations');
    },
  );
});

describe('VexiStreamIntentService — claim de turno', () => {
  it('isCurrentTurn compara y tolera errores de Redis (nunca aborta)', async () => {
    const redis: any = { set: jest.fn(), get: jest.fn() };
    const svc = new VexiStreamIntentService(redis);
    await svc.claimTurn(7, 'a');
    expect(redis.set).toHaveBeenCalledWith('vexi:turn:7', 'a', 'EX', 600);
    redis.get.mockResolvedValue('b');
    expect(await svc.isCurrentTurn(7, 'a')).toBe(false);
    redis.get.mockResolvedValue('a');
    expect(await svc.isCurrentTurn(7, 'a')).toBe(true);
    redis.get.mockRejectedValue(new Error('redis down'));
    expect(await svc.isCurrentTurn(7, 'a')).toBe(true);
    redis.set.mockRejectedValue(new Error('redis down'));
    await expect(svc.claimTurn(7, 'a')).resolves.toBeUndefined();
  });
});

describe('VexiController.applyConfirmation — plan', () => {
  const make = (markImpl: jest.Mock) => {
    const planState: any = { markCurrentChangeStep: markImpl };
    const controller = new VexiController(
      {} as any,
      { success: jest.fn((d) => d) } as any,
      {
        executeTool: jest
          .fn()
          .mockResolvedValue(JSON.stringify({ summary: 'Precio subido' })),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        recordApplied: jest.fn().mockResolvedValue(undefined),
        recordAppliedNarration: jest.fn().mockResolvedValue(undefined),
      } as any,
      {} as any,
      {} as any,
      planState,
    );
    return controller;
  };
  const dto: any = {
    tool: 'write_endpoint',
    arguments: {},
    confirmation_token: 't',
    conversation_id: 7,
  };

  it('marca done con la evidencia truncada a 300', async () => {
    const mark = jest.fn().mockResolvedValue(null);
    await make(mark).applyConfirmation(dto);
    expect(mark).toHaveBeenCalledWith(7, 'done', 'Precio subido');
  });

  it('sin conversation_id no toca el plan', async () => {
    const mark = jest.fn();
    await make(mark).applyConfirmation({ ...dto, conversation_id: undefined });
    expect(mark).not.toHaveBeenCalled();
  });

  it('un error del plan no hace fallar la escritura ya aplicada', async () => {
    const mark = jest.fn().mockRejectedValue(new Error('boom'));
    const res: any = await make(mark).applyConfirmation(dto);
    expect(res.tool).toBe('write_endpoint');
    expect(res.summary).toBe('Precio subido');
  });
});
