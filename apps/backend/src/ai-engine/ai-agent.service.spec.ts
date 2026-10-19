import {
  normalizeToolException,
  normalizeToolResult,
} from './tools/tool-result.normalizer';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { AIAgentService } from './ai-agent.service';
import { AgentTraceService } from './observability/agent-trace.service';
import { RequestContextService } from '../common/context/request-context.service';
import { AgentPlan, AgentPlanHook } from './interfaces/agent-plan.interface';
import { AIStreamChunk } from './interfaces/ai-provider.interface';
import { ErrorCodes, VendixHttpException } from '../common/errors';
import { INTERNAL_JARGON, USER_NOTICES } from './agent-execution.contract';

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
      matchesScope: (n: string, scopes: Set<string>) =>
        !!domains[n] && (scopes.has(n) || scopes.has(domains[n])),
      get: (n: string) =>
        domains[n] ? { name: n, domain: domains[n] } : undefined,
      getDeprecation: () => undefined,
      isClientSide: (n: string) => n.startsWith('ui_'),
      executeTool,
      executeToolResult: async (name, args, options) => {
        try {
          return normalizeToolResult(
            options?.confirmationToken
              ? await executeTool(name, args, {
                  confirmationToken: options.confirmationToken,
                })
              : await executeTool(name, args),
          );
        } catch (error) {
          if (
            error instanceof VendixHttpException &&
            (error.getResponse() as any).error_code === 'AI_AGENT_005'
          )
            throw error;
          return normalizeToolException(error);
        }
      },
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
    chat.mockResolvedValue(
      ok({ content: 'ells'.repeat(1000), model: 'free-x' }),
    );
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
    configureStorePlan(
      ['orders'],
      ['store:orders:read', 'store:customers:read'],
    );

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

  it('(v-b) timeout without a plan closes without a post-deadline provider call', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => {
      now += 100_000;
      return now;
    });
    chat.mockResolvedValueOnce(ok({ content: 'Esto encontré' }));

    const { chunks, result } = await drain({});

    expect(chunks.map((c) => c.type)).toEqual(['text', 'done']);
    expect(result.success).toBe(true);
    expect(result.execution?.outcome).toBe('partial');
    expect(chat).not.toHaveBeenCalled();
  });

  it.each(['vexi', 'vex'])(
    'does not infer a closing response after %s uses its last clock budget',
    async (agentKey) => {
      let now = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      executeTool.mockImplementation(async () => {
        now = 1000;
        return '{"verified":true}';
      });
      chat.mockResolvedValue(ok({ tool_calls: [call('r1', 'list_things')] }));
      const { result } = await drain({
        agent_key: agentKey,
        max_iterations: 1,
        timeout_ms: 1000,
      });
      expect(chat).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(result.execution?.outcome).toBe('partial');
      expect(result.total_tokens).toBe(10);
    },
  );

  it.each([['orders'], ['fetch_orders'], ['list_orders']])(
    'real registry keeps requested scope %s through agent and caller filters',
    async (requested) => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        permissions: ['store:orders:read'],
        roles: [],
      } as any);
      const real = new AIToolRegistry({} as any);
      const readOrders = jest.fn().mockResolvedValue('{"orders":[42]}');
      real.register({
        name: 'list_orders',
        domain: 'orders',
        readOnly: true,
        requiredPermissions: ['store:orders:read'],
        description: 'Órdenes',
        parameters: { type: 'object' },
        handler: readOrders,
      });
      real.register({
        name: 'list_private',
        domain: 'orders',
        readOnly: true,
        requiredPermissions: ['private:read'],
        description: 'Privado',
        parameters: { type: 'object' },
        handler: jest.fn(),
      });
      real.registerAlias('fetch_orders', 'list_orders');
      (service as any).toolRegistry = real;
      chat
        .mockResolvedValueOnce(ok({ tool_calls: [call('r1', 'list_orders')] }))
        .mockResolvedValueOnce(ok({ content: 'Orden 42' }));
      const { result } = await drain({
        agent_allowed_tools: ['orders'],
        tools: [requested],
      });
      expect(
        chat.mock.calls[0][1].tools.map((t: any) => t.function.name),
      ).toEqual(['list_orders']);
      expect(readOrders).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Orden 42');
    },
  );

  it('domain narrowing cannot resurrect a denied tool or dispatch a hallucinated call', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      permissions: ['store:orders:read'],
      roles: [],
    } as any);
    const real = new AIToolRegistry({} as any);
    const handler = jest.fn();
    real.register({
      name: 'list_orders',
      domain: 'orders',
      readOnly: true,
      requiredPermissions: ['store:orders:read'],
      description: 'Órdenes',
      parameters: { type: 'object' },
      handler,
    });
    real.registerAlias('fetch_orders', 'list_orders');
    (service as any).toolRegistry = real;
    chat
      .mockResolvedValueOnce(ok({ tool_calls: [call('r1', 'fetch_orders')] }))
      .mockResolvedValueOnce(ok({ content: 'No autorizado' }));
    const { chunks } = await drain({
      tools: ['orders'],
      agent_allowed_tools: ['orders'],
      agent_denied_tools: ['fetch_orders'],
    });
    expect(chat.mock.calls[0][1].tools).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    // The trace row is user-facing: human text, never the internal code.
    expect(chunks.find((c) => c.type === 'tool_result')?.tool?.summary).toBe(
      'Sin acceso con tu usuario o plan actual.',
    );
    expect(consumeAIQuota).not.toHaveBeenCalled();
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

    expect(result.execution?.outcome).toBe('partial');
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('(vi) shouldAbort true returns aborted without emitting anything', async () => {
    const { chunks, result } = await drain({
      shouldAbort: jest.fn().mockResolvedValue(true),
    });
    expect(chunks).toEqual([]);
    expect(result).toMatchObject({
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
        : ok({
            tool_calls: [call(`c${chat.mock.calls.length}`, 'list_things')],
          }),
    );

    await drain({ agent_key: 'vex' });
    // 40 tool iterations + 1 closing turn without tools.
    expect(chat).toHaveBeenCalledTimes(40);

    chat.mockClear();
    await drain({});
    expect(chat).toHaveBeenCalledTimes(10);
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
    expect(stored.data).toEqual(rows);
    expect(result.tools_used[0].result.length).toBeGreaterThan(7000);
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
    expect(JSON.parse(result.tools_used[0].result).data.block_id).toBe(
      'block-1',
    );
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
      plan_approval: {
        token: 'plan-tok',
        plan_id: 'plan-1',
        redeem,
        issueSingleUse,
      },
    });

    expect(redeem).toHaveBeenCalledWith('create_expense', { total: 5 });
    expect(issueSingleUse).toHaveBeenCalledWith('create_expense', { total: 5 });
    expect(executeTool).toHaveBeenNthCalledWith(
      2,
      'create_expense',
      { total: 5 },
      {
        confirmationToken: 'su-1',
      },
    );
    expect(result.pending_confirmation).toBeUndefined();
    expect(result.execution?.outcome).not.toBe('completed_verified');
    expect(chunks.map((c) => c.type)).toEqual([
      'tool_call',
      'tool_result',
      'text',
      'done',
    ]);
  });

  it('(vex-viii) an irreversible plan step falls back to its own card', async () => {
    executeTool.mockRejectedValue(
      new VendixHttpException(
        ErrorCodes.AI_AGENT_005,
        'requiere confirmación',
        {
          tool: 'send_invoice_dian',
          arguments: { id: 1 },
          preview: { target: 'factura' },
          confirmation_token: 'tok-9',
        } as any,
      ),
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
    expect(toolResult.tool.summary).toBe(
      'Sin acceso con tu usuario o plan actual.',
    );
    expect(chat).toHaveBeenCalledTimes(1); // permission blocks halt rather than re-infer.
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
    expect((chunks[0] as any).tool.summary).not.toMatch(INTERNAL_JARGON);
    expect((chunks[0] as any).tool.failed).toBe(true);
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
        : ok({
            tool_calls: [call(`c${chat.mock.calls.length}`, 'list_things')],
          }),
    );

    await drain({ agent_key: 'vex', max_iterations: 40 });

    expect(chat).toHaveBeenCalledTimes(40);
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
    checkExtraQuota.mockImplementation(
      async (_s: number, _f: string, c: string) =>
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

  it('(rx3-a) vex proposing turn with 3 writes in one iteration proposes ONLY the first as a 1-step plan_approval', async () => {
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

    // ONE frame, ONE step: only the first write is proposed; the rest are
    // deferred (neutral tool_result) so the model re-proposes them after the
    // first approval.
    const approvals = chunks.filter((c) => c.type === 'plan_approval');
    expect(approvals).toHaveLength(1);
    const frame = approvals[0].plan_approval!;
    expect(frame.plan_id).toBe('plan-9');
    expect(frame.steps).toHaveLength(1);
    expect(
      frame.steps!.map((s) => [s.step_id, s.tool, s.irreversible]),
    ).toEqual([['s1', 'create_expense', false]]);
    expect(frame.steps![0].arguments).toEqual({ total: 5 });
    expect(frame.covered_steps).toEqual([1]);
    expect(frame.reconfirm_steps).toEqual([]);
    expect(saveProposedSteps).toHaveBeenCalledWith([
      { order: 1, tool: 'create_expense', args: { total: 5 } },
    ]);
    expect(classifyProposedSteps).toHaveBeenCalled();
    expect(result.pending_plan?.plan_id).toBe('plan-9');
    expect(result.pending_plan?.steps).toHaveLength(1);
    expect(result.pending_confirmation).toBeUndefined();
    // The deferred writes answer neutrally and never become steps.
    const deferred = chunks.filter(
      (c) =>
        c.type === 'tool_result' && c.tool?.summary?.startsWith('Pendiente'),
    );
    expect(deferred).toHaveLength(2);
    // The turn pauses on the approval: no second provider call.
    expect(chat).toHaveBeenCalledTimes(1);
    // The narration is a single-action ask, never "plan con N pasos".
    const text = chunks.find((c) => c.type === 'text')!.content!;
    expect(text).toContain('Necesito tu aprobación');
    expect(text).not.toContain('plan');
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
            tool: 'send_invoice_dian',
            arguments: { id: 1 },
            preview: { target: 'factura' },
            confirmation_token: 'tok-2',
          } as any,
        ),
      )
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
      );
    chat
      .mockResolvedValueOnce(
        ok({
          tool_calls: [
            call('c1', 'send_invoice_dian', { id: 1 }),
            call('c2', 'create_expense', { total: 5 }),
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
    ).toEqual([true]);
    expect(result.pending_plan?.steps).toHaveLength(1);
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
    expect(stored.data.truncated).toBe(true);
    expect(stored.data.block_id).toBe('block-7');
  });

  it.each([[undefined], ['vexi']])(
    'all surfaces compact only after persistence (agent_key=%s)',
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

      expect(JSON.parse(result.tools_used[0].result).data.block_id).toBe(
        'block-x',
      );
      expect(result.tools_used[0].result.length).toBeLessThan(6000);
      expect(save).toHaveBeenCalled();
    },
  );

  describe('fase A: observability without behavior or metering changes', () => {
    let trace: AgentTraceService;
    let rows: Map<string, Record<string, any>>;
    let priorFlag: string | undefined;

    beforeEach(() => {
      rows = new Map();
      trace = new AgentTraceService({
        ai_agent_trace_spans: {
          upsert: jest.fn(async ({ create }: any) => {
            rows.set(create.span_id, create);
            return create;
          }),
        },
      } as any);
      (service as any).trace = trace;
    });

    afterEach(async () => {
      await trace.flush();
    });

    const auth = {
      organization_id: 101,
      store_id: 201,
      user_id: 301,
      is_owner: true,
      is_super_admin: false,
      permissions: ['p'],
      request_id: 'external-not-a-uuid',
    };
    const byKind = (kind: string) =>
      [...rows.values()].filter((row) => row.kind === kind);
    const traced = (params: any = {}) =>
      RequestContextService.runIsolated(auth, () => drain(params));

    it('counts empty retries and closing inference separately from one iteration', async () => {
      chat
        .mockResolvedValueOnce({ success: true, content: '' })
        .mockResolvedValueOnce(
          ok({ tool_calls: [call('external-call-1', 'list_things')] }),
        )
        .mockResolvedValueOnce(ok({ content: 'Cierre sin verificar' }));
      const { result } = await traced({ max_iterations: 1 });
      await trace.flush();
      expect(chat).toHaveBeenCalledTimes(2);
      expect(result.iterations).toBe(1);
      expect(byKind('provider_retry')).toHaveLength(1);
      expect(byKind('closing_inference')).toHaveLength(0);
      expect(byKind('tool')).toHaveLength(1);
      expect(byKind('context')[0].attributes).toEqual(
        expect.objectContaining({
          tool_count: expect.any(Number),
          catalog_hash: expect.any(String),
          definition_tokens: null,
          context_tokens: null,
        }),
      );
      expect(byKind('root')[0].outcome).toBe('partial');
      expect([...rows.values()].every((row) => row.ended_at)).toBe(true);
    });

    it('a write proposal is awaiting approval, never completed_verified', async () => {
      chat.mockResolvedValueOnce(
        ok({ tool_calls: [call('proposal-1', 'create_expense')] }),
      );
      executeTool.mockRejectedValueOnce(
        new VendixHttpException(ErrorCodes.AI_AGENT_005, undefined, {
          confirmation_token: 'SECRET_CONFIRMATION_TOKEN',
          preview: { title: 'Datos privados' },
        }),
      );
      const { result } = await traced();
      await trace.flush();
      expect(result.pending_confirmation).toBeDefined();
      expect(byKind('root')[0].outcome).toBe('awaiting_approval');
      expect(byKind('approval_wait')).toHaveLength(1);
      expect(byKind('tool')[0].outcome).toBe('awaiting_approval');
      expect(JSON.stringify([...rows.values()])).not.toMatch(
        /SECRET_CONFIRMATION_TOKEN|Datos privados/,
      );
      expect(consumeAIQuota).not.toHaveBeenCalled();
    });

    it('consumer cancellation closes tool and root without another provider call', async () => {
      chat.mockResolvedValueOnce(
        ok({ tool_calls: [call('c1', 'list_things')] }),
      );
      await RequestContextService.runIsolated(auth, async () => {
        const generator = service.runAgentStream({ goal: 'hola' });
        const first = await generator.next();
        expect(first.value).toMatchObject({ type: 'tool_call' });
        await generator.return(undefined as never);
      });
      await trace.flush();
      expect(chat).toHaveBeenCalledTimes(1);
      expect(executeTool).not.toHaveBeenCalled();
      expect(byKind('root')[0].outcome).toBe('cancelled');
      expect([...rows.values()].every((row) => row.ended_at)).toBe(true);
      expect(trace.getHealth().active_spans).toBe(0);
    });

    it('no authenticated ALS means no trace, even with a stale getContext fallback', async () => {
      chat.mockResolvedValueOnce(ok({ content: 'respuesta' }));
      await drain({});
      await trace.flush();
      expect(rows.size).toBe(0);
    });

    it('a failed UI wait closes its wait/tool spans as errors and does not expose error bodies in telemetry', async () => {
      chat.mockResolvedValueOnce(ok({ tool_calls: [call('ui-1', 'ui_go')] }));
      awaitResult.mockRejectedValueOnce(new Error('Bearer PRIVATE_UI_ERROR'));
      const errorLog = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);
      const { result } = await traced({ stream_id: 'stream-1' });
      await trace.flush();
      expect(result.success).toBe(false);
      expect(byKind('root')[0].outcome).toBe('failed');
      expect(byKind('ui_wait')[0].status).toBe('error');
      expect(byKind('tool')[0].status).toBe('error');
      expect(JSON.stringify([...rows.values()])).not.toContain(
        'PRIVATE_UI_ERROR',
      );
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        'PRIVATE_UI_ERROR',
      );
    });

    it('ask_user is awaiting input and sync run drains the same traced generator', async () => {
      chat.mockResolvedValueOnce(
        ok({ tool_calls: [call('ask-1', 'ask_user')] }),
      );
      const result = await RequestContextService.runIsolated(auth, () =>
        service.runAgent({
          goal: 'consulta incompleta',
          plan: {
            snapshot: async () => null,
            execute: async () => ({
              result: '{}',
              endTurn: { text: '¿Cuál proveedor?' },
            }),
          },
        }),
      );
      await trace.flush();
      expect(result.content).toBe('¿Cuál proveedor?');
      expect(byKind('root')[0].outcome).toBe('awaiting_input');
      expect(byKind('tool')[0].outcome).toBe('awaiting_input');
      expect(executeTool).not.toHaveBeenCalled();
    });

    it('observing a successful tool does not replace or duplicate tool quota IDs', async () => {
      jest.mocked(RequestContextService.getContext).mockReturnValue(auth);
      canUseAIFeature.mockResolvedValue({ allowed: true });
      getAIFeatureConfig.mockResolvedValue({});
      chat
        .mockResolvedValueOnce(
          ok({ tool_calls: [call('original-tool-id', 'list_things')] }),
        )
        .mockResolvedValueOnce(ok({ content: 'respuesta' }));
      await traced();
      await trace.flush();
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(consumeAIQuota).toHaveBeenCalledTimes(1);
      const args = consumeAIQuota.mock.calls[0];
      expect(JSON.stringify(args)).toContain('original-tool-id');
      expect(JSON.stringify(args)).not.toContain(byKind('root')[0].trace_id);
    });
  });
  describe('D0 opt-in semantic outcomes', () => {
    beforeEach(() => {
      registry.executeToolResult = jest.fn(async (name, args, options) =>
        normalizeToolResult(await executeTool(name, args), {
          evidenceRef: options.evidenceRef,
          write: name === 'create_expense',
        }),
      );
    });

    it('resolved business errors are partial, not quota success, and identical retries never execute', async () => {
      configureStorePlan(['list_things']);
      executeTool.mockResolvedValue(
        '{"error":"no encontrado","error_code":"NOT_FOUND","next_step":"Indica otro documento o confirma si deseas crear uno."}',
      );
      chat
        .mockResolvedValueOnce(
          ok({ tool_calls: [call('t1', 'list_things', { id: 1 })] }),
        )
        .mockResolvedValueOnce(
          ok({ tool_calls: [call('t2', 'list_things', { id: 1 })] }),
        )
        .mockResolvedValueOnce(ok({ content: 'No encontré ese documento.' }));
      const { chunks, result } = await drain({});
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(consumeAIQuota).not.toHaveBeenCalled();
      expect(result.execution).toMatchObject({ outcome: 'partial' });
      // Read turn: the model's own answer is never replaced (hotfix Vexi).
      expect(result.content).toBe('No encontré ese documento.');
      expect(result.execution?.next_action).toContain('otro documento');
      // P0-14: next_action is for the model; the done frame carries the
      // summary without it (the AgentResult keeps it for the runtime).
      const { next_action: _internal, ...clientExecution } = result.execution!;
      expect(chunks.find((c) => c.type === 'done')?.execution).toEqual(
        clientExecution,
      );
      expect(
        chunks
          .filter((c) => c.type === 'tool_result')
          .every((c) => c.tool?.execution?.status === 'recoverable_error'),
      ).toBe(true);
    });
    it('allows one changed argument correction; successful read counts once with the original dedup ID', async () => {
      configureStorePlan(['list_things']);
      executeTool
        .mockResolvedValueOnce(
          '{"error":"id","error_code":"INVALID_ARGS","next_step":"Corrige el id."}',
        )
        .mockResolvedValueOnce('{"id":"O-QA1"}');
      chat
        .mockResolvedValueOnce(
          ok({ tool_calls: [call('bad', 'list_things', { id: 0 })] }),
        )
        .mockResolvedValueOnce(
          ok({ tool_calls: [call('fixed', 'list_things', { id: 1 })] }),
        )
        .mockResolvedValueOnce(ok({ content: 'Encontré O-QA1' }));
      const { result } = await drain({});
      expect(executeTool).toHaveBeenCalledTimes(2);
      expect(consumeAIQuota).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(consumeAIQuota.mock.calls)).toContain(
        ':tool:fixed',
      );
      expect(result.execution?.resource_ids).toEqual({ id: 'O-QA1' });
      expect(result.execution?.outcome).toBe('partial');
    });
    it('clock exhaustion never starts a closing inference and emits useful partial outcome', async () => {
      let now = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      chat.mockImplementation(async () => {
        now = 2000;
        return ok({ tool_calls: [call('t1', 'list_things')] });
      });
      executeTool.mockResolvedValue('{"id":"O-QA1"}');
      const { chunks, result } = await drain({
        timeout_ms: 1000,
        max_iterations: 1,
      });
      expect(chat).toHaveBeenCalledTimes(1);
      expect(result.execution?.outcome).toBe('partial');
      // Human partial-progress line; raw record ids never reach the chat.
      expect(result.content).toContain('Alcancé a consultar');
      expect(result.content).not.toContain('O-QA1');
      expect(result.content).not.toMatch(
        /reformula|otras palabras|otra forma/i,
      );
      expect(chunks.filter((c) => c.type === 'done')).toHaveLength(1);
    });
    it('iteration exhaustion uses no closing inference even with time left', async () => {
      chat.mockResolvedValue(ok({ tool_calls: [call('t1', 'list_things')] }));
      const { result } = await drain({ max_iterations: 1 });
      expect(chat).toHaveBeenCalledTimes(1);
      expect(result.execution?.next_action).toBeTruthy();
    });
    it('unknown write halts the batch and plan continuation, without retry or successful tool quota', async () => {
      configureStorePlan(['create_expense', 'list_things']);
      registry.executeToolResult.mockResolvedValue(
        normalizeToolException(
          { code: 'ETIMEDOUT' },
          { write: true, handlerStarted: true },
        ),
      );
      const hook = {
        snapshot: jest.fn().mockResolvedValue(makePlan()),
        execute: jest.fn(),
      };
      chat.mockResolvedValue(
        ok({
          tool_calls: [call('t1', 'create_expense'), call('t2', 'list_things')],
        }),
      );
      const { chunks, result } = await drain({ plan: hook });
      expect(chat).toHaveBeenCalledTimes(1);
      expect(registry.executeToolResult).toHaveBeenCalledTimes(1);
      expect(consumeAIQuota).not.toHaveBeenCalled();
      expect(chunks.some((c) => c.type === 'plan_continue')).toBe(false);
      expect(result.execution?.outcome).toBe('unknown_effect');
      expect(result.content).toContain('No repetiré');
    });
    it('not-offered UI is blocked before dispatch, with an alternative and terminal metadata', async () => {
      configureStorePlan(['list_things']);
      chat.mockResolvedValue(ok({ tool_calls: [call('t1', 'ui_navigate')] }));
      const { chunks, result } = await drain({});
      expect(result.execution?.outcome).toBe('blocked');
      expect(result.content).toContain('administrador');
      expect(chunks.some((c) => c.type === 'tool_call')).toBe(false);
      expect(awaitResult).not.toHaveBeenCalled();
    });
    it('UI user input is not an error or tool success and is never optimistically narrated', async () => {
      chat.mockResolvedValue(ok({ tool_calls: [call('t1', 'ui_go')] }));
      awaitResult.mockResolvedValue(
        '{"status":"needs_user_input","next_action":"¿Cuál variante deseas?"}',
      );
      const { chunks, result } = await drain({ stream_id: 's1' });
      expect(result.execution?.outcome).toBe('needs_user_input');
      // B1: the receipt's next_action is written for the model; the person
      // reads the catalog line (the model asks in its own words).
      expect(result.content).toContain(USER_NOTICES.needs_user_input);
      expect(result.content).not.toContain('¿Cuál variante deseas?');
      expect(chunks.find((c) => c.type === 'tool_result')?.tool?.failed).toBe(
        false,
      );
      expect(consumeAIQuota).not.toHaveBeenCalled();
    });
    it('sync shares the same semantic result as SSE', async () => {
      executeTool.mockResolvedValue('{"result_unknown":true}');
      chat.mockResolvedValue(ok({ tool_calls: [call('t1', 'list_things')] }));
      const streamed = await drain({});
      const sync = await service.runAgent({ goal: 'hola' });
      expect(sync.execution).toEqual(streamed.result.execution);
      expect(sync.content).toEqual(streamed.result.content);
    });
    it('malformed JSON never reaches a defaulting handler', async () => {
      chat
        .mockResolvedValueOnce(
          ok({
            tool_calls: [
              {
                ...call('t1', 'list_things'),
                function: { name: 'list_things', arguments: '{broken' },
              },
            ],
          }),
        )
        .mockResolvedValueOnce(ok({ content: 'terminado' }));
      const { result } = await drain({});
      expect(registry.executeToolResult).not.toHaveBeenCalled();
      expect(result.execution?.outcome).toBe('partial');
    });
    it('a real registry preserves approval as pending and never runs a write handler', async () => {
      const handler = jest.fn();
      const realRegistry = new AIToolRegistry({
        issue: jest.fn().mockResolvedValue('qa-token'),
        redeem: jest.fn(),
      } as any);
      realRegistry.register({
        name: 'create_expense',
        domain: 'expenses',
        description: 'qa',
        parameters: {},
        requiresConfirmation: true,
        handler,
      });
      service = new AIAgentService(
        { chat } as any,
        {} as any,
        realRegistry,
        { emit } as any,
        { awaitResult } as any,
        { canUseAIFeature, getAIFeatureConfig, consumeAIQuota } as any,
      );
      chat.mockResolvedValue(
        ok({ tool_calls: [call('t1', 'create_expense')] }),
      );
      const { result, chunks } = await drain({});
      expect(result.execution?.outcome).toBe('pending_confirmation');
      expect(chunks.find((c) => c.type === 'tool_result')?.tool).toMatchObject({
        failed: false,
        execution: { status: 'pending_confirmation' },
      });
      expect(result.pending_confirmation?.confirmation_token).toBe('qa-token');
      expect(handler).not.toHaveBeenCalled();
      expect(consumeAIQuota).not.toHaveBeenCalled();
    });
    it('real registry-to-loop HTTP200 business failure never counts as successful tool quota', async () => {
      const handler = jest
        .fn()
        .mockResolvedValue(
          '{"success":false,"statusCode":200,"message":"rejected"}',
        );
      const realRegistry = new AIToolRegistry({} as any);
      realRegistry.register({
        name: 'list_things',
        domain: 'qa',
        description: 'qa',
        parameters: {},
        readOnly: true,
        handler,
      });
      configureStorePlan(['*']);
      service = new AIAgentService(
        { chat } as any,
        {} as any,
        realRegistry,
        { emit } as any,
        { awaitResult } as any,
        { canUseAIFeature, getAIFeatureConfig, consumeAIQuota } as any,
      );
      chat
        .mockResolvedValueOnce(ok({ tool_calls: [call('t1', 'list_things')] }))
        .mockResolvedValueOnce(ok({ content: 'La consulta fue rechazada.' }));
      const { result } = await drain({});
      expect(handler).toHaveBeenCalledTimes(1);
      expect(consumeAIQuota).not.toHaveBeenCalled();
      expect(result.execution?.outcome).toBe('partial');
      expect(result.content).toBe('La consulta fue rechazada.');
    });
    it('provider transient emits a terminal failed outcome without another retry layer or lost usage', async () => {
      chat.mockResolvedValue({
        success: false,
        error: 'secret provider diagnostic',
        error_code: 'PROVIDER_TRANSIENT',
        retryable: true,
        usage: { totalTokens: 7 },
      });
      const { chunks, result } = await drain({});
      expect(chat).toHaveBeenCalledTimes(1);
      expect(result.total_tokens).toBe(7);
      expect(result.execution).toMatchObject({
        outcome: 'failed',
        error_code: 'PROVIDER_TRANSIENT',
      });
      expect(result.content).not.toContain('secret');
      expect(chunks.at(-1)?.type).toBe('done');
    });
    it('aborted turn remains silent and cancelled with no inferred progress', async () => {
      const { chunks, result } = await drain({
        shouldAbort: jest.fn().mockResolvedValue(true),
      });
      expect(chunks).toEqual([]);
      expect(result.execution?.outcome).toBe('cancelled');
      expect(chat).not.toHaveBeenCalled();
    });
    it('legacy text is preserved but cannot consume tool success quota or certify a completed objective', async () => {
      configureStorePlan(['list_things']);
      executeTool.mockResolvedValue('Ya quedó');
      chat
        .mockResolvedValueOnce(ok({ tool_calls: [call('t1', 'list_things')] }))
        .mockResolvedValueOnce(ok({ content: 'Esto fue lo que encontré.' }));
      const { result } = await drain({});
      expect(consumeAIQuota).not.toHaveBeenCalled();
      expect(result.tools_used[0].execution?.freshness).toBe('unknown');
      // A legacy read is not evidence of a write; the answer stays the model's.
      expect(result.content).toBe('Esto fue lo que encontré.');
      expect(result.execution?.outcome).not.toBe('completed_verified');
    });
  });
});

