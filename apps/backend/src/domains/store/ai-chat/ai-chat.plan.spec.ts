import { AIChatService } from './ai-chat.service';
import { Prisma } from '@prisma/client';
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
  vexEnabled?: boolean;
  access?: Record<string, unknown>;
  enforce?: boolean;
  /** Resolves the Vex-only services (blocks, plan approval, confirmations). */
  wireVex?: boolean;
}) {
  const prisma: any = {
    ai_conversations: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ ...conversation(opts.messages), ...opts.conversation }),
      update: jest.fn().mockResolvedValue({}),
      create: jest
        .fn()
        .mockImplementation(async ({ data }: any) => ({ id: 11, ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    ai_messages: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const run = opts.run ?? agentGen([{ type: 'done' }], EMPTY_RESULT);
  const runSync = jest.fn().mockResolvedValue({ content: 'ok', total_tokens: 1 });
  const aiAgent = { runAgentStream: run, runAgent: runSync };
  const findAgent = jest.fn().mockResolvedValue(opts.agentRow ?? null);
  const findVexSettings = jest.fn().mockResolvedValue(
    opts.vexEnabled === true
      ? { settings: { vex: { enabled: true } } }
      : { settings: { vex: { enabled: false } } },
  );
  const canUseAIFeature = jest.fn().mockResolvedValue({
    allowed: true,
    mode: 'allow',
    severity: 'info',
    subscription_state: 'active',
    plan_id: 1,
    has_record: true,
    ...opts.access,
  });
  const gateConfig = {
    isEnforce: jest.fn().mockReturnValue(opts.enforce ?? true),
  };
  const buildSnapshot = jest.fn().mockResolvedValue({});
  const buildVexSnapshot = jest.fn().mockResolvedValue({});
  const planState: any = {
    getActive: jest.fn().mockResolvedValue(opts.plan ?? null),
    get: jest.fn().mockResolvedValue(opts.paused ?? opts.plan ?? null),
    markCurrentChangeStep: jest.fn().mockResolvedValue(null),
    createHook: jest.fn().mockReturnValue({ hook: true }),
    setStepHashes: jest.fn().mockResolvedValue([]),
  };
  const streamIntents: any = {
    consume: jest.fn(),
    claimTurn: jest.fn().mockResolvedValue(undefined),
    isCurrentTurn: jest.fn().mockResolvedValue(true),
  };
  const vexBlocks: any = opts.wireVex
    ? {
        recentSelections: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'block-1', kind: 'markdown', version: 1 }),
        listByConversation: jest.fn().mockResolvedValue([]),
        attachToMessage: jest.fn().mockResolvedValue(0),
      }
    : undefined;
  const planApproval: any = opts.wireVex
    ? {
        classifySteps: jest.fn((steps: any[]) => ({
          covered: steps,
          reconfirm: [],
        })),
      }
    : undefined;
  const confirmations: any = opts.wireVex
    ? { issue: jest.fn().mockResolvedValue('su-1') }
    : undefined;
  const service = new AIChatService(
    prisma,
    {
      ai_agents: { findUnique: findAgent },
      store_settings: { findUnique: findVexSettings },
    } as any,
    {
      getApplication: jest
        .fn()
        .mockResolvedValue({ metadata: { agent_enabled: true } }),
    } as any,
    {} as any,
    aiAgent as any,
    {} as any,
    { emit: jest.fn() } as any,
    { buildSnapshot, buildVexSnapshot } as any,
    streamIntents,
    { registerTurn: jest.fn(), releaseTurn: jest.fn() } as any,
    {} as any,
    planState,
    { canUseAIFeature } as any,
    gateConfig as any,
    vexBlocks,
    planApproval,
    confirmations,
  );
  return {
    service,
    prisma,
    run,
    runSync,
    findAgent,
    planState,
    streamIntents,
    findVexSettings,
    canUseAIFeature,
    buildSnapshot,
    buildVexSnapshot,
    vexBlocks,
    planApproval,
    confirmations,
  };
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
      b.streamIntents.consume.mockResolvedValue({
        conversation_id: 7,
        user_id: 9,
        content: 'hola',
      });
      await collect(b.service, null);
      expect(b.run.mock.calls[0][0]).toMatchObject({
        app_key: 'chat_assistant',
      });
      expect(b.run.mock.calls[0][0]).not.toHaveProperty('tools');
      expect(b.run.mock.calls[0][0]).not.toHaveProperty('max_iterations');
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

describe('AIChatService — gate y listado de Vex (pasos 3 y 4)', () => {
  const vexRow = {
    key: 'vex',
    app_key: 'vex_assistant',
    system_prompt: null,
    allowed_tools: [],
    max_iterations: 40,
    is_active: true,
  };
  const vexThread = { metadata: { agent_key: 'vex' } };

  const asOwner = () =>
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      user_id: 9,
      organization_id: 1,
      store_id: 1,
      roles: ['owner'],
    } as any);
  const asCashier = () =>
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      user_id: 9,
      organization_id: 1,
      store_id: 1,
      roles: ['employee'],
    } as any);

  afterEach(() => jest.restoreAllMocks());

  it('cajero creando hilo vex → 403 y no persiste la conversación', async () => {
    asCashier();
    const b = build({ agentRow: vexRow, vexEnabled: true });
    await expect(
      b.service.createConversation({ agent_key: 'vex', title: 't' }),
    ).rejects.toMatchObject({ errorCode: 'AUTH_PERM_001' });
    expect(b.prisma.ai_conversations.create).not.toHaveBeenCalled();
  });

  it('owner con vex apagado → AI_AGENT_004 con mensaje accionable', async () => {
    asOwner();
    const b = build({ agentRow: vexRow, vexEnabled: false });
    const err: any = await b.service
      .createConversation({ agent_key: 'vex' })
      .catch((e) => e);
    expect(err.errorCode).toBe('AI_AGENT_004');
    expect(String(err.message)).toContain('Agentes IA');
    expect(b.canUseAIFeature).not.toHaveBeenCalled();
  });

  it('owner con vex prendido pero plan bloqueado → reason del plan, preguntando vex_agent', async () => {
    asOwner();
    const b = build({
      agentRow: vexRow,
      vexEnabled: true,
      access: {
        allowed: false,
        mode: 'block',
        reason: 'SUBSCRIPTION_005',
        subscription_state: 'expired',
      },
    });
    await expect(
      b.service.createConversation({ agent_key: 'vex' }),
    ).rejects.toMatchObject({ errorCode: 'SUBSCRIPTION_005' });
    expect(b.canUseAIFeature).toHaveBeenCalledWith(1, 'vex_agent');
  });

  it('log-only: plan bloqueado observa y deja crear', async () => {
    asOwner();
    const b = build({
      agentRow: vexRow,
      vexEnabled: true,
      enforce: false,
      access: { allowed: false, mode: 'block', reason: 'SUBSCRIPTION_005' },
    });
    const created: any = await b.service.createConversation({
      agent_key: 'vex',
    });
    expect(created.metadata).toEqual({ agent_key: 'vex' });
  });

  it('owner + toggle + plan → crea el hilo con metadata.agent_key=vex', async () => {
    asOwner();
    const b = build({ agentRow: vexRow, vexEnabled: true });
    const created: any = await b.service.createConversation({
      agent_key: 'vex',
      title: 't',
    });
    expect(created.metadata).toEqual({ agent_key: 'vex' });
    expect(b.canUseAIFeature).toHaveBeenCalledWith(1, 'vex_agent');
  });

  it('turno sync vex denegado no deja fila de usuario huérfana', async () => {
    asCashier();
    const b = build({ agentRow: vexRow, conversation: vexThread });
    await expect(
      b.service.sendMessage(7, { content: 'hola' }),
    ).rejects.toMatchObject({ errorCode: 'AUTH_PERM_001' });
    expect(b.prisma.ai_messages.create).not.toHaveBeenCalled();
    expect(b.runSync).not.toHaveBeenCalled();
  });

  it('override agent_key=vex por mensaje en hilo vexi también se gatea', async () => {
    asCashier();
    const b = build({ agentRow: vexRow });
    await expect(
      b.service.sendMessage(7, { content: 'hola', agent_key: 'vex' }),
    ).rejects.toMatchObject({ errorCode: 'AUTH_PERM_001' });
    expect(b.runSync).not.toHaveBeenCalled();
  });

  it('hilo legacy sin roles sigue contestando: el gate es no-op fuera de vex', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9 } as any);
    const b = build({});
    await b.service.sendMessage(7, { content: 'hola' });
    expect(b.runSync).toHaveBeenCalled();
    expect(b.canUseAIFeature).not.toHaveBeenCalled();
    expect(b.findVexSettings).not.toHaveBeenCalled();
  });

  it('turno SSE de Vex arma snapshot Vex sin ui_context', async () => {
    asOwner();
    const b = build({
      wireVex: true,
      agentRow: vexRow,
      conversation: vexThread,
      vexEnabled: true,
    });
    b.vexBlocks.listByConversation.mockResolvedValue([
      {
        id: 'b1',
        kind: 'table',
        version: 2,
        spec: { title: 'Ventas' },
        data: { rows: [{ a: 1 }, { a: 2 }] },
      },
    ]);
    b.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'hola',
      ui_context: { module: 'pos' },
      attachment_ids: ['a1'],
    });
    await collect(b.service, null);
    expect(b.run).toHaveBeenCalled();
    expect(b.buildSnapshot).not.toHaveBeenCalled();
    expect(b.buildVexSnapshot).toHaveBeenCalledWith({
      attachmentIds: ['a1'],
      vexBlocks: [
        { block_id: 'b1', kind: 'table', version: 2, title: 'Ventas', rows: 2 },
      ],
    });
  });

  it('turno SSE de Vexi conserva ui_context en el snapshot', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9 } as any);
    const b = build({});
    b.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'hola',
      ui_context: { module: 'pos' },
      attachment_ids: undefined,
    });
    await collect(b.service, null);
    expect(b.buildSnapshot).toHaveBeenCalledWith({
      uiContext: { module: 'pos' },
      attachmentIds: undefined,
    });
  });

  it('turno de Vex usa ventana de 20 mensajes', async () => {
    asOwner();
    const messages = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
    }));
    const b = build({
      agentRow: vexRow,
      conversation: vexThread,
      messages,
      vexEnabled: true,
    });
    b.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'hola',
    });
    await collect(b.service, null);
    const params = b.run.mock.calls[0][0];
    expect(params.messages).toHaveLength(20);
    expect(params.messages[0]).toEqual({ role: 'assistant', content: 'm5' });
  });

  it('listado agent_key=vex filtra por path y conserva el scope', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9 } as any);
    const b = build({});
    await b.service.listConversations({ agent_key: 'vex' } as any);
    const where = b.prisma.ai_conversations.findMany.mock.calls[0][0].where;
    expect(where.user_id).toBe(9);
    expect(where.metadata).toEqual({ path: ['agent_key'], equals: 'vex' });
    expect(b.prisma.ai_conversations.count.mock.calls[0][0]).toEqual({
      where,
    });
  });

  it('listado agent_key=vexi incluye hilos legacy sin agent_key', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9 } as any);
    const b = build({});
    await b.service.listConversations({ agent_key: 'vexi' } as any);
    const where = b.prisma.ai_conversations.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { metadata: { path: ['agent_key'], equals: 'vexi' } },
      { metadata: { equals: Prisma.AnyNull } },
    ]);
  });

  it('listado sin filtro excluye vex pero conserva legacy y otras keys', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9 } as any);
    const b = build({});
    await b.service.listConversations({} as any);
    const where = b.prisma.ai_conversations.findMany.mock.calls[0][0].where;
    expect(where.user_id).toBe(9);
    expect(where.OR).toEqual([
      { metadata: { equals: Prisma.AnyNull } },
      { NOT: { metadata: { path: ['agent_key'], equals: 'vex' } } },
    ]);
  });
});

