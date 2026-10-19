import { AIAgentService } from './ai-agent.service';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { ToolRouterService } from './tools/tool-router.service';
import { createDiscoveryTools } from './tools/domains/discovery.tools';
import { localToolRanking } from './tools/tool-catalog';
import { emptyObjectiveBudget } from './tasks/interfaces/agent-objective.interface';
import { RequestContextService } from '../common/context/request-context.service';

/** Real public loop, router, registry and cursor validation; synthetic provider/durable counters. */
describe('N2 durable routing expansion budget', () => {
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
      } as any,
      undefined,
      router,
    );
    const run = () =>
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
          }),
      );
    return { chat, run, search, durable, objective, handler };
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

  it('allows multiple valid schema cursors at an exhausted durable cap; a real third expansion is blocked', async () => {
    const f = fixture(1); // One expansion consumed by an earlier turn.
    f.chat
      .mockResolvedValueOnce(
        response([call('c1', { query: 'operation_59', limit: 3 })]),
      )
      .mockImplementationOnce(async (messages) =>
        response([call('c2', pageArgs(messages))]),
      )
      .mockImplementationOnce(async (messages) =>
        response([call('c3', pageArgs(messages))]),
      )
      .mockResolvedValueOnce(response([call('c4', { query: 'operation_58' })]));
    const result = await f.run();
    const pages = await Promise.all(
      f.search.mock.results.map(async (r) => JSON.parse(await r.value)),
    );
    expect(f.chat).toHaveBeenCalledTimes(4);
    expect(
      pages.slice(0, 3).every((p) => p.has_more && p.results.length === 3),
    ).toBe(true);
    expect(new Set(pages.slice(0, 3).map((p) => p.cursor)).size).toBe(3);
    expect(pages[3].error_code).toBe('AGENT_EXPANSION_LIMIT');
    expect(f.objective.budget.expansions).toBe(2);
    expect(
      f.durable.addBudget.mock.calls.filter(([d]) => d.expansions),
    ).toEqual([[{ expansions: 1 }]]);
    expect(f.search.mock.calls.at(-1)![0]).toMatchObject({
      capacity: 24,
      expansions: 1,
    });
    expect(result.exhausted).toBe(true); // Only the new expansion, not c2/c3, halted the turn.
    expect(f.handler).not.toHaveBeenCalled();
  });
  it('charges exactly two actual K12→K24→K40 expansions, not cursors or the router maximum no-op', async () => {
    const f = fixture();
    f.chat
      .mockResolvedValueOnce(
        response([call('c1', { query: 'operation_59', limit: 3 })]),
      )
      .mockImplementationOnce(async (messages) =>
        response([call('c2', pageArgs(messages))]),
      )
      .mockResolvedValueOnce(response([call('c3', { query: 'operation_58' })]))
      .mockImplementationOnce(async (messages) =>
        response([
          call('c4', {
            ...pageArgs(messages),
            query: 'operation_58',
          }),
        ]),
      )
      .mockResolvedValueOnce(response([call('c5', { query: 'operation_57' })]))
      .mockResolvedValueOnce(response());
    const result = await f.run();
    expect(f.chat).toHaveBeenCalledTimes(6);
    expect(f.objective.budget.expansions).toBe(2);
    expect(
      f.durable.addBudget.mock.calls.filter(([d]) => d.expansions),
    ).toHaveLength(2);
    expect(f.search.mock.calls.at(-1)![0]).toMatchObject({
      capacity: 40,
      expansions: 2,
    });
    expect(JSON.parse(await f.search.mock.results[4].value).expanded).toBe(
      false,
    );
    expect(result.exhausted).not.toBe(true);
  });
  it('does not charge pending/no-op or invalid search results', async () => {
    const f = fixture();
    f.chat
      .mockResolvedValueOnce(
        response([
          call('c1', { query: 'operation_59' }),
          call('pending', { query: 'operation_58' }),
        ]),
      )
      .mockResolvedValueOnce(response([call('invalid', { query: '' })]))
      .mockResolvedValueOnce(response());
    await f.run();
    expect(f.objective.budget.expansions).toBe(1);
    expect(
      f.durable.addBudget.mock.calls.filter(([d]) => d.expansions),
    ).toHaveLength(1);
    expect(JSON.parse(await f.search.mock.results[1].value).error).toBeTruthy();
    expect(JSON.parse(await f.search.mock.results[2].value).error_code).toBe(
      'INVALID_ARGS',
    );
  });
  it('does not treat an invalid cursor at the cap as an expansion or a bypass', async () => {
    const f = fixture(2);
    f.chat
      .mockResolvedValueOnce(
        response([
          call('invalid', { query: 'operation_59', cursor: 'forged' }),
        ]),
      )
      .mockResolvedValueOnce(response());
    const result = await f.run();
    expect(f.objective.budget.expansions).toBe(2);
    expect(
      f.durable.addBudget.mock.calls.filter(([d]) => d.expansions),
    ).toHaveLength(0);
    expect(f.search.mock.calls[0][0]).toMatchObject({
      capacity: 12,
      expansions: 0,
    });
    expect(JSON.parse(await f.search.mock.results[0].value).error).toBeTruthy();
    expect(result.exhausted).not.toBe(true);
  });
  it('honors a zero expansion budget before changing the router', async () => {
    process.env.AI_AGENT_MAX_CATALOG_EXPANSIONS = '0';
    const f = fixture();
    f.chat.mockResolvedValueOnce(
      response([call('limited', { query: 'operation_59' })]),
    );
    await f.run();
    expect(f.objective.budget.expansions).toBe(0);
    expect(f.search.mock.calls[0][0]).toMatchObject({
      capacity: 12,
      expansions: 0,
    });
    expect(f.durable.checkpointTool.mock.calls.at(-1)![3].error_code).toBe(
      'AGENT_EXPANSION_LIMIT',
    );
  });
});