describe('AIAgentService B routed catalog boundary', () => {
  let registry: AIToolRegistry;
  let router: import('./tools/tool-router.service').ToolRouterService;
  let chat: jest.Mock;
  let handler: jest.Mock;
  let ui: jest.Mock;
  let service: AIAgentService;
  let access: any;
  beforeEach(async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 1,
      organization_id: 2,
      user_id: 3,
      roles: [],
      permissions: [],
      is_owner: true,
      is_super_admin: false,
    });
    registry = new AIToolRegistry({
      issue: jest.fn().mockResolvedValue('single-use-token'),
    } as any);
    const { createDiscoveryTools } =
      await import('./tools/domains/discovery.tools');
    const { ToolRouterService } = await import('./tools/tool-router.service');
    const { localToolRanking } = await import('./tools/tool-catalog');
    registry.registerMany(createDiscoveryTools());
    handler = jest.fn().mockResolvedValue('{"id":1}');
    for (let i = 0; i < 50; i++)
      registry.register({
        name: `operation_${String(i).padStart(2, '0')}`,
        domain: 'inventory',
        description: `operation_${i}`,
        parameters: { type: 'object', properties: {} },
        handler,
        readOnly: true,
      });
    router = new ToolRouterService(registry, {
      rank: async (q, docs, _s, d) => ({
        names: localToolRanking(q, docs, d),
        degraded: [],
      }),
    } as any);
    chat = jest.fn().mockResolvedValue(ok({ content: 'Revisión' }));
    ui = jest.fn();
    access = {
      canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
      getAIFeatureConfig: jest.fn().mockResolvedValue({ tools_allowed: ['*'] }),
      consumeAIQuota: jest.fn(),
      checkExtraQuota: jest.fn().mockResolvedValue({ exceeded: false }),
      consumeExtraQuota: jest.fn(),
    };
    service = new AIAgentService(
      { chat } as any,
      {} as any,
      registry,
      { emit: jest.fn() } as any,
      { awaitResult: ui } as any,
      access,
      undefined,
      router,
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  async function drain(params: Record<string, unknown> = {}) {
    const gen = service.runAgentStream({
      goal: 'operation_00',
      max_iterations: 6,
      ...params,
    });
    const chunks: AIStreamChunk[] = [];
    let next = await gen.next();
    while (!next.done) {
      chunks.push(next.value);
      next = await gen.next();
    }
    return { result: next.value, chunks };
  }
  const names = (index: number) =>
    chat.mock.calls[index][1].tools.map((d: any) => d.function.name);
  it('enables discovered definitions ONLY on the next inference and same args then execute despite D0 recovery', async () => {
    chat
      .mockResolvedValueOnce(
        ok({
          tool_calls: [
            call('s1', 'search_tools', { query: 'operation_49' }),
            call('bad-batch', 'operation_49', { id: 1 }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('next', 'operation_49', { id: 1 })] }),
      )
      .mockResolvedValueOnce(ok({ content: 'Leído' }));
    const { result, chunks } = await drain();
    expect(names(0)).toHaveLength(13);
    expect(names(0)).not.toContain('operation_49');
    expect(names(1)).toHaveLength(25);
    expect(names(1)).toContain('operation_49');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(
      chunks.some((c) => c.type === 'tool_call' && c.tool?.id === 'bad-batch'),
    ).toBe(false);
    expect(result.tools_used.map((t) => t.name)).toContain('operation_49');
    expect(result.execution?.outcome).not.toBe('blocked');
    expect(access.consumeAIQuota).toHaveBeenCalledTimes(1); // Discovery itself is not a business-success unit.
  });
  it('hotfix: an authorized but unoffered read is staged for the next inference, without search_tools nor a failed row', async () => {
    chat
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('direct', 'operation_49', { id: 1 })] }),
      )
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('again', 'operation_49', { id: 1 })] }),
      )
      .mockResolvedValueOnce(
        ok({ content: 'La caja cerró con $20.000 de menos.' }),
      );
    const { result, chunks } = await drain();
    expect(names(0)).not.toContain('operation_49');
    expect(names(1)).toContain('operation_49');
    expect(handler).toHaveBeenCalledTimes(1);
    const rows = chunks.filter((c) => c.type === 'tool_result');
    expect(rows.some((c) => c.tool?.failed)).toBe(false);
    for (const row of rows)
      expect(row.tool?.summary ?? '').not.toMatch(INTERNAL_JARGON);
    expect(result.content).toBe('La caja cerró con $20.000 de menos.');
  });
  it('P0-5: search_tools emits a succeeded/observed execution and the answer is kept', async () => {
    chat
      .mockResolvedValueOnce(
        ok({
          tool_calls: [call('s1', 'search_tools', { query: 'operation_49' })],
        }),
      )
      .mockResolvedValueOnce(ok({ tool_calls: [call('r1', 'operation_49')] }))
      .mockResolvedValueOnce(ok({ content: 'La caja cuadra.' }));
    const { result, chunks } = await drain();
    const search = chunks.find(
      (c) => c.type === 'tool_result' && c.tool?.name === 'search_tools',
    );
    expect(search?.tool?.execution).toMatchObject({
      status: 'ok',
      freshness: 'observed',
      effect_status: 'not_applicable',
    });
    expect(search?.tool?.failed).toBe(false);
    expect(search?.tool?.summary ?? '').not.toMatch(INTERNAL_JARGON);
    expect(result.content).toBe('La caja cuadra.');
  });
  it('never emits an unoffered UI tool_call nor dispatches to the browser', async () => {
    registry.register({
      name: 'zz_ui',
      domain: 'ui',
      description: 'UI',
      parameters: {},
      clientSide: true,
    });
    chat
      .mockResolvedValueOnce(ok({ tool_calls: [call('forged', 'zz_ui')] }))
      .mockResolvedValueOnce(ok({ content: 'No se ejecutó' }));
    const { chunks } = await drain({ stream_id: 's' });
    expect(ui).not.toHaveBeenCalled();
    expect(chunks.some((c) => c.type === 'tool_call')).toBe(false);
    expect(access.consumeAIQuota).not.toHaveBeenCalled();
  });
  it('excludes denied descriptions and revalidates the plan/caller/agent intersection', async () => {
    registry.register({
      name: 'secret_tool',
      domain: 'admin',
      description: 'RESTRICTED BODY',
      parameters: {},
      requiredPermissions: ['admin'],
      handler,
    });
    await drain({
      agent_allowed_tools: ['inventory', 'discovery'],
      agent_denied_tools: ['operation_00'],
      tools: ['inventory', 'discovery'],
    });
    expect(JSON.stringify(chat.mock.calls[0][1])).not.toContain(
      'RESTRICTED BODY',
    );
    expect(names(0)).not.toContain('operation_00');
    expect(names(0)).toContain('search_tools');
    expect(handler).not.toHaveBeenCalled();
  });
  it('revokes a tool between provider response and execution, including cached working sets', async () => {
    chat.mockImplementationOnce(async () => {
      access.getAIFeatureConfig.mockResolvedValue({
        tools_allowed: ['search_tools'],
      });
      return ok({ tool_calls: [call('revoked', 'operation_00')] });
    });
    const { result, chunks } = await drain();
    expect(handler).not.toHaveBeenCalled();
    expect(result.execution?.outcome).toBe('blocked');
    expect(chunks.some((c) => c.type === 'tool_call')).toBe(false);
  });
  it('fails authorization closed on plan lookup outage with routing ON', async () => {
    access.getAIFeatureConfig.mockRejectedValue(new Error('redis down'));
    await drain();
    expect(chat.mock.calls[0][1].tools).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });
  it('does not smuggle a denied planning tool through the plan-hook shortcut', async () => {
    registry.register({
      name: 'ask_user',
      domain: 'planning',
      description: 'Pregunta',
      parameters: {},
      readOnly: true,
    });
    const plan = {
      execute: jest.fn(),
      snapshot: jest.fn().mockResolvedValue(null),
    };
    chat.mockResolvedValueOnce(ok({ tool_calls: [call('p1', 'ask_user')] }));
    await drain({ plan, agent_denied_tools: ['ask_user'] });
    expect(plan.execute).not.toHaveBeenCalled();
  });
  it('keeps write approvals and never runs the write handler after discovery', async () => {
    registry.register({
      name: 'write_rare',
      domain: 'orders',
      description: 'Cambio raro',
      parameters: {},
      requiresConfirmation: true,
      preview: async () => ({ status: 'ok', target: 'Sintético', changes: [] }),
      handler,
    });
    chat
      .mockResolvedValueOnce(
        ok({
          tool_calls: [call('s', 'search_tools', { query: 'write_rare' })],
        }),
      )
      .mockResolvedValueOnce(ok({ tool_calls: [call('w', 'write_rare')] }));
    const { result } = await drain();
    expect(handler).not.toHaveBeenCalled();
    expect(result.pending_confirmation?.confirmation_token).toBe(
      'single-use-token',
    );
    expect(result.execution?.outcome).toBe('pending_confirmation');
    expect(access.consumeAIQuota).not.toHaveBeenCalled();
  });
  it('does not start inference if routing exhausted the clock', async () => {
    let now = 1;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const original = router.select.bind(router);
    jest.spyOn(router, 'select').mockImplementation(async (...args) => {
      const result = await original(...args);
      now = 5000;
      return result;
    });
    const { result } = await drain({ timeout_ms: 1000 });
    expect(chat).not.toHaveBeenCalled();
    expect(result.execution?.outcome).toBe('partial');
  });
});

