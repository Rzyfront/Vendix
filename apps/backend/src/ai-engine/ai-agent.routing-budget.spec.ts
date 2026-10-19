import { AIAgentService } from './ai-agent.service';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { ToolRouterService } from './tools/tool-router.service';
import { createDiscoveryTools } from './tools/domains/discovery.tools';
import { localToolRanking } from './tools/tool-catalog';
import { emptyObjectiveBudget } from './tasks/interfaces/agent-objective.interface';
import { RequestContextService } from '../common/context/request-context.service';

/** Real public loop, router, registry and cursor validation; synthetic provider/durable counters. */
describe('Fix router: catálogo autorizado completo, sin rondas de staging (loop durable real)', () => {
  const previousLimit = process.env.AI_AGENT_MAX_CATALOG_EXPANSIONS;
  beforeEach(() => {
    process.env.AI_AGENT_MAX_CATALOG_EXPANSIONS = '2';
  });
  afterEach(() => {
    if (previousLimit === undefined)
      delete process.env.AI_AGENT_MAX_CATALOG_EXPANSIONS;
    else process.env.AI_AGENT_MAX_CATALOG_EXPANSIONS = previousLimit;
  });
  function fixture(initialExpansions = 0) {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(createDiscoveryTools());
    const handler = jest.fn(async () => '{}');
    for (let i = 0; i < 60; i++)
      registry.register({
        name: `operation_${String(i).padStart(2, '0')}`,
        domain: 'inventory',
        description: `Operation ${i}`,
        parameters: { type: 'object', properties: {} },
        readOnly: true,
        handler,
      });
    const router = new ToolRouterService(registry, {
      rank: async (q, docs, _scope, domain) => ({
        names: localToolRanking(q, docs, domain),
        degraded: [],
      }),
    } as any);
    const search = jest.spyOn(router, 'search');
    const objective = {
      id: 'objective',
      authority_snapshot: [],
      budget: { ...emptyObjectiveBudget(), expansions: initialExpansions },
      expires_at: new Date(Date.now() + 3_600_000),
      lease_until: new Date(Date.now() + 300_000),
    };
    const durable: any = {
      objective,
      objective_id: objective.id,
      recoveryState: jest.fn(),
      checkpointRecovery: jest.fn(),
      assertBudget: jest.fn(),
      assertCurrent: jest.fn(),
      runProvider: jest.fn(async (fn) => fn()),
      runTool: jest.fn(async (fn) => fn()),
      auditTool: jest.fn(),
      addBudget: jest.fn(async (delta) => {
        for (const [key, value] of Object.entries(delta))
          objective.budget[key] += Number(value);
      }),
      checkpointTool: jest.fn(async () => 'artifact'),
      finish: jest.fn(async () => ({
        id: objective.id,
        semantic_status: 'partial',
      })),
      close: jest.fn(),
    };
    const chat = jest.fn();
    const service = new AIAgentService(
      { chat } as any,
      {} as any,
      registry,
      { emit: jest.fn() } as any,
      {} as any,
      {
        canUseAIFeature: async () => ({ allowed: true }),
        getAIFeatureConfig: async () => ({ tools_allowed: ['*'] }),
        checkExtraQuota: async () => ({ exceeded: false }),
        consumeExtraQuota: jest.fn(),
        consumeAIQuota: jest.fn(),
      } as any,
      undefined,
      router,
    );
    const run = (extra: Record<string, unknown> = {}) =>
      RequestContextService.runIsolated(
        {
          store_id: 11,
          organization_id: 7,
          user_id: 3,
          permissions: [],
          roles: [],
          is_owner: true,
          is_super_admin: false,
        },
        () =>
          service.runAgent({
            goal: 'operation_00',
            max_iterations: 8,
            durable,
            ...extra,
          }),
      );
    return { chat, run, search, durable, objective, handler, registry };
  }
  const response = (tool_calls: any[] = []) => ({
    success: true,
    content: tool_calls.length ? '' : 'Revisión preparada.',
    tool_calls,
  });
  const call = (id: string, args: Record<string, unknown>) => ({
    id,
    type: 'function',
    function: { name: 'search_tools', arguments: JSON.stringify(args) },
  });
  const pageArgs = (messages: any[]) => ({
    query: 'operation_59',
    limit: 3,
    cursor: JSON.parse(messages.filter((m) => m.role === 'tool').at(-1).content)
      .cursor,
  });

  const toolCall = (id: string, name: string, args = {}) => ({
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });
  const toolMessages = (messages: any[]) =>
    messages
      .filter((m) => m.role === 'tool')
      .map((m) => JSON.parse(m.content));

  // Fix router 2026-10 (prod): Vex/Vexi answered «No alcancé a terminar» +
  // «no está disponible con tu usuario o plan» because an authorized tool
  // outside the routed top-K was rejected/staged and spent rounds.
  it('offers the full authorized catalog: an authorized tool far from the goal runs in the SAME round', async () => {
    const f = fixture();
    f.chat
      .mockImplementationOnce(async (_messages, options) => {
        // 60 operations + discovery scaffold: nothing excluded by relevance.
        expect(
          options.tools.map((t: any) => t.function.name),
        ).toContain('operation_59');
        return response([toolCall('c1', 'operation_59')]);
      })
      .mockImplementationOnce(async (messages) => {
        expect(toolMessages(messages)[0].status).toBe('ok');
        return response();
      });
    const result = await f.run();
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(f.chat).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('Revisión preparada.');
    expect(result.exhausted).not.toBe(true);
    expect(result.execution?.outcome).not.toBe('blocked');
  });

  it('search_tools is optional: never charges expansions, never halts, even at a zero budget', async () => {
    process.env.AI_AGENT_MAX_CATALOG_EXPANSIONS = '0';
    const f = fixture();
    f.chat
      .mockResolvedValueOnce(
        response([call('c1', { query: 'operation_59', limit: 3 })]),
      )
      .mockImplementationOnce(async (messages) =>
        response([call('c2', pageArgs(messages))]),
      )
      .mockResolvedValueOnce(response([call('c3', { query: 'operation_58' })]))
      .mockResolvedValueOnce(response([toolCall('c4', 'operation_58')]))
      .mockResolvedValueOnce(response());
    const result = await f.run();
    const pages = await Promise.all(
      f.search.mock.results.map(async (r) => JSON.parse(await r.value)),
    );
    expect(pages.every((p) => !p.error_code)).toBe(true);
    expect(pages[0].results[0].name).toBe('operation_59');
    expect(f.objective.budget.expansions).toBe(0);
    expect(
      f.durable.addBudget.mock.calls.filter(([d]) => d.expansions),
    ).toHaveLength(0);
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('Revisión preparada.');
    expect(result.exhausted).not.toBe(true);
  });

  it('a hallucinated tool is a recoverable error the model corrects, never a permissions notice', async () => {
    const f = fixture();
    f.chat
      .mockResolvedValueOnce(response([toolCall('c1', 'get_magic_report')]))
      .mockImplementationOnce(async (messages) => {
        const [rejected] = toolMessages(messages);
        expect(rejected.error_code).toBe('AI_AGENT_TOOL_NOT_ALLOWED');
        expect(rejected.status).toBe('recoverable_error');
        return response([toolCall('c2', 'operation_01')]);
      })
      .mockResolvedValueOnce(response());
    const result = await f.run();
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('Revisión preparada.');
    expect(result.content).not.toMatch(/usuario o con tu plan/);
    expect(result.execution?.outcome).not.toBe('blocked');
  });

  it('exhausted rounds get a tool-free closing answer instead of «No alcancé a terminar»', async () => {
    const f = fixture();
    let n = 0;
    f.chat.mockImplementation(async (_messages, options) => {
      if (!options?.tools) return response(); // closing inference
      n++;
      return response([toolCall(`c${n}`, 'operation_02')]);
    });
    const result = await f.run(); // max_iterations: 8
    expect(n).toBe(8);
    const closing = f.chat.mock.calls.at(-1)!;
    expect(closing[1]?.tools).toBeUndefined();
    expect(result.content).toBe('Revisión preparada.');
    expect(result.exhausted).not.toBe(true);
    expect(result.content).not.toMatch(/No alcancé a terminar/);
  });

  it('Vex block tools are never offered to Vexi (its panel cannot paint them), only to Vex', async () => {
    const f = fixture();
    f.registry.register({
      name: 'vex_render_table',
      domain: 'vex',
      description: 'Tabla de Vex',
      parameters: { type: 'object', properties: {} },
      readOnly: true,
      handler: f.handler,
    });
    f.chat.mockResolvedValue(response());
    await f.run();
    expect(
      f.chat.mock.calls[0][1].tools.map((t: any) => t.function.name),
    ).not.toContain('vex_render_table');
    f.chat.mockClear();
    await f.run({ agent_key: 'vex' });
    expect(
      f.chat.mock.calls[0][1].tools.map((t: any) => t.function.name),
    ).toContain('vex_render_table');
  });

  it('when the closing answer also fails, the exhausted notice is the honest fallback', async () => {
    const f = fixture();
    let n = 0;
    f.chat.mockImplementation(async (_messages, options) => {
      if (!options?.tools) return { success: true, content: '' };
      n++;
      return response([toolCall(`c${n}`, 'operation_02')]);
    });
    const result = await f.run();
    expect(result.exhausted).toBe(true);
  });
});
