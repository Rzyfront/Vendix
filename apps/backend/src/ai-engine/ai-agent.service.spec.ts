import { AIAgentService } from './ai-agent.service';
import { RequestContextService } from '../common/context/request-context.service';
import { AgentPlan, AgentPlanHook } from './interfaces/agent-plan.interface';
import { AIStreamChunk } from './interfaces/ai-provider.interface';
import { ErrorCodes, VendixHttpException } from '../common/errors';

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
  let registry: any;
  let canUseAIFeature: jest.Mock;
  let getAIFeatureConfig: jest.Mock;
  let consumeAIQuota: jest.Mock;
  let checkExtraQuota: jest.Mock;
  let consumeExtraQuota: jest.Mock;
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
    const definitions = [
      def('list_things'),
      def('ui_go'),
      def('propose_plan'),
      def('ask_user'),
      def('list_orders'),
      def('list_customers'),
      def('ui_navigate'),
      def('create_expense'),
      def('send_invoice_dian'),
      def('vex_render_table'),
    ];
    const domains: Record<string, string> = {
      list_things: 'things',
      ui_go: 'ui',
      propose_plan: 'planning',
      ask_user: 'planning',
      list_orders: 'orders',
      list_customers: 'customers',
      ui_navigate: 'ui',
      create_expense: 'expenses',
      send_invoice_dian: 'invoicing',
      vex_render_table: 'vex',
    };
    registry = {
      getAvailableDefinitions: jest.fn((scopes: string[]) =>
        definitions.filter((tool) => {
          const name = tool.function.name;
          if (name === 'list_orders') {
            return scopes.includes('store:orders:read');
          }
          if (name === 'list_customers') {
            return scopes.includes('store:customers:read');
          }
          return true;
        }),
      ),
      canonicalName: (n: string) => n,
      get: (n: string) =>
        domains[n] ? { name: n, domain: domains[n] } : undefined,
      getDeprecation: () => undefined,
      isClientSide: (n: string) => n.startsWith('ui_'),
      executeTool,
    };
    canUseAIFeature = jest.fn();
    getAIFeatureConfig = jest.fn();
    consumeAIQuota = jest.fn().mockResolvedValue(undefined);
    // Caps de vex_agent (R3-A): por defecto abiertos.
    checkExtraQuota = jest.fn().mockResolvedValue({
      exceeded: false,
      cap: null,
      used: 0,
      degradation: 'block',
    });
    consumeExtraQuota = jest.fn().mockResolvedValue(undefined);
    service = new AIAgentService(
      { chat, run: jest.fn(), chatWith: jest.fn() } as any,
      {} as any,
      registry,
      { emit } as any,
      { awaitResult } as any,
      {
        canUseAIFeature,
        getAIFeatureConfig,
        consumeAIQuota,
        checkExtraQuota,
        consumeExtraQuota,
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

  function configureStorePlan(
    toolsAllowed: string[],
    permissions = ['store:orders:read'],
  ) {
    jest.mocked(RequestContextService.getContext).mockReturnValue({
      store_id: 42,
      permissions,
      roles: [],
    } as any);
    canUseAIFeature.mockResolvedValue({ allowed: true });
    getAIFeatureConfig.mockResolvedValue({ tools_allowed: toolsAllowed });
    chat.mockResolvedValue(ok({ content: 'listo' }));
  }

  function offeredToolNames(): string[] {
    return (chat.mock.calls[0][1].tools ?? []).map(
      (tool: any) => tool.function.name,
    );
  }

  it('offers orders and UI tools when the plan allows the wildcard', async () => {
    configureStorePlan(['*']);

    await drain({});

    expect(offeredToolNames()).toEqual(
      expect.arrayContaining(['list_orders', 'ui_navigate']),
    );
    expect(canUseAIFeature).toHaveBeenCalledWith(42, 'tool_agents');
  });

  it('cuts a degenerate completion: error frame, no text, flagged result', async () => {
    configureStorePlan(['*']);
    chat.mockResolvedValue(ok({ content: 'ells'.repeat(1000), model: 'free-x' }));
    const errorLog = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);

    const { chunks, result } = await drain({});

    expect(chunks.map((c) => c.type)).toEqual(['error']);
    expect(chunks[0].error).toBe(
      'El modelo generó una respuesta inválida y se detuvo. Intenta de nuevo.',
    );
    expect(result.degenerate).toBe(true);
    expect(result.content).toBe('');
    const logged = JSON.parse(errorLog.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      event: 'VEX_DEGENERATE_OUTPUT',
      storeId: 42,
      model: 'free-x',
      chars: 4000,
    });
  });

  it('offers only tools in the allowed domain', async () => {
    configureStorePlan(['orders'], ['store:orders:read', 'store:customers:read']);

    await drain({});

    expect(offeredToolNames()).toContain('list_orders');
    expect(offeredToolNames()).not.toContain('list_customers');
    expect(offeredToolNames()).not.toContain('ui_navigate');
    expect(chat.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('No puedes mover la pantalla'),
        }),
      ]),
    );
  });

  it('offers only an exact tool name from the plan', async () => {
    configureStorePlan(['list_orders']);

    await drain({});

    expect(offeredToolNames()).toEqual(['list_orders']);
  });

  it('preserves a narrower agent filter after applying the plan', async () => {
    configureStorePlan(['*']);

    await drain({ tools: ['list_orders'] });

    expect(offeredToolNames()).toEqual(['list_orders']);
  });

  it('does not offer operational tools for an explicit empty plan list', async () => {
    configureStorePlan([]);

    await drain({});

    expect(offeredToolNames()).toEqual([]);
    expect(chat.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining(
            'No tienes herramientas operativas para consultar datos actuales',
          ),
        }),
      ]),
    );
  });

  it('does not offer operational tools when the subscription gate denies access', async () => {
    configureStorePlan(['*']);
    canUseAIFeature.mockResolvedValue({ allowed: false, reason: 'blocked' });

    await drain({});

    expect(offeredToolNames()).toEqual([]);
  });

  it('keeps the permission filter when the plan allows all tools', async () => {
    configureStorePlan(['*'], []);

    await drain({});

    expect(registry.getAvailableDefinitions).toHaveBeenCalledWith([]);
    expect(offeredToolNames()).toContain('ui_navigate');
    expect(offeredToolNames()).not.toContain('list_orders');
    expect(offeredToolNames()).not.toContain('list_customers');
  });

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

  it('(vex-i) vex catalog excludes denied ui tools, vexi keeps them', async () => {
    registry.getAgentDefinitions = jest.fn(
      (scopes: string[], agentScope: any) =>
        definitionsFor(scopes).filter(
          (tool) =>
            !(agentScope?.denied_tools ?? []).includes(tool.function.name),
        ),
    );
    chat.mockResolvedValue(ok({ content: 'listo' }));

    await drain({ agent_key: 'vex', agent_denied_tools: ['ui_navigate'] });

    expect(registry.getAgentDefinitions).toHaveBeenCalledWith(['p'], {
      allowed_tools: undefined,
      denied_tools: ['ui_navigate'],
    });
    const vexOffered = (chat.mock.calls[0][1].tools ?? []).map(
      (tool: any) => tool.function.name,
    );
    expect(vexOffered).not.toContain('ui_navigate');
    expect(vexOffered).toContain('list_things');

    chat.mockClear();
    await drain({});

    expect(registry.getAvailableDefinitions).toHaveBeenCalled();
    const vexiOffered = (chat.mock.calls[0][1].tools ?? []).map(
      (tool: any) => tool.function.name,
    );
    expect(vexiOffered).toContain('ui_navigate');
  });

  it('(vex-ii) vex default budget is 40 iterations, default stays 10', async () => {
    chat.mockImplementation((_msgs: any, opts: any) =>
      opts && Object.keys(opts).length === 0
        ? ok({ content: 'cierre' })
        : ok({ tool_calls: [call(`c${chat.mock.calls.length}`, 'list_things')] }),
    );

    await drain({ agent_key: 'vex' });
    // 40 tool iterations + 1 closing turn without tools.
    expect(chat).toHaveBeenCalledTimes(41);

    chat.mockClear();
    await drain({});
    expect(chat).toHaveBeenCalledTimes(11);
  });

  it('(vex-iii) vex results over 6000 chars compact to summary+block_id+rows', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `producto-${i}`,
      pad: 'x'.repeat(200),
    }));
    executeTool.mockResolvedValueOnce(JSON.stringify(rows));
    chat
      .mockResolvedValueOnce(ok({ tool_calls: [call('c1', 'list_things')] }))
      .mockResolvedValueOnce(ok({ content: 'listo' }));

    const { result } = await drain({ agent_key: 'vex' });

    const stored = JSON.parse(result.tools_used[0].result);
    expect(stored.truncated).toBe(true);
    expect(stored.block_id).toBeNull();
    expect(stored.rows).toBe(50);
    expect(typeof stored.summary).toBe('string');
    expect(result.tools_used[0].result.length).toBeLessThan(7000);
  });

  it('(vex-iv) compaction keeps the full payload in a block when a sink exists', async () => {
    const save = jest.fn().mockResolvedValue('block-1');
    executeTool.mockResolvedValueOnce(`{"data":"${'y'.repeat(7000)}"}`);
    chat
      .mockResolvedValueOnce(ok({ tool_calls: [call('c1', 'list_things')] }))
      .mockResolvedValueOnce(ok({ content: 'listo' }));

    const { result } = await drain({
      agent_key: 'vex',
      block_sink: { save },
      conversation_id: 7,
    });

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 7,
        kind: 'markdown',
      }),
    );
    expect(JSON.parse(result.tools_used[0].result).block_id).toBe('block-1');
  });

  it('(vex-v) a render tool success emits a ui_block frame', async () => {
    executeTool.mockResolvedValueOnce(
      JSON.stringify({
        tool: 'vex_render_table',
        version: '1',
        data: { block_id: 'b-9', kind: 'table', rows: 3, version: 1 },
      }),
    );
    chat
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('c1', 'vex_render_table', {})] }),
      )
      .mockResolvedValueOnce(ok({ content: 'listo' }));

    const { chunks } = await drain({});

    expect(chunks).toContainEqual({
      type: 'ui_block',
      ui_block: { block_id: 'b-9', kind: 'table', version: 1 },
    });
  });

  it('(vex-vi) a write proposal emits plan_approval and ends the turn', async () => {
    executeTool.mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.AI_AGENT_005, 'requiere confirmación', {
        tool: 'create_expense',
        arguments: { total: 5 },
        preview: { target: 'gasto' },
        confirmation_token: 'tok-1',
      } as any),
    );
    chat.mockResolvedValueOnce(
      ok({ tool_calls: [call('c1', 'create_expense', { total: 5 })] }),
    );

    const { chunks, result } = await drain({});

    expect(chunks.map((c) => c.type)).toEqual([
      'tool_call',
      'tool_result',
      'plan_approval',
      'text',
      'done',
    ]);
    expect(chunks[2]).toMatchObject({
      type: 'plan_approval',
      plan_approval: {
        tool: 'create_expense',
        confirmation_token: 'tok-1',
      },
    });
    expect(result.pending_confirmation).toMatchObject({
      tool: 'create_expense',
      confirmation_token: 'tok-1',
    });
  });

  it('(vex-vii) an approved plan step executes in the same stream', async () => {
    executeTool
      .mockRejectedValueOnce(
        new VendixHttpException(
          ErrorCodes.AI_AGENT_005,
          'requiere confirmación',
          {
            tool: 'create_expense',
            arguments: { total: 5 },
            preview: { target: 'gasto' },
            confirmation_token: 'tok-1',
          } as any,
        ),
      )
      .mockResolvedValueOnce('{"applied":true}');
    chat
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('c1', 'create_expense', { total: 5 })] }),
      )
      .mockResolvedValueOnce(ok({ content: 'aplicado' }));
    const redeem = jest.fn().mockResolvedValue('ok');
    const issueSingleUse = jest.fn().mockResolvedValue('su-1');

    const { chunks, result } = await drain({
      plan_approval: { token: 'plan-tok', plan_id: 'plan-1', redeem, issueSingleUse },
    });

    expect(redeem).toHaveBeenCalledWith('create_expense', { total: 5 });
    expect(issueSingleUse).toHaveBeenCalledWith('create_expense', { total: 5 });
    expect(executeTool).toHaveBeenNthCalledWith(2, 'create_expense', { total: 5 }, {
      confirmationToken: 'su-1',
    });
    expect(result.pending_confirmation).toBeUndefined();
    expect(result.content).toBe('aplicado');
    expect(chunks.map((c) => c.type)).toEqual([
      'tool_call',
      'tool_result',
      'text',
      'done',
    ]);
  });

  it('(vex-viii) an irreversible plan step falls back to its own card', async () => {
    executeTool.mockRejectedValue(
      new VendixHttpException(ErrorCodes.AI_AGENT_005, 'requiere confirmación', {
        tool: 'send_invoice_dian',
        arguments: { id: 1 },
        preview: { target: 'factura' },
        confirmation_token: 'tok-9',
      } as any),
    );
    chat.mockResolvedValueOnce(
      ok({ tool_calls: [call('c1', 'send_invoice_dian', { id: 1 })] }),
    );

    const { chunks, result } = await drain({
      plan_approval: {
        token: 'plan-tok',
        plan_id: 'plan-1',
        redeem: jest.fn().mockResolvedValue('irreversible'),
        issueSingleUse: jest.fn(),
      },
    });

    expect(result.pending_confirmation).toMatchObject({
      tool: 'send_invoice_dian',
      confirmation_token: 'tok-9',
    });
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'plan_approval',
        plan_approval: expect.objectContaining({ plan_id: 'plan-1' }),
      }),
    );
    // The step never executed: only the proposing call happened.
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  function definitionsFor(scopes: string[]) {
    return registry.getAvailableDefinitions(scopes);
  }

  function agentScopeRegistry() {
    registry.getAgentDefinitions = jest.fn(
      (scopes: string[], agentScope: any) =>
        definitionsFor(scopes).filter(
          (tool) =>
            !(agentScope?.denied_tools ?? []).includes(tool.function.name),
        ),
    );
  }

  it('(rx2-a) vex turn calling denied ui_navigate is rejected before dispatch, execute or quota', async () => {
    agentScopeRegistry();
    configureStorePlan(['*']);
    chat
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('c1', 'ui_navigate', { module: 'pos' })] }),
      )
      .mockResolvedValueOnce(ok({ content: 'entendido' }));

    const { chunks, result } = await drain({
      agent_key: 'vex',
      agent_denied_tools: ['ui_navigate'],
      stream_id: 's1',
    });

    // Zero execution surface: no server run, no browser dispatch, no quota.
    expect(executeTool).not.toHaveBeenCalled();
    expect(awaitResult).not.toHaveBeenCalled();
    expect(consumeAIQuota).not.toHaveBeenCalled();
    expect(result.tools_used).toEqual([]);
    // La guarda corre ANTES del frame `tool_call` (Vexi lo ejecutaría en el
    // navegador) y antes de `ai.agent.tool_executed`.
    expect(chunks.map((c) => c.type)).toEqual(['tool_result', 'text', 'done']);
    expect(chunks.some((c) => c.type === 'tool_call')).toBe(false);
    expect(emit).not.toHaveBeenCalledWith(
      'ai.agent.tool_executed',
      expect.anything(),
    );
    const toolResult = chunks[0] as any;
    expect(toolResult.tool.failed).toBe(true);
    expect(toolResult.tool.summary).toContain('AI_AGENT_TOOL_NOT_ALLOWED');
    // The rejection goes back as a tool message so the model self-corrects.
    const followUp = chat.mock.calls[1][0];
    const toolMsg = [...followUp].reverse().find((m: any) => m.role === 'tool');
    expect(JSON.parse(toolMsg.content).error_code).toBe(
      'AI_AGENT_TOOL_NOT_ALLOWED',
    );
  });

  it('(rx2-a2) hallucinated tool name is rejected without reaching executeTool', async () => {
    chat
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('c1', 'invented_tool', {})] }),
      )
      .mockResolvedValueOnce(ok({ content: 'ok' }));

    const { chunks, result } = await drain({});

    expect(executeTool).not.toHaveBeenCalled();
    expect(result.tools_used).toEqual([]);
    expect(chunks.map((c) => c.type)).toEqual(['tool_result', 'text', 'done']);
    expect(chunks.some((c) => c.type === 'tool_call')).toBe(false);
    expect(emit).not.toHaveBeenCalledWith(
      'ai.agent.tool_executed',
      expect.anything(),
    );
    expect((chunks[0] as any).tool.summary).toContain(
      'AI_AGENT_TOOL_NOT_ALLOWED',
    );
  });

  it('(rx2-b) planned budget is min(row + headroom, 60), not a fixed max', async () => {
    const openPlan: AgentPlanHook = {
      execute: jest.fn(),
      snapshot: jest
        .fn()
        .mockResolvedValue(makePlan({ steps: [step(1, 'pending')] })),
    };
    const firstBudget = () =>
      emit.mock.calls.find((c: any[]) => c[0] === 'ai.agent.iteration')?.[1]
        ?.max_iterations;

    chat.mockResolvedValue(ok({ content: 'listo' }));
    await drain({ agent_key: 'vex', max_iterations: 20, plan: openPlan });
    expect(firstBudget()).toBe(40);

    emit.mockClear();
    await drain({ agent_key: 'vex', max_iterations: 50, plan: openPlan });
    expect(firstBudget()).toBe(60);

    // No row value: the historical fixed widening is unchanged.
    emit.mockClear();
    await drain({ agent_key: 'vex', plan: openPlan });
    expect(firstBudget()).toBe(60);

    emit.mockClear();
    await drain({ plan: openPlan });
    expect(firstBudget()).toBe(25);
  });

  it('(rx2-b2) explicit row max_iterations=40 runs 40 iterations without a plan', async () => {
    chat.mockImplementation((_msgs: any, opts: any) =>
      opts && Object.keys(opts).length === 0
        ? ok({ content: 'cierre' })
        : ok({ tool_calls: [call(`c${chat.mock.calls.length}`, 'list_things')] }),
    );

    await drain({ agent_key: 'vex', max_iterations: 40 });

    expect(chat).toHaveBeenCalledTimes(41);
  });

  it('(rx2-c) vex turn meters vex_agent, vexi keeps tool_agents', async () => {
    configureStorePlan(['*']);
    chat
      .mockResolvedValueOnce(ok({ tool_calls: [call('c1', 'list_orders')] }))
      .mockResolvedValueOnce(ok({ content: 'listo' }));

    await drain({ agent_key: 'vex' });

    expect(canUseAIFeature).toHaveBeenCalledWith(42, 'vex_agent');
    expect(getAIFeatureConfig).toHaveBeenCalledWith(42, 'vex_agent');
    expect(consumeAIQuota).toHaveBeenCalledWith(
      42,
      'vex_agent',
      1,
      expect.any(String),
    );
    expect(canUseAIFeature).not.toHaveBeenCalledWith(42, 'tool_agents');
    expect(consumeAIQuota).not.toHaveBeenCalledWith(
      42,
      'tool_agents',
      expect.anything(),
      expect.anything(),
    );

    // Control leg: no agent identity → historical key.
    canUseAIFeature.mockClear();
    getAIFeatureConfig.mockClear();
    consumeAIQuota.mockClear();
    chat
      .mockResolvedValueOnce(ok({ tool_calls: [call('c2', 'list_orders')] }))
      .mockResolvedValueOnce(ok({ content: 'listo' }));

    await drain({});

    expect(canUseAIFeature).toHaveBeenCalledWith(42, 'tool_agents');
    expect(consumeAIQuota).toHaveBeenCalledWith(
      42,
      'tool_agents',
      1,
      expect.any(String),
    );
  });

  it('(rx2-d) exhausted monthly quota denies the catalog and executes nothing', async () => {
    configureStorePlan(['*']);
    canUseAIFeature.mockResolvedValue({
      allowed: false,
      reason: 'SUBSCRIPTION_006',
    });

    await drain({ agent_key: 'vex' });

    expect(offeredToolNames()).toEqual([]);
    expect(executeTool).not.toHaveBeenCalled();
    expect(consumeAIQuota).not.toHaveBeenCalled();
  });

  it('(rx2-e) vex daily_messages cap exhausted with degradation block stops the turn before the provider', async () => {
    configureStorePlan(['*']);
    checkExtraQuota.mockImplementation(async (_s: number, _f: string, c: string) =>
      c === 'daily_messages'
        ? { exceeded: true, cap: 5, used: 5, degradation: 'block' }
        : { exceeded: false, cap: null, used: 0, degradation: 'block' },
    );

    await expect(drain({ agent_key: 'vex' })).rejects.toMatchObject({
      errorCode: 'SUBSCRIPTION_006',
    });
    expect(chat).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
    expect(consumeExtraQuota).not.toHaveBeenCalled();
  });

  it('(rx2-f) vex turn consumes one daily message and the turn tokens; vexi does not touch vex caps', async () => {
    configureStorePlan(['*']);
    chat.mockResolvedValueOnce(ok({ content: 'listo' }));
    await drain({ agent_key: 'vex' });
    expect(consumeExtraQuota).toHaveBeenCalledWith(
      42,
      'vex_agent',
      'daily_messages',
      1,
      expect.any(String),
    );
    expect(consumeExtraQuota).toHaveBeenCalledWith(
      42,
      'vex_agent',
      'monthly_tokens',
      expect.any(Number),
      expect.any(String),
    );

    checkExtraQuota.mockClear();
    consumeExtraQuota.mockClear();
    chat.mockResolvedValueOnce(ok({ content: 'listo' }));
    await drain({});
    expect(checkExtraQuota).not.toHaveBeenCalled();
    expect(consumeExtraQuota).not.toHaveBeenCalled();
  });

  it('(rx3-a) vex proposing turn accumulates 3 writes into ONE plan_approval frame', async () => {
    const proposal = (tool: string, args: any, token: string, preview: any) =>
      new VendixHttpException(
        ErrorCodes.AI_AGENT_005,
        'requiere confirmación',
        { tool, arguments: args, preview, confirmation_token: token } as any,
      );
    executeTool
      .mockRejectedValueOnce(
        proposal('create_expense', { total: 5 }, 'tok-1', {
          target: 'gasto 5',
        }),
      )
      .mockRejectedValueOnce(
        proposal('create_expense', { total: 9 }, 'tok-2', {
          target: 'gasto 9',
        }),
      )
      .mockRejectedValueOnce(
        proposal('send_invoice_dian', { id: 1 }, 'tok-3', {
          target: 'factura 1',
        }),
      );
    chat
      .mockResolvedValueOnce(
        ok({
          tool_calls: [
            call('c1', 'create_expense', { total: 5 }),
            call('c2', 'create_expense', { total: 9 }),
            call('c3', 'send_invoice_dian', { id: 1 }),
          ],
        }),
      )
      .mockResolvedValueOnce(ok({ content: 'listo, tres pasos' }));

    const classifyProposedSteps = jest.fn((steps: any[]) => ({
      covered: steps.filter((s) => s.tool !== 'send_invoice_dian'),
      reconfirm: steps.filter((s) => s.tool === 'send_invoice_dian'),
    }));
    const saveProposedSteps = jest.fn().mockResolvedValue(undefined);
    const plan: AgentPlanHook = {
      execute: jest.fn(),
      snapshot: jest.fn().mockResolvedValue(makePlan({ id: 'plan-9' })),
    };

    const { chunks, result } = await drain({
      agent_key: 'vex',
      plan,
      plan_approval: {
        redeem: jest.fn(),
        issueSingleUse: jest.fn(),
        classifyProposedSteps,
        saveProposedSteps,
      },
    });

    // Exactly ONE plan frame for the three writes — never one card per write.
    const approvals = chunks.filter((c) => c.type === 'plan_approval');
    expect(approvals).toHaveLength(1);
    const frame = approvals[0].plan_approval!;
    expect(frame.plan_id).toBe('plan-9');
    expect(frame.steps).toHaveLength(3);
    expect(frame.steps!.map((s) => [s.step_id, s.tool, s.irreversible])).toEqual(
      [
        ['s1', 'create_expense', false],
        ['s2', 'create_expense', false],
        ['s3', 'send_invoice_dian', true],
      ],
    );
    expect(frame.steps![0].arguments).toEqual({ total: 5 });
    expect(frame.covered_steps).toEqual([1, 2]);
    expect(frame.reconfirm_steps).toEqual([3]);
    // Server hashes persisted for approve-time verification (never the
    // client's re-declaration).
    expect(saveProposedSteps).toHaveBeenCalledWith([
      { order: 1, tool: 'create_expense', args: { total: 5 } },
      { order: 2, tool: 'create_expense', args: { total: 9 } },
      { order: 3, tool: 'send_invoice_dian', args: { id: 1 } },
    ]);
    expect(classifyProposedSteps).toHaveBeenCalled();
    // The turn closes with the plan receipt — no single-step card.
    expect(result.pending_plan?.plan_id).toBe('plan-9');
    expect(result.pending_plan?.steps).toHaveLength(3);
    expect(result.pending_confirmation).toBeUndefined();
    expect(chunks.map((c) => c.type)).toEqual([
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'plan_approval',
      'text',
      'done',
    ]);
  });

  it('(rx3-a2) vex accumulation classifies locally without hook methods', async () => {
    executeTool
      .mockRejectedValueOnce(
        new VendixHttpException(
          ErrorCodes.AI_AGENT_005,
          'requiere confirmación',
          {
            tool: 'create_expense',
            arguments: { total: 5 },
            preview: { target: 'gasto' },
            confirmation_token: 'tok-1',
          } as any,
        ),
      )
      .mockRejectedValueOnce(
        new VendixHttpException(
          ErrorCodes.AI_AGENT_005,
          'requiere confirmación',
          {
            tool: 'send_invoice_dian',
            arguments: { id: 1 },
            preview: { target: 'factura' },
            confirmation_token: 'tok-2',
          } as any,
        ),
      );
    chat
      .mockResolvedValueOnce(
        ok({
          tool_calls: [
            call('c1', 'create_expense', { total: 5 }),
            call('c2', 'send_invoice_dian', { id: 1 }),
          ],
        }),
      )
      .mockResolvedValueOnce(ok({ content: 'listo' }));
    const plan: AgentPlanHook = {
      execute: jest.fn(),
      snapshot: jest.fn().mockResolvedValue(makePlan({ id: 'p-local' })),
    };

    // No plan_approval hook at all: the domain net still flags DIAN.
    const { chunks, result } = await drain({ agent_key: 'vex', plan });

    const approvals = chunks.filter((c) => c.type === 'plan_approval');
    expect(approvals).toHaveLength(1);
    expect(approvals[0].plan_approval!.plan_id).toBe('p-local');
    expect(
      approvals[0].plan_approval!.steps!.map((s) => s.irreversible),
    ).toEqual([false, true]);
    expect(result.pending_plan?.steps).toHaveLength(2);
    expect(result.pending_confirmation).toBeUndefined();
  });

  it('(rx3-b) 9000-char vex result keeps a real block_id', async () => {
    const save = jest.fn().mockResolvedValue('block-7');
    const raw = 'z'.repeat(9000);
    executeTool.mockResolvedValueOnce(raw);
    chat
      .mockResolvedValueOnce(ok({ tool_calls: [call('c1', 'list_things')] }))
      .mockResolvedValueOnce(ok({ content: 'listo' }));

    const { result } = await drain({
      agent_key: 'vex',
      block_sink: { save },
      conversation_id: 7,
    });

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: 7, kind: 'markdown' }),
    );
    const stored = JSON.parse(result.tools_used[0].result);
    expect(stored.truncated).toBe(true);
    expect(stored.block_id).toBe('block-7');
  });

  it.each([[undefined], ['vexi']])(
    '(rx3-c) non-vex turns never compact (agent_key=%s)',
    async (agentKey) => {
      const save = jest.fn().mockResolvedValue('block-x');
      const raw = 'z'.repeat(9000);
      executeTool.mockResolvedValueOnce(raw);
      chat
        .mockResolvedValueOnce(ok({ tool_calls: [call('c1', 'list_things')] }))
        .mockResolvedValueOnce(ok({ content: 'listo' }));

      const { result } = await drain({
        ...(agentKey ? { agent_key: agentKey } : {}),
        block_sink: { save },
        conversation_id: 7,
      });

      expect(result.tools_used[0].result).toBe(raw);
      expect(result.tools_used[0].result).toHaveLength(9000);
      expect(save).not.toHaveBeenCalled();
    },
  );
});