describe('AIChatService — cableado de plan Vex (rx3)', () => {
  const vexRow = {
    key: 'vex',
    app_key: 'vex_assistant',
    system_prompt: null,
    allowed_tools: [],
    max_iterations: 40,
    is_active: true,
  };
  const vexThread = { metadata: { agent_key: 'vex' } };
  const vexiRow = {
    key: 'vexi',
    app_key: 'chat_assistant',
    system_prompt: null,
    allowed_tools: ['list_orders'],
    max_iterations: 9,
    is_active: true,
  };

  const asOwner = () =>
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      user_id: 9,
      organization_id: 1,
      store_id: 1,
      roles: ['owner'],
    } as any);

  afterEach(() => jest.restoreAllMocks());

  it('turno SSE vex recibe plan_approval y block_sink definidos y cableados', async () => {
    asOwner();
    const b = build({
      wireVex: true,
      agentRow: vexRow,
      conversation: vexThread,
      vexEnabled: true,
    });
    b.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'hola',
    });
    await collect(b.service, null);

    const params = b.run.mock.calls[0][0];
    expect(params.agent_key).toBe('vex');
    expect(params.plan_approval).toBeDefined();
    expect(params.block_sink).toBeDefined();

    // El hook respalda: classify → PlanApprovalService, save → setStepHashes.
    params.plan_approval.classifyProposedSteps([
      { order: 1, tool: 'create_customer', args: {} },
    ]);
    expect(b.planApproval.classifySteps).toHaveBeenCalledWith([
      { order: 1, tool: 'create_customer', args: {} },
    ]);
    await params.plan_approval.saveProposedSteps([
      { order: 1, tool: 'create_customer', args: {} },
    ]);
    expect(b.planState.setStepHashes).toHaveBeenCalledWith(7, [
      { order: 1, tool: 'create_customer', args: {} },
    ]);
    // Proposing turn (sin token): todo redeem responde missing.
    await expect(
      params.plan_approval.redeem('create_customer', {}),
    ).resolves.toBe('missing');

    // El sink persiste bajo la conversación vía VexBlockService.
    const id = await params.block_sink.save({
      kind: 'markdown',
      data: { text: 'x'.repeat(7000) },
    });
    expect(id).toBe('block-1');
    expect(b.vexBlocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: 7, kind: 'markdown' }),
    );
  });

  it('turno sync vex también recibe hook y sink', async () => {
    asOwner();
    const b = build({
      wireVex: true,
      agentRow: vexRow,
      conversation: vexThread,
      vexEnabled: true,
    });
    await b.service.sendMessage(7, { content: 'hola' });
    const params = b.runSync.mock.calls[0][0];
    expect(params.agent_key).toBe('vex');
    expect(params.plan_approval).toBeDefined();
    expect(params.block_sink).toBeDefined();
  });

  it('turno vexi no recibe ni hook ni sink (sync y SSE)', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9 } as any);
    const b = build({ wireVex: true, agentRow: vexiRow });
    await b.service.sendMessage(7, { content: 'hola' });
    expect(b.runSync.mock.calls[0][0].agent_key).toBe('vexi');
    expect(b.runSync.mock.calls[0][0]).not.toHaveProperty('plan_approval');
    expect(b.runSync.mock.calls[0][0]).not.toHaveProperty('block_sink');
    b.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'hola',
    });
    await collect(b.service, null);
    expect(b.run.mock.calls[0][0]).not.toHaveProperty('plan_approval');
    expect(b.run.mock.calls[0][0]).not.toHaveProperty('block_sink');
  });

  it('turno vex sin servicios resueltos corre sin hook ni sink (degradado, no roto)', async () => {
    asOwner();
    const b = build({
      agentRow: vexRow,
      conversation: vexThread,
      vexEnabled: true,
    });
    b.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'hola',
    });
    await collect(b.service, null);
    const params = b.run.mock.calls[0][0];
    expect(params.agent_key).toBe('vex');
    expect(b.run).toHaveBeenCalled();
    expect(params).not.toHaveProperty('plan_approval');
    expect(params).not.toHaveProperty('block_sink');
  });
});

