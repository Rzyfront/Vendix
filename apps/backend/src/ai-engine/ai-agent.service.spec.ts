import { AIAgentService } from './ai-agent.service';
import { RequestContextService } from '../common/context/request-context.service';
import { AgentPlan, AgentPlanHook } from './interfaces/agent-plan.interface';
import { AIStreamChunk } from './interfaces/ai-provider.interface';

const def = (name: string) => ({
  type: 'function' as const,
  function: { name, description: name, parameters: {} },
});

const call = (id: string, name: string, args: any = {}) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) },
});

const ok = (over: any) => ({
  success: true,
  content: '',
  usage: { totalTokens: 10 },
  ...over,
});

const makePlan = (over: Partial<AgentPlan> = {}): AgentPlan => ({
  id: 'p1',
  status: 'active',
  goal: 'g',
  deliverables: [],
  steps: [],
  created_at: '',
  updated_at: '',
  ...over,
});

const step = (order: number, status: any) => ({
  order,
  title: `Paso ${order}`,
  kind: 'cambio' as const,
  done_when: 'x',
  status,
  attempts: 0,
});

describe('AIAgentService.runAgentStream', () => {
  let chat: jest.Mock;
  let executeTool: jest.Mock;
  let awaitResult: jest.Mock;
  let emit: jest.Mock;
  let service: AIAgentService;

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      permissions: ['p'],
      roles: [],
    } as any);
    chat = jest.fn();
    executeTool = jest.fn().mockResolvedValue('{"ok":true}');
    awaitResult = jest.fn().mockResolvedValue('{"ui":"ok"}');
    emit = jest.fn();
    const registry: any = {
      getAvailableDefinitions: jest
        .fn()
        .mockReturnValue([
          def('list_things'),
          def('ui_go'),
          def('propose_plan'),
          def('ask_user'),
        ]),
      canonicalName: (n: string) => n,
      getDeprecation: () => undefined,
      isClientSide: (n: string) => n.startsWith('ui_'),
      executeTool,
    };
    service = new AIAgentService(
      { chat, run: jest.fn(), chatWith: jest.fn() } as any,
      {} as any,
      registry,
      { emit } as any,
      { awaitResult } as any,
      {
        canUseAIFeature: jest.fn(),
        getAIFeatureConfig: jest.fn(),
        consumeAIQuota: jest.fn().mockResolvedValue(undefined),
      } as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  async function drain(params: any) {
    const chunks: AIStreamChunk[] = [];
    const gen = service.runAgentStream({ goal: 'hola', ...params });
    let next = await gen.next();
    while (!next.done) {
      chunks.push(next.value);
      next = await gen.next();
    }
    return { chunks, result: next.value };
  }

  it('(i) processes tool_calls even when finish_reason is stop', async () => {
    chat
      .mockResolvedValueOnce(
        ok({
          finish_reason: 'stop',
          tool_calls: [call('c1', 'list_things')],
        }),
      )
      .mockResolvedValueOnce(ok({ finish_reason: 'stop', content: 'listo' }));

    const { chunks, result } = await drain({});

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith('list_things', {});
    expect(result.content).toBe('listo');
    expect(result.iterations).toBe(2);
    expect(chunks.map((c) => c.type)).toEqual([
      'tool_call',
      'tool_result',
      'text',
      'done',
    ]);
  });

  it('(ii) plan tool via hook: no frames, no executeTool, not in tools_used', async () => {
    const execute = jest.fn().mockResolvedValue({ result: '{"plan":"ok"}' });
    const plan: AgentPlanHook = {
      execute,
      snapshot: jest.fn().mockResolvedValue(null),
    };
    chat
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('c1', 'propose_plan', { goal: 'x' })] }),
      )
      .mockResolvedValueOnce(ok({ content: 'fin' }));

    const { chunks, result } = await drain({ plan });

    expect(execute).toHaveBeenCalledWith('propose_plan', { goal: 'x' });
    expect(executeTool).not.toHaveBeenCalled();
    expect(chunks.map((c) => c.type)).toEqual(['text', 'done']);
    expect(result.tools_used).toEqual([]);
    const offered = chat.mock.calls[0][1].tools.map(
      (t: any) => t.function.name,
    );
    expect(offered).toContain('propose_plan');
    expect(offered).toContain('ask_user');
  });

  it('plan tools are injected when params.tools excludes them', async () => {
    const plan: AgentPlanHook = {
      execute: jest.fn(),
      snapshot: jest.fn().mockResolvedValue(null),
    };
    chat.mockResolvedValueOnce(ok({ content: 'hola' }));
    await drain({ plan, tools: ['list_things'] });
    const offered = chat.mock.calls[0][1].tools.map(
      (t: any) => t.function.name,
    );
    expect(offered).toEqual(['list_things', 'propose_plan', 'ask_user']);
  });

  it('(iii) ask_user endTurn returns the question as final text', async () => {
    const plan: AgentPlanHook = {
      execute: jest
        .fn()
        .mockResolvedValue({ result: '{}', endTurn: { text: '¿Cuál?' } }),
      snapshot: jest.fn().mockResolvedValue(null),
    };
    chat.mockResolvedValueOnce(
      ok({ tool_calls: [call('c1', 'ask_user', { question: '¿Cuál?' })] }),
    );

    const { chunks, result } = await drain({ plan });

    expect(chunks.map((c) => c.type)).toEqual(['text', 'done']);
    expect((chunks[0] as any).content).toBe('¿Cuál?');
    expect(result).toMatchObject({
      success: true,
      content: '¿Cuál?',
      iterations: 1,
    });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('(iv) prose with a pending step nudges twice, then closes', async () => {
    const plan: AgentPlanHook = {
      execute: jest.fn(),
      snapshot: jest
        .fn()
        .mockResolvedValue(
          makePlan({ steps: [step(1, 'done'), step(2, 'pending')] }),
        ),
    };
    chat.mockResolvedValue(ok({ content: 'sigo' }));

    const { chunks, result } = await drain({ plan });

    expect(chat).toHaveBeenCalledTimes(3);
    const nudge = chat.mock.calls[1][0].at(-1);
    expect(nudge.role).toBe('user');
    expect(nudge.content).toBe(
      '(interno) Aún no terminas: paso 2: Paso 2. Continúa sin avisarle a la persona; solo detente para una escritura (tarjeta) o con ask_user.',
    );
    expect(chunks.map((c) => c.type)).toEqual(['text', 'done']);
    expect(result.content).toBe('sigo');
    expect(result.iterations).toBe(3);
  });

  it('(iv-b) waiting_user step does not nudge', async () => {
    const plan: AgentPlanHook = {
      execute: jest.fn(),
      snapshot: jest
        .fn()
        .mockResolvedValue(
          makePlan({ steps: [step(1, 'waiting_user'), step(2, 'pending')] }),
        ),
    };
    chat.mockResolvedValue(ok({ content: 'pregunta' }));
    const { result } = await drain({ plan });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('pregunta');
  });

  it('(iv-c) closed steps with an unverified deliverable nudge to verify', async () => {
    const plan: AgentPlanHook = {
      execute: jest.fn(),
      snapshot: jest.fn().mockResolvedValue(
        makePlan({
          steps: [step(1, 'done')],
          deliverables: [{ id: 'd', description: 'd', verified: false }],
        }),
      ),
    };
    chat.mockResolvedValue(ok({ content: 'x' }));
    await drain({ plan });
    expect(chat.mock.calls[1][0].at(-1).content).toContain(
      'verifica los entregables con verify_deliverables',
    );
  });

  it('(v) timeout with an active plan emits plan_continue without throwing', async () => {
    const plan: AgentPlanHook = {
      execute: jest.fn(),
      snapshot: jest
        .fn()
        .mockResolvedValue(makePlan({ steps: [step(1, 'pending')] })),
    };
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => {
      now += 200_000;
      return now;
    });

    const { chunks, result } = await drain({ plan });

    expect(chat).not.toHaveBeenCalled();
    expect(chunks.map((c) => c.type)).toEqual(['plan_continue', 'done']);
    expect(result).toMatchObject({
      success: true,
      plan_continue: true,
      content: '',
    });
  });

  it('(v-b) timeout without a plan closes kindly, no exception', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => {
      now += 100_000;
      return now;
    });
    chat.mockResolvedValueOnce(ok({ content: 'Esto encontré' }));

    const { chunks, result } = await drain({});

    expect(chunks.map((c) => c.type)).toEqual(['text']);
    expect(result).toMatchObject({ success: true, content: 'Esto encontré' });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][1]).toEqual({});
  });

  it('time waiting on the browser does not consume the turn budget', async () => {
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    awaitResult.mockImplementation(async () => {
      now += 100_000;
      return '{"ui":"ok"}';
    });
    chat
      .mockResolvedValueOnce(ok({ tool_calls: [call('u1', 'ui_go')] }))
      .mockResolvedValueOnce(ok({ content: 'hecho' }));

    const { result } = await drain({ stream_id: 's1' });

    expect(result.content).toBe('hecho');
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('(vi) shouldAbort true returns aborted without emitting anything', async () => {
    const { chunks, result } = await drain({
      shouldAbort: jest.fn().mockResolvedValue(true),
    });
    expect(chunks).toEqual([]);
    expect(result).toEqual({
      content: '',
      iterations: 0,
      tools_used: [],
      total_tokens: 0,
      success: false,
      aborted: true,
    });
    expect(chat).not.toHaveBeenCalled();
  });
});