describe('D1 durable loop seam', () => {
  const context = {
    store_id: 1,
    organization_id: 2,
    user_id: 3,
    permissions: ['read'],
    roles: ['owner'],
    is_super_admin: false,
    is_owner: true,
  };
  let registry: AIToolRegistry;
  let chat: jest.Mock;
  let handler: jest.Mock;
  let service: AIAgentService;
  let durable: any;
  beforeEach(() => {
    registry = new AIToolRegistry({ issue: jest.fn() } as any);
    handler = jest.fn().mockResolvedValue(
      JSON.stringify({
        id: 42,
        rows: Array.from({ length: 900 }, (_, id) => ({
          id,
          quantity: id + 1,
        })),
      }),
    );
    registry.register({
      name: 'read_rows',
      domain: 'inventory',
      description: 'Read',
      parameters: {},
      requiredPermissions: ['read'],
      readOnly: true,
      handler,
    });
    registry.register({
      name: 'restricted',
      domain: 'admin',
      description: 'secret',
      parameters: {},
      requiredPermissions: ['new_permission'],
      readOnly: true,
      handler,
    });
    chat = jest
      .fn()
      .mockResolvedValue(ok({ content: 'Resultado pendiente de verificar.' }));
    service = new AIAgentService(
      { chat } as any,
      {} as any,
      registry,
      { emit: jest.fn() } as any,
      { awaitResult: jest.fn() } as any,
      {
        canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
        getAIFeatureConfig: jest
          .fn()
          .mockResolvedValue({ tools_allowed: ['*'] }),
        consumeAIQuota: jest.fn(),
      } as any,
    );
    durable = {
      objective_id: 'obj1',
      objective: {
        authority_snapshot: ['read'],
        budget: { active_runtime_ms: 0 },
        expires_at: new Date(Date.now() + 60000),
      },
      recoveryState: jest.fn().mockResolvedValue({
        schema_version: '1',
        replans: 0,
        expansions: 0,
        corrections: 0,
        transient_retries: 0,
        failures: [],
        unknown_effect: false,
        exhausted: false,
      }),
      checkpointRecovery: jest.fn(),
      assertBudget: jest.fn(),
      assertCurrent: jest.fn(),
      excludeWait: jest.fn(),
      runProvider: jest.fn(async (fn) => fn()),
      runTool: jest.fn(async (fn) => fn()),
      addBudget: jest.fn(),
      checkpointTool: jest.fn().mockResolvedValue('result1'),
      proposeWrite: jest.fn(),
      finish: jest.fn(async () => ({
        id: 'obj1',
        version: 9,
        semantic_status: 'partial',
      })),
      close: jest.fn(),
    };
  });
  afterEach(() => jest.restoreAllMocks());
  const run = (fn: () => Promise<any>) =>
    RequestContextService.runIsolated(context, fn);
  it('captures full raw result before compaction and exposes recoverable artifact, not Vex blocks', async () => {
    chat.mockResolvedValueOnce(ok({ tool_calls: [call('c1', 'read_rows')] }));
    const result = await run(() =>
      service.runAgent({ goal: 'lee', conversation_id: 7, durable }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    const persisted = durable.checkpointTool.mock.calls[0][3];
    expect(persisted.data.rows).toHaveLength(900);
    expect(persisted.freshness).toBe('observed');
    expect(result.tools_used[0].result).toContain('artifact_ref');
    expect(result.tools_used[0].result).not.toContain('vex_block_read');
    expect(result.tools_used[0].result.length).toBeLessThan(6000);
    expect(result.objective).toMatchObject({ version: 9 });
    expect(durable.finish).toHaveBeenCalledTimes(1);
    expect(durable.close).toHaveBeenCalledTimes(1);
  });
  it('persists proposed intent before showing a card and stops the rest of the batch without dispatch', async () => {
    registry.register({
      name: 'create_product',
      domain: 'products',
      description: 'Crear',
      parameters: {},
      requiresConfirmation: true,
      preview: async () => ({ status: 'ok', target: 'Sintético', changes: [] }),
      handler,
    });
    (registry as any).confirmations.issue.mockResolvedValue('ephemeral-token');
    chat.mockResolvedValueOnce(
      ok({
        tool_calls: [
          call('write', 'create_product', { name: 'Sintético' }),
          call('after', 'read_rows'),
        ],
      }),
    );
    const result = await run(() => service.runAgent({ goal: 'crea', durable }));
    expect(handler).not.toHaveBeenCalled();
    expect(durable.proposeWrite).toHaveBeenCalledWith(
      'create_product',
      { name: 'Sintético' },
      undefined,
    );
    expect(result.pending_confirmation?.confirmation_token).toBe(
      'ephemeral-token',
    );
    expect(durable.checkpointTool.mock.calls[0][3].status).toBe(
      'pending_confirmation',
    );
    expect(result.execution?.outcome).toBe('pending_confirmation');
  });
  it('binds queue_task to the server conversation, so background work inherits this objective without trusting a model ID', async () => {
    const enqueue = jest.fn().mockResolvedValue('{"queued":true}');
    registry.register({
      name: 'queue_task',
      domain: 'tasks',
      description: 'Revisar',
      parameters: {},
      readOnly: true,
      handler: enqueue,
    });
    chat.mockResolvedValueOnce(
      ok({
        tool_calls: [
          call('queue', 'queue_task', {
            goal: 'Revisar',
            conversation_id: 999,
          }),
        ],
      }),
    );
    await run(() =>
      service.runAgent({ goal: 'revisa', durable, conversation_id: 7 }),
    );
    expect(enqueue.mock.calls[0][0]).toEqual({
      goal: 'Revisar',
      conversation_id: 7,
    });
  });
  it('new current permission never expands the saved authority ceiling', async () => {
    chat.mockResolvedValueOnce(ok({ tool_calls: [call('c1', 'restricted')] }));
    const result = await RequestContextService.runIsolated(
      { ...context, permissions: ['read', 'new_permission'] },
      () => service.runAgent({ goal: 'lee', durable }),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(chat.mock.calls[0][1])).not.toContain('secret');
    expect(result.execution?.outcome).toBe('blocked');
  });
  it('lease replaced during a provider call cannot dispatch another tool', async () => {
    chat.mockImplementationOnce(async () => {
      durable.assertBudget.mockRejectedValue(new Error('STALE_EXECUTOR'));
      return ok({ tool_calls: [call('late', 'read_rows')] });
    });
    await run(() => service.runAgent({ goal: 'lee', durable }));
    expect(handler).not.toHaveBeenCalled();
    expect(durable.close).toHaveBeenCalledTimes(1);
  });
  it('client generator return closes session without claiming semantic completion', async () => {
    chat.mockResolvedValueOnce(ok({ tool_calls: [call('c1', 'read_rows')] }));
    await run(async () => {
      const gen = service.runAgentStream({ goal: 'lee', durable });
      await gen.next();
      await gen.return(undefined as never);
    });
    expect(durable.close).toHaveBeenCalledTimes(1);
    expect(durable.finish).not.toHaveBeenCalled();
  });

  describe('hotfix: la respuesta del modelo nunca se reemplaza por jerga interna', () => {
    const INTERNAL_INSTRUCTION =
      'Busca la herramienta autorizada con search_tools o la fase pertinente del playbook; conserva el objetivo original.';
    const answer =
      'Tu caja cerró con un faltante de $20.000 en efectivo: el esperado era $500.000 y contaste $480.000.';
    const withOpenObjective = () => {
      durable.objective.plan = makePlan({ steps: [step(1, 'in_progress')] });
      durable.objective.requires_revalidation = true;
      durable.objective.next_step = INTERNAL_INSTRUCTION;
    };
    const stream = (goal: string) =>
      run(async () => {
        const chunks: AIStreamChunk[] = [];
        const gen = service.runAgentStream({ goal, durable });
        let step = await gen.next();
        while (!step.done) {
          chunks.push(step.value);
          step = await gen.next();
        }
        return { chunks, result: step.value };
      });
    const userVisible = (chunks: AIStreamChunk[], content: string) => [
      content,
      ...chunks.filter((c) => c.type === 'text').map((c) => c.content ?? ''),
      ...chunks
        .filter((c) => c.type === 'tool_result')
        .map((c) => c.tool?.summary ?? ''),
    ];

    it('(a) un turno de lectura con plan/objetivo abierto conserva la respuesta del modelo', async () => {
      withOpenObjective();
      chat
        .mockResolvedValueOnce(ok({ tool_calls: [call('c1', 'read_rows')] }))
        .mockResolvedValueOnce(ok({ content: answer }));
      const { chunks, result } = await stream(
        'Oe me ayudas a analizar un cierre de caja que no me dio?',
      );
      expect(result.content).toBe(answer);
      expect(chunks.filter((c) => c.type === 'text')).toEqual([
        { type: 'text', content: answer },
      ]);
    });

    it('(b) lecturas fallidas conservan la respuesta del modelo y no filtran jerga', async () => {
      withOpenObjective();
      handler.mockResolvedValue(
        '{"error":"fallo","error_code":"TOOL_BUSINESS_ERROR","next_step":"Inspecciona el schema y preflight autorizados."}',
      );
      chat
        .mockResolvedValueOnce(
          ok({ tool_calls: [call('c1', 'read_rows', { session_id: 1 })] }),
        )
        .mockResolvedValueOnce(
          ok({ tool_calls: [call('c2', 'read_rows', { session_id: 2 })] }),
        )
        .mockResolvedValueOnce(ok({ content: answer }));
      const { chunks, result } = await stream('que significa eso');
      expect(result.content).toBe(answer);
      const traces = chunks.filter((c) => c.type === 'tool_result');
      expect(traces.length).toBeGreaterThan(0);
      expect(traces.every((c) => c.tool?.failed)).toBe(true);
      for (const text of userVisible(chunks, result.content))
        expect(text).not.toMatch(INTERNAL_JARGON);
    });

    it('(b) una consulta sin permiso se explica en lenguaje humano', async () => {
      withOpenObjective();
      chat
        .mockResolvedValueOnce(ok({ tool_calls: [call('c1', 'restricted')] }))
        .mockResolvedValueOnce(ok({ content: answer }));
      const { chunks, result } = await stream('analiza la caja');
      expect(result.content).toBeTruthy();
      for (const text of userVisible(chunks, result.content))
        expect(text).not.toMatch(INTERNAL_JARGON);
    });

    it('(b) sin texto del modelo, el aviso por lectura fallida es humano', async () => {
      withOpenObjective();
      handler.mockResolvedValue(
        '{"error":"fallo","error_code":"TOOL_BUSINESS_ERROR","next_step":"x"}',
      );
      chat
        .mockResolvedValueOnce(ok({ tool_calls: [call('c1', 'read_rows')] }))
        .mockResolvedValueOnce(ok({ content: '' }));
      const { chunks, result } = await stream('analiza la caja');
      expect(result.content).toBeTruthy();
      for (const text of userVisible(chunks, result.content))
        expect(text).not.toMatch(INTERNAL_JARGON);
    });

    it('(c) una escritura sin postcondición verificada añade un aviso breve sin reemplazar la respuesta', async () => {
      withOpenObjective();
      const written = 'Listo, actualicé la nota del cierre.';
      durable.finish.mockResolvedValue({
        id: 'obj1',
        version: 9,
        semantic_status: 'partial',
      });
      async function* source(): AsyncGenerator<AIStreamChunk, any> {
        yield { type: 'text', content: written };
        yield { type: 'done' };
        return {
          content: written,
          iterations: 2,
          total_tokens: 10,
          success: true,
          tools_used: [
            {
              name: 'update_note',
              args: {},
              result: '{"applied":true}',
              execution: { status: 'ok', effect_status: 'applied' },
            },
          ],
        };
      }
      const gen = (service as any).withDurableSession(source(), durable);
      const texts: string[] = [];
      let next = await gen.next();
      while (!next.done) {
        if (next.value.type === 'text') texts.push(next.value.content);
        next = await gen.next();
      }
      const result = next.value;
      expect(result.content.startsWith(written)).toBe(true);
      expect(result.content).toContain(USER_NOTICES.write_pending_verification);
      expect(result.content).not.toMatch(INTERNAL_JARGON);
      expect(result.content).not.toContain(INTERNAL_INSTRUCTION);
      expect(texts).toEqual([result.content]);
    });

    // §5.3 noJargon grader of the stabilization plan, over visible text.
    const noJargon =
      /postcondici|search_tools|search_playbooks|load_playbook|playbook|objetivo original|next_step|next_action|semantic_status|requires_revalidation|Conservo el avance|evidencia suficiente|no está verificada|RECUPERACIÓN TÉCNICA|inferencia|schema|preflight|fingerprint|lease|tool_call:|objective:|\(interno\)|BATCH_NOT|AI_AGENT_/i;
    const visibleText = (chunks: AIStreamChunk[], content: string) => [
      ...userVisible(chunks, content),
      ...chunks
        .filter((c) => c.type === 'progress' || c.type === 'error')
        .map((c) => c.content ?? c.error ?? ''),
    ];

    it('P0-4: una lectura de 7000+ caracteres se compacta sin truncated ni incomplete_data y conserva la respuesta', async () => {
      const raw = await handler();
      expect(raw.length).toBeGreaterThan(7000);
      chat
        .mockResolvedValueOnce(ok({ tool_calls: [call('c1', 'read_rows')] }))
        .mockResolvedValueOnce(ok({ content: answer }));
      const { chunks, result } = await stream('analiza el cierre de caja');
      expect(result.content).toBe(answer);
      const frame = chunks.find(
        (c) => c.type === 'tool_result' && c.tool?.name === 'read_rows',
      );
      expect(frame?.tool?.execution).toMatchObject({
        status: 'ok',
        freshness: 'observed',
        compacted: true,
      });
      expect(frame?.tool?.failed).toBe(false);
      expect(result.tools_used[0].execution).toMatchObject({
        freshness: 'observed',
        compacted: true,
      });
      // The model got the bounded envelope, never a "truncated" receipt nor
      // the old "Consulta el bloque completo…" recovery instruction.
      const toModel = JSON.stringify(chat.mock.calls[1]);
      expect(toModel).toContain('compacted');
      expect(toModel).not.toContain('"freshness":"truncated"');
      expect(toModel).not.toContain('Consulta el bloque completo');
      expect(JSON.stringify(durable.checkpointRecovery.mock.calls)).not.toContain(
        'incomplete_data',
      );
    });

    it('P0-5: un ui_* con respuesta OK del navegador queda observed y conserva la respuesta', async () => {
      registry.register({
        name: 'ui_navigate',
        domain: 'ui',
        description: 'Navegar',
        parameters: {},
        requiredPermissions: ['read'],
        readOnly: true,
        clientSide: true,
      });
      (service as any).uiChannel.awaitResult.mockResolvedValue(
        JSON.stringify({ status: 'navigated', landed_on: '/admin/caja' }),
      );
      chat
        .mockResolvedValueOnce(
          ok({ tool_calls: [call('u1', 'ui_navigate', { route: 'caja' })] }),
        )
        .mockResolvedValueOnce(ok({ content: answer }));
      const { chunks, result } = await run(async () => {
        const out: AIStreamChunk[] = [];
        const gen = service.runAgentStream({
          goal: 'llévame a caja',
          durable,
          stream_id: 's-1',
        });
        let step = await gen.next();
        while (!step.done) {
          out.push(step.value);
          step = await gen.next();
        }
        return { chunks: out, result: step.value };
      });
      expect(result.content).toBe(answer);
      const frame = chunks.find(
        (c) => c.type === 'tool_result' && c.tool?.name === 'ui_navigate',
      );
      expect(frame?.tool?.execution).toMatchObject({
        status: 'ok',
        freshness: 'observed',
        effect_status: 'not_applicable',
      });
    });

    it('P0-8: un argumento inválido solo afecta a su llamada; la hermana válida se ejecuta', async () => {
      const listSessions = jest
        .fn()
        .mockResolvedValue(JSON.stringify({ id: 5, sessions: [{ id: 5 }] }));
      registry.register({
        name: 'get_cash_session',
        domain: 'cash',
        description: 'Sesión',
        parameters: {
          type: 'object',
          properties: { session_id: { type: 'number' } },
          required: ['session_id'],
        },
        requiredPermissions: ['read'],
        readOnly: true,
        handler,
      });
      registry.register({
        name: 'list_cash_sessions',
        domain: 'cash',
        description: 'Sesiones',
        parameters: { type: 'object', properties: {} },
        requiredPermissions: ['read'],
        readOnly: true,
        handler: listSessions,
      });
      chat
        .mockResolvedValueOnce(
          ok({
            tool_calls: [
              call('bad', 'get_cash_session', {}),
              call('good', 'list_cash_sessions', {}),
            ],
          }),
        )
        .mockResolvedValueOnce(ok({ content: answer }));
      const { chunks, result } = await stream('analiza la caja');
      expect(listSessions).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();
      const rows = chunks.filter((c) => c.type === 'tool_result');
      const bad = rows.find((c) => c.tool?.id === 'bad');
      const good = rows.find((c) => c.tool?.id === 'good');
      expect(bad?.tool?.execution?.error_code).toBe('INVALID_ARGS');
      expect(bad?.tool?.failed).toBe(true);
      expect(good?.tool?.execution?.status).toBe('ok');
      expect(good?.tool?.failed).toBe(false);
      expect(
        rows.filter(
          (c) =>
            c.tool?.id !== 'bad' &&
            (c.tool?.failed ||
              c.tool?.execution?.error_code === 'BATCH_NOT_DISPATCHED'),
        ),
      ).toHaveLength(0);
      expect(result.content).toBe(answer);
    });

    it('P0-14: los frames de un turno con recuperación no llevan next_action, next_step ni jerga', async () => {
      withOpenObjective();
      durable.finish.mockResolvedValue({
        id: 'obj1',
        version: 9,
        semantic_status: 'partial',
        next_step: INTERNAL_INSTRUCTION,
      });
      handler.mockResolvedValue(
        '{"error":"fallo","error_code":"TOOL_BUSINESS_ERROR","next_step":"Inspecciona el schema y preflight autorizados."}',
      );
      chat
        .mockResolvedValueOnce(
          ok({ tool_calls: [call('c1', 'read_rows', { session_id: 1 })] }),
        )
        .mockResolvedValueOnce(ok({ content: answer }));
      const { chunks, result } = await stream('analiza la caja');
      // The runtime keeps the model instruction; the client never sees it.
      expect(result.execution?.next_action).toBeTruthy();
      const serialized = JSON.stringify(chunks);
      expect(serialized).not.toContain('next_action');
      expect(serialized).not.toContain(INTERNAL_INSTRUCTION);
      expect(chunks.find((c) => c.type === 'done')?.objective?.next_step).toBe(
        null,
      );
      for (const text of visibleText(chunks, result.content))
        expect(text).not.toMatch(noJargon);
    });

    it('(a) la sesión durable no toca la respuesta de un turno sin escrituras', async () => {
      withOpenObjective();
      async function* source(): AsyncGenerator<AIStreamChunk, any> {
        yield { type: 'text', content: answer };
        return {
          content: answer,
          iterations: 1,
          total_tokens: 10,
          success: true,
          tools_used: [
            {
              name: 'read_rows',
              args: {},
              result: '{}',
              execution: { status: 'ok', effect_status: 'unverified' },
            },
          ],
        };
      }
      const gen = (service as any).withDurableSession(source(), durable);
      let next = await gen.next();
      while (!next.done) next = await gen.next();
      expect(next.value.content).toBe(answer);
    });
  });
});