describe('AIChatService — persistencia vex (rx6)', () => {
  const vexRow = {
    key: 'vex',
    app_key: 'vex_assistant',
    system_prompt: null,
    allowed_tools: [],
    max_iterations: 40,
    is_active: true,
  };
  const vexThread = { metadata: { agent_key: 'vex' } };
  const STEPS = [
    {
      step_id: 's1',
      order: 1,
      tool: 'create_product',
      arguments: { name: 'A' },
      irreversible: false,
    },
    {
      step_id: 's2',
      order: 2,
      tool: 'send_invoice_dian',
      arguments: { order_id: 5 },
      irreversible: true,
    },
  ];

  const asOwner = () =>
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      user_id: 9,
      organization_id: 1,
      store_id: 1,
      roles: ['owner'],
    } as any);

  afterEach(() => jest.restoreAllMocks());

  const assistantCreate = (b: ReturnType<typeof build>) =>
    b.prisma.ai_messages.create.mock.calls.find(
      (c: any) => c[0].data.role === 'assistant',
    )?.[0].data;

  it('cierre SSE persiste blocks + plan proposed y enlaza message_id', async () => {
    asOwner();
    const run = agentGen(
      [
        { type: 'text', content: 'listo' },
        {
          type: 'ui_block',
          ui_block: { block_id: 'b-table', kind: 'table', version: 2 },
        },
        {
          type: 'ui_block',
          ui_block: { block_id: 'b-chart', kind: 'chart' },
        },
        {
          type: 'plan_approval',
          plan_approval: {
            plan_id: 'p1',
            steps: STEPS,
            covered_steps: [1],
            reconfirm_steps: [2],
          },
        },
        { type: 'done' },
      ],
      {
        tools_used: [],
        content: 'listo',
        pending_plan: { plan_id: 'p1', steps: STEPS },
      },
    );
    const b = build({
      wireVex: true,
      agentRow: vexRow,
      conversation: vexThread,
      vexEnabled: true,
      run,
    });
    // Huérfano de un turno anterior: el barrido lo recoge y también se enlaza.
    b.vexBlocks.listByConversation.mockResolvedValue([
      { id: 'b-old', kind: 'markdown', version: 1, message_id: null },
      { id: 'b-linked', kind: 'table', version: 1, message_id: 41 },
    ]);
    b.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'hola',
    });
    await collect(b.service, null);

    const data = assistantCreate(b);
    expect(data.metadata).toEqual({
      blocks: [
        { block_id: 'b-table', kind: 'table', version: 2 },
        { block_id: 'b-chart', kind: 'chart', version: 1 },
        { block_id: 'b-old', kind: 'markdown', version: 1 },
      ],
      plan: { plan_id: 'p1', steps: STEPS, status: 'proposed' },
    });
    expect(b.vexBlocks.attachToMessage).toHaveBeenCalledWith(
      ['b-table', 'b-chart', 'b-old'],
      1,
    );
  });

  it('el sink de compactación alimenta el metadata del cierre', async () => {
    asOwner();
    // El loop llama al sink a mitad del turno (compactación >6000 chars).
    const run = jest.fn(async function* (params: any) {
      yield { type: 'text', content: 'ok' };
      await params.block_sink.save({
        kind: 'markdown',
        data: { text: 'x'.repeat(7000) },
      });
      yield { type: 'done' };
      return { tools_used: [], content: 'ok' };
    });
    const b = build({
      wireVex: true,
      agentRow: vexRow,
      conversation: vexThread,
      vexEnabled: true,
      run,
    });
    b.vexBlocks.create.mockResolvedValue({
      id: 'b-sink',
      kind: 'markdown',
      version: 1,
    });
    b.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'hola',
    });
    await collect(b.service, null);

    const data = assistantCreate(b);
    expect(data.metadata).toEqual({
      blocks: [{ block_id: 'b-sink', kind: 'markdown', version: 1 }],
    });
    expect(b.vexBlocks.attachToMessage).toHaveBeenCalledWith(['b-sink'], 1);
  });

  it('camino sync persiste plan + bloques del envelope de render', async () => {
    asOwner();
    const b = build({
      wireVex: true,
      agentRow: vexRow,
      conversation: vexThread,
      vexEnabled: true,
    });
    b.runSync.mockResolvedValue({
      content: 'ok',
      total_tokens: 3,
      tools_used: [
        {
          name: 'vex_render_table',
          args: {},
          result: JSON.stringify({
            data: {
              block_id: 'b-sync',
              kind: 'table',
              version: 1,
              block: { block_id: 'b-sync', kind: 'table', version: 1 },
            },
          }),
        },
        { name: 'list_orders', args: {}, result: '{"data":[]}' },
      ],
      pending_plan: { plan_id: 'p9', steps: STEPS },
    });
    await b.service.sendMessage(7, { content: 'hola' });

    const data = assistantCreate(b);
    expect(data.metadata).toEqual({
      blocks: [{ block_id: 'b-sync', kind: 'table', version: 1 }],
      plan: { plan_id: 'p9', steps: STEPS, status: 'proposed' },
    });
    expect(b.vexBlocks.attachToMessage).toHaveBeenCalledWith(['b-sync'], 1);
    expect(b.buildVexSnapshot).toHaveBeenCalled();
    expect(b.buildSnapshot).not.toHaveBeenCalled();
  });

  it('turno vexi no escribe blocks ni plan', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9 } as any);
    const run = agentGen([{ type: 'text', content: 'hola' }, { type: 'done' }], {
      tools_used: [],
      content: 'hola',
    });
    const b = build({ wireVex: true, run });
    b.streamIntents.consume.mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'hola',
    });
    await collect(b.service, null);
    const data = assistantCreate(b);
    expect(data).not.toHaveProperty('metadata');
    expect(b.vexBlocks.attachToMessage).not.toHaveBeenCalled();
  });

  it('updateVexPlanStatus mueve el estado con updateMany scope-safe', async () => {
    asOwner();
    const b = build({
      agentRow: vexRow,
      conversation: vexThread,
      vexEnabled: true,
      messages: [
        {
          id: 10,
          role: 'assistant',
          content: 'plan',
          metadata: { plan: { plan_id: 'p1', steps: STEPS, status: 'proposed' } },
        },
      ],
    });
    await expect(
      b.service.updateVexPlanStatus(7, 'p1', 'approved'),
    ).resolves.toBe(true);
    expect(b.prisma.ai_messages.updateMany).toHaveBeenCalledWith({
      where: { id: 10, conversation_id: 7 },
      data: {
        metadata: {
          plan: { plan_id: 'p1', steps: STEPS, status: 'approved' },
        },
      },
    });
  });

  it('updateVexPlanStatus conserva blocks y responde false sin match', async () => {
    asOwner();
    const b = build({
      agentRow: vexRow,
      conversation: vexThread,
      vexEnabled: true,
      messages: [
        {
          id: 11,
          role: 'assistant',
          content: 'x',
          metadata: {
            blocks: [{ block_id: 'b1', kind: 'table', version: 1 }],
            plan: { plan_id: 'p1', steps: [], status: 'proposed' },
          },
        },
      ],
    });
    await expect(
      b.service.updateVexPlanStatus(7, 'otro-plan', 'rejected'),
    ).resolves.toBe(false);
    expect(b.prisma.ai_messages.updateMany).not.toHaveBeenCalled();

    await expect(
      b.service.updateVexPlanStatus(7, 'p1', 'rejected'),
    ).resolves.toBe(true);
    const metadata = b.prisma.ai_messages.updateMany.mock.calls[0][0].data
      .metadata as any;
    expect(metadata.blocks).toEqual([
      { block_id: 'b1', kind: 'table', version: 1 },
    ]);
    expect(metadata.plan.status).toBe('rejected');
  });

  it('updateVexPlanStatus rechaza estados fuera del enum', async () => {
    asOwner();
    const b = build({
      agentRow: vexRow,
      conversation: vexThread,
      vexEnabled: true,
    });
    await expect(
      b.service.updateVexPlanStatus(7, 'p1', 'archived'),
    ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
    expect(b.prisma.ai_messages.updateMany).not.toHaveBeenCalled();
  });

  it('onVexPlanApproved mueve la tarjeta a approved (E2E-1)', async () => {
    asOwner();
    const b = build({
      agentRow: vexRow,
      conversation: vexThread,
      vexEnabled: true,
      messages: [
        {
          id: 10,
          role: 'assistant',
          content: 'plan',
          metadata: { plan: { plan_id: 'p1', steps: STEPS, status: 'proposed' } },
        },
      ],
    });
    await expect(
      b.service.onVexPlanApproved({ conversation_id: 7, plan_id: 'p1' }),
    ).resolves.toBeUndefined();
    expect(b.prisma.ai_messages.updateMany).toHaveBeenCalledWith({
      where: { id: 10, conversation_id: 7 },
      data: {
        metadata: {
          plan: { plan_id: 'p1', steps: STEPS, status: 'approved' },
        },
      },
    });
  });

  it('onVexPlanApproved no tumba el approve si el update falla (E2E-1)', async () => {
    asOwner();
    const b = build({
      agentRow: vexRow,
      conversation: vexThread,
      vexEnabled: true,
      messages: [
        {
          id: 10,
          role: 'assistant',
          content: 'plan',
          metadata: { plan: { plan_id: 'p1', steps: STEPS, status: 'proposed' } },
        },
      ],
    });
    b.prisma.ai_messages.updateMany.mockRejectedValueOnce(
      new Error('db caída'),
    );
    await expect(
      b.service.onVexPlanApproved({ conversation_id: 7, plan_id: 'p1' }),
    ).resolves.toBeUndefined();
    expect(b.prisma.ai_messages.updateMany).toHaveBeenCalledTimes(1);
  });
});
