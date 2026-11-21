import { AIChatService } from './ai-chat.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  contextUsagePercent,
  estimateContextBudget,
  latestPersistedContextBudget,
} from '../../../ai-engine/context/agent-context-budget';

/**
 * T21 (F3 FIX B1): one measure for the «Contexto N %» ring and the
 * compaction. The chat forwards the engine budget the agent reports on
 * `done`, persists that same value on the assistant row (the ring reads it
 * back after a reload) and the next turn's compaction decides on it.
 */

const budgetOf = (tokens: number, window = 100000) => ({
  estimated_input_tokens: tokens,
  omitted_messages: 0,
  context_window_tokens: window,
  provenance: 'configured' as const,
  method: 'conservative_estimate' as const,
});

const vexRow = {
  key: 'vex',
  app_key: 'vex_assistant',
  system_prompt: null,
  allowed_tools: [],
  max_iterations: 40,
  is_active: true,
};

function agentGen(chunks: any[], result: any) {
  return jest.fn(async function* () {
    for (const c of chunks) yield c;
    return result;
  });
}

function build(opts: {
  chunks: any[];
  result?: any;
  messages?: any[];
  metadata?: Record<string, unknown> | null;
  compactor?: { compactIfNeeded: jest.Mock };
}) {
  const prisma: any = {
    ai_conversations: {
      findFirst: jest.fn().mockResolvedValue({
        id: 7,
        store_id: 1,
        organization_id: 1,
        user_id: 9,
        title: 'x',
        app_key: null,
        status: 'active',
        metadata: opts.metadata === undefined ? { agent_key: 'vex' } : opts.metadata,
        summary: null,
        summary_through_message_id: null,
        messages: opts.messages ?? [],
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    ai_messages: {
      create: jest.fn().mockResolvedValue({ id: 99 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const run = agentGen(opts.chunks, {
    tools_used: [],
    content: '',
    ...opts.result,
  });
  const runSync = jest.fn().mockResolvedValue({
    content: 'ok',
    total_tokens: 1,
    tools_used: [],
    ...opts.result,
  });
  const streamIntents: any = {
    consume: jest
      .fn()
      .mockResolvedValue({ conversation_id: 7, user_id: 9, content: 'hola' }),
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
  const isVex = (opts.metadata === undefined ? { agent_key: 'vex' } : opts.metadata)
    ?.agent_key === 'vex';
  const service = new AIChatService(
    prisma,
    {
      ai_agents: {
        findUnique: jest.fn().mockResolvedValue(isVex ? vexRow : null),
      },
      store_settings: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ settings: { vex: { enabled: true } } }),
      },
    } as any,
    {
      supportsAgentStreaming: jest.fn().mockResolvedValue(false),
      getApplication: jest
        .fn()
        .mockResolvedValue({ metadata: { agent_enabled: true } }),
    } as any,
    {} as any,
    { runAgentStream: run, runAgent: runSync } as any,
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
    {
      canUseAIFeature: jest.fn().mockResolvedValue({
        allowed: true,
        mode: 'allow',
        severity: 'info',
        subscription_state: 'active',
        plan_id: 1,
        has_record: true,
      }),
    } as any,
    { isEnforce: jest.fn().mockReturnValue(true) } as any,
    {
      recentSelections: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      listByConversation: jest.fn().mockResolvedValue([]),
      attachToMessage: jest.fn().mockResolvedValue(0),
    } as any,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    opts.compactor as any,
  );
  jest
    .spyOn(service as any, 'durableTurnArgs')
    .mockImplementation(async (conv: any, _key, _goal, base: any) => ({
      ...base,
      conversation_id: conv.id,
      messages: [],
    }));
  return { service, prisma, run, runSync };
}

const ctx = {
  user_id: 9,
  store_id: 1,
  organization_id: 1,
  is_owner: true,
  is_super_admin: false,
} as any;

async function stream(service: AIChatService) {
  const frames: any[] = [];
  await RequestContextService.runIsolated(ctx, async () => {
    for await (const { replay: _r, ...f } of service.sendMessageStream(7, 's1'))
      if (f.type !== 'progress') frames.push(f);
  });
  return frames;
}

const assistantRow = (prisma: any) =>
  prisma.ai_messages.create.mock.calls
    .map((c: any) => c[0].data)
    .find((row: any) => row.role === 'assistant');

describe('T21 context budget: one measure for ring and compaction', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      user_id: 9,
      store_id: 1,
      organization_id: 1,
      roles: ['owner'],
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('Vex SSE turn forwards the agent budget on done and persists the same value', async () => {
    const b = build({
      chunks: [
        { type: 'text', content: 'Tienes 3 pedidos.' },
        {
          type: 'done',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          context_budget: budgetOf(81000),
          cost_usd: 0.002,
        },
      ],
    });
    const frames = await stream(b.service);
    const done = frames.find((f) => f.type === 'done');
    expect(done.context_budget).toEqual(budgetOf(81000));
    const row = assistantRow(b.prisma);
    expect(row.metadata.context_budget).toEqual(budgetOf(81000));
    expect(row.cost_usd).toBe(0.002);
  });

  it('Vex SSE turn without an engine budget sends and persists the fallback estimate', async () => {
    const b = build({
      chunks: [
        { type: 'text', content: 'hola' },
        { type: 'done', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
      ],
    });
    const frames = await stream(b.service);
    const done = frames.find((f) => f.type === 'done');
    expect(done.context_budget.provenance).toBe('fallback');
    expect(assistantRow(b.prisma).metadata.context_budget).toEqual(
      done.context_budget,
    );
  });

  it('compaction decides on the budget persisted with the last answer', async () => {
    const compactIfNeeded = jest.fn().mockResolvedValue({
      summary: 'Lo conversado antes',
      summary_through_message_id: 2,
    });
    const messages = [
      { id: 1, role: 'user', content: 'hola', metadata: null },
      {
        id: 2,
        role: 'assistant',
        content: 'ok',
        metadata: { context_budget: budgetOf(70000) },
      },
      { id: 3, role: 'user', content: 'sigue', metadata: null },
      {
        id: 4,
        role: 'assistant',
        content: 'listo',
        metadata: { context_budget: budgetOf(80000) },
      },
    ];
    const b = build({
      messages,
      compactor: { compactIfNeeded },
      chunks: [{ type: 'text', content: 'x' }, { type: 'done' }],
    });
    const frames = await stream(b.service);
    expect(compactIfNeeded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      budgetOf(80000),
    );
    const compacted = frames.findIndex((f) => f.type === 'context_compacted');
    expect(compacted).toBeGreaterThanOrEqual(0);
    expect(compacted).toBeLessThan(frames.findIndex((f) => f.type === 'done'));
  });
});

describe('T21 shared measure helpers', () => {
  it('estimateContextBudget returns the fallback shape with the 32768 default window', () => {
    const budget = estimateContextBudget([
      { role: 'user', content: 'hola mundo' },
    ]);
    expect(budget.context_window_tokens).toBe(32768);
    expect(budget.provenance).toBe('fallback');
    expect(budget.method).toBe('conservative_estimate');
    expect(budget.omitted_messages).toBe(0);
    expect(budget.estimated_input_tokens).toBeGreaterThan(0);
  });

  it('contextUsagePercent mirrors the ring: rounded, capped, null when unknown', () => {
    expect(contextUsagePercent(budgetOf(74600))).toBe(75);
    expect(contextUsagePercent(budgetOf(250000))).toBe(100);
    expect(contextUsagePercent(budgetOf(10, 0))).toBeNull();
    expect(contextUsagePercent(null)).toBeNull();
  });

  it('latestPersistedContextBudget reads the newest valid assistant budget', () => {
    expect(
      latestPersistedContextBudget([
        { role: 'assistant', metadata: { context_budget: budgetOf(1000) } },
        { role: 'assistant', metadata: { context_budget: { bogus: true } } },
        { role: 'user', metadata: { context_budget: budgetOf(9) } },
      ]),
    ).toEqual(budgetOf(1000));
    expect(latestPersistedContextBudget([{ role: 'user' }])).toBeNull();
  });
});
