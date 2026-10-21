import { AIAgentService } from './ai-agent.service';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { ToolRouterService } from './tools/tool-router.service';
import { createDiscoveryTools } from './tools/domains/discovery.tools';
import { createPlaybookTools } from './tools/domains/playbook.tools';
import { createProceduralRecipeTools } from './tools/domains/recipe.tools';
import { ForbiddenException } from '@nestjs/common';
import { localToolRanking, localToolScores } from './tools/tool-catalog';
import { INTERNAL_JARGON } from './agent-execution.contract';
import { redactTraceAttributes } from './observability/agent-trace.service';
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
  function fixture(
    initialExpansions = 0,
    dynamic = false,
    extras: { playbooks?: any; recipes?: any } = {},
  ) {
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
        // F3: a ready index (scores + full coverage) turns on the working set.
        ...(dynamic && {
          scores: Object.fromEntries(
            [...localToolScores(q, docs, domain)].filter(([, v]) => v > 0),
          ),
          coverage: 1,
          source: 'lexical_local',
        }),
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
    const emit = jest.fn();
    const service = new AIAgentService(
      { chat } as any,
      {} as any,
      registry,
      { emit } as any,
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
      extras.playbooks,
      extras.recipes,
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
    return {
      chat,
      run,
      search,
      durable,
      objective,
      handler,
      registry,
      emit,
      router,
    };
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
    messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));

  // Fix router 2026-10 (prod): Vex/Vexi answered «No alcancé a terminar» +
  // «no está disponible con tu usuario o plan» because an authorized tool
  // outside the routed top-K was rejected/staged and spent rounds.
  it('offers the full authorized catalog: an authorized tool far from the goal runs in the SAME round', async () => {
    const f = fixture();
    f.chat
      .mockImplementationOnce(async (_messages, options) => {
        // 60 operations + discovery scaffold: nothing excluded by relevance.
        expect(options.tools.map((t: any) => t.function.name)).toContain(
          'operation_59',
        );
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
  describe('F3 carga dinámica: el mecánico en el loop real', () => {
    const offered = (options: any): string[] =>
      options.tools.map((t: any) => t.function.name);
    const supplierTool = (f: ReturnType<typeof fixture>) =>
      f.registry.register({
        name: 'find_supplier',
        domain: 'suppliers',
        description: 'Buscar proveedores por nombre o NIT',
        parameters: { type: 'object', properties: {} },
        readOnly: true,
        handler: f.handler,
      });

    it('una tool autorizada NO cargada se carga y ejecuta en la ronda 1, sin bloqueo ni aviso', async () => {
      const f = fixture(0, true);
      f.chat
        .mockImplementationOnce(async (_messages, options) => {
          expect(offered(options)).toContain('search_tools');
          expect(offered(options)).not.toContain('operation_59');
          expect(offered(options).length).toBeLessThan(40);
          return response([toolCall('c1', 'operation_59')]);
        })
        .mockImplementationOnce(async (messages, options) => {
          expect(toolMessages(messages)[0].status).toBe('ok');
          expect(offered(options)).toContain('operation_59');
          return response();
        });
      const result = await f.run();
      expect(f.handler).toHaveBeenCalledTimes(1);
      expect(f.chat).toHaveBeenCalledTimes(2);
      expect(result.execution?.outcome).not.toBe('blocked');
      expect(result.content).not.toMatch(/usuario o con tu plan/);
      expect(result.content).not.toMatch(INTERNAL_JARGON);
    });

    it('F7: el loop pasa el catálogo autorizado como deferredTools (superconjunto de lo ofrecido)', async () => {
      const f = fixture(0, true);
      f.chat.mockImplementationOnce(async (_messages, options: any) => {
        const deferred = options.deferredTools.map((t: any) => t.function.name);
        expect(deferred).toContain('operation_59');
        expect(deferred.length).toBeGreaterThan(offered(options).length);
        for (const name of offered(options)) expect(deferred).toContain(name);
        return response();
      });
      await f.run();
      expect(f.chat).toHaveBeenCalledTimes(1);
    });

    it('3 rondas de búsqueda no gastan max_iterations; la 4.ª sí cuenta', async () => {
      const f = fixture(0, true);
      // max_iterations 2 + 3 free rounds: 3 searches, then the real call, then the answer.
      f.chat
        .mockResolvedValueOnce(
          response([call('s1', { query: 'operation_59' })]),
        )
        .mockResolvedValueOnce(
          response([call('s2', { query: 'operation_58' })]),
        )
        .mockResolvedValueOnce(
          response([call('s3', { query: 'operation_57' })]),
        )
        .mockResolvedValueOnce(response([toolCall('c1', 'operation_59')]))
        .mockResolvedValueOnce(response());
      const result = await f.run({ max_iterations: 2 });
      expect(f.handler).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Revisión preparada.');
      expect(result.exhausted).not.toBe(true);

      // A 4th search is no longer free: 2 + 3 = 5 tool rounds, then closing.
      const g = fixture(0, true);
      let rounds = 0;
      g.chat.mockImplementation(async (_messages, options) => {
        if (!options?.tools) return response();
        rounds++;
        return response([call(`s${rounds}`, { query: `operation_${rounds}` })]);
      });
      await g.run({ max_iterations: 2 });
      expect(rounds).toBe(5);
      expect(g.chat.mock.calls.at(-1)![1]?.tools).toBeUndefined();
    });

    it('nombre alucinado list_suppliers → alternativa real find_supplier, cargada para la ronda siguiente', async () => {
      const f = fixture(0, true);
      supplierTool(f);
      f.chat
        .mockResolvedValueOnce(
          response([
            toolCall('c1', 'list_suppliers', { query: 'proveedores' }),
          ]),
        )
        .mockImplementationOnce(async (messages, options) => {
          const [rejected] = toolMessages(messages);
          expect(rejected.error_code).toBe('AI_AGENT_TOOL_NOT_ALLOWED');
          expect(rejected.status).toBe('recoverable_error');
          expect(rejected.data.next_step).toContain('find_supplier');
          expect(rejected.data.next_step).not.toMatch(INTERNAL_JARGON);
          expect(offered(options)).toContain('find_supplier');
          return response([toolCall('c2', 'find_supplier')]);
        })
        .mockResolvedValueOnce(response());
      const result = await f.run({ goal: 'buscar mis proveedores' });
      expect(f.handler).toHaveBeenCalledTimes(1);
      expect(result.execution?.outcome).not.toBe('blocked');
      expect(result.content).not.toMatch(/usuario o con tu plan/);
    });

    it('F5: cada inferencia publica las métricas del conjunto de trabajo y el trace las conserva', async () => {
      const f = fixture(0, true);
      f.chat
        .mockResolvedValueOnce(
          response([call('s1', { query: 'operation_40' })]),
        )
        .mockResolvedValueOnce(response([toolCall('c1', 'operation_59')]))
        .mockResolvedValueOnce(response());
      await f.run();
      const events = f.emit.mock.calls
        .filter(([name]) => name === 'ai.agent.router')
        .map(([, payload]) => payload);
      expect(events).toHaveLength(3);
      for (const event of events) {
        expect(event.retrieval_source).toBe('lexical_local');
        expect(event.core_count).toBeGreaterThan(0);
        expect(event.prefetch_hits).toBeGreaterThan(0);
      }
      expect(events[0].loaded_count).toBeLessThan(events[1].loaded_count);
      expect(events[1].free_discovery_rounds).toBe(1);
      expect(events[2].unloaded_authorized_calls).toBe(1);
      const kept = redactTraceAttributes({
        ...events[2],
        user_text: 'no debe pasar',
      });
      expect(kept).toMatchObject({
        core_count: events[2].core_count,
        loaded_count: events[2].loaded_count,
        retrieval_source: 'lexical_local',
        prefetch_hits: events[2].prefetch_hits,
        unloaded_authorized_calls: 1,
        free_discovery_rounds: 1,
      });
      expect(kept).not.toHaveProperty('user_text');
    });

    const routerEvents = (f: ReturnType<typeof fixture>) =>
      f.emit.mock.calls
        .filter(([name]) => name === 'ai.agent.router')
        .map(([, payload]) => payload);
    const systemText = (messages: any[]) =>
      messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n');
    const fakePlaybooks = () => ({
      createSession: jest.fn(() => ({ handle: 'pb' })),
      getActiveToolDependencies: jest.fn(() => []),
      getActivePins: jest.fn(() => []),
      refreshAuthorization: jest.fn(),
      searchHybrid: jest.fn(async () => ({ results: [] })),
      load: jest.fn(() => ({ loaded: false })),
    });
    const fakeRecipes = () => ({
      createSession: jest.fn(() => ({ handle: 'rc' })),
      refreshAuthorization: jest.fn(),
      search: jest.fn(async () => ({ results: [] })),
      load: jest.fn(async () => ({ loaded: false })),
    });

    it('M1: con sesión de playbooks y recetas se ofrecen, el prompt las nombra y se ejecutan sin contar como no cargadas', async () => {
      const playbooks = fakePlaybooks();
      const recipes = fakeRecipes();
      const f = fixture(0, true, { playbooks, recipes });
      f.registry.registerMany(createPlaybookTools());
      f.registry.registerMany(createProceduralRecipeTools());
      f.chat
        .mockImplementationOnce(async (messages, options) => {
          expect(offered(options)).toEqual(
            expect.arrayContaining([
              'search_playbooks',
              'load_playbook',
              'search_recipes',
              'load_recipe',
            ]),
          );
          expect(systemText(messages)).toContain('search_playbooks(query)');
          expect(systemText(messages)).toContain('search_recipes');
          return response([
            toolCall('p1', 'search_playbooks', { query: 'cierre de caja' }),
          ]);
        })
        .mockImplementationOnce(async (_messages, options) => {
          expect(offered(options)).toContain('search_playbooks');
          return response([
            toolCall('r1', 'search_recipes', { query: 'cierre de caja' }),
          ]);
        })
        .mockResolvedValueOnce(response());
      await f.run();
      expect(playbooks.searchHybrid).toHaveBeenCalledTimes(1);
      expect(recipes.search).toHaveBeenCalledTimes(1);
      for (const event of routerEvents(f))
        expect(event.unloaded_authorized_calls).toBe(0);
    });

    it('M1: sin sesión (o sin autoridad) no se ofrecen ni se nombran en el prompt', async () => {
      const f = fixture(0, true);
      f.registry.registerMany(createPlaybookTools());
      f.registry.registerMany(createProceduralRecipeTools());
      f.chat.mockImplementationOnce(async (messages, options) => {
        for (const name of [
          'search_playbooks',
          'load_playbook',
          'search_recipes',
          'load_recipe',
        ])
          expect(offered(options)).not.toContain(name);
        expect(systemText(messages)).not.toContain('search_playbooks(query)');
        expect(systemText(messages)).not.toContain('search_recipes');
        return response();
      });
      await f.run();

      // Servicio presente pero tools sin autoridad: tampoco hay sesión ni oferta.
      const playbooks = fakePlaybooks();
      const g = fixture(0, true, { playbooks });
      g.chat.mockImplementationOnce(async (messages, options) => {
        expect(offered(options)).not.toContain('search_playbooks');
        expect(systemText(messages)).not.toContain('search_playbooks(query)');
        return response();
      });
      await g.run();
      expect(playbooks.createSession).not.toHaveBeenCalled();
    });

    it('M1: con sólo load_playbook autorizado el prompt no ordena search_playbooks', async () => {
      const playbooks = fakePlaybooks();
      const f = fixture(0, true, { playbooks });
      f.registry.registerMany(
        createPlaybookTools().filter((t) => t.name === 'load_playbook'),
      );
      f.chat.mockImplementationOnce(async (messages, options) => {
        expect(offered(options)).toContain('load_playbook');
        expect(offered(options)).not.toContain('search_playbooks');
        expect(systemText(messages)).toContain('load_playbook(id,version,section)');
        expect(systemText(messages)).not.toContain('search_playbooks');
        return response();
      });
      await f.run();
    });

    it('L1: argumentos no-objeto sobre una tool cargada por la regla dura → firma y ronda libre', async () => {
      const f = fixture(0, true);
      f.chat
        .mockResolvedValueOnce(
          response([
            {
              id: 'c1',
              type: 'function',
              function: { name: 'operation_59', arguments: '[1]' },
            },
          ]),
        )
        .mockImplementationOnce(async (messages, options) => {
          const [invalid] = toolMessages(messages);
          expect(invalid.error_code).toBe('INVALID_ARGS');
          expect(invalid.data.next_step).toContain('No necesita campos.');
          expect(invalid.data.next_step).toContain('Ya quedó cargada');
          expect(offered(options)).toContain('operation_59');
          return response([toolCall('c2', 'operation_59')]);
        })
        .mockResolvedValueOnce(response());
      const result = await f.run({ max_iterations: 1 });
      // La ronda inválida fue libre: con max_iterations 1 la llamada corregida corre.
      expect(f.handler).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Revisión preparada.');
      const events = routerEvents(f);
      expect(events[1].free_discovery_rounds).toBe(1);
      // Contada una sola vez (pre-validación robusta), no dos.
      expect(events.at(-1).unloaded_authorized_calls).toBe(1);
    });

    it('L1: esquema inválido sobre una tool cargada por la regla dura → firma y ronda libre', async () => {
      const f = fixture(0, true);
      f.registry.register({
        name: 'find_invoice',
        domain: 'billing',
        description: 'Busca una factura por número',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { number: { type: 'string' } },
          required: ['number'],
        },
        readOnly: true,
        handler: f.handler,
      });
      f.chat
        .mockImplementationOnce(async (_messages, options) => {
          expect(offered(options)).not.toContain('find_invoice');
          return response([toolCall('c1', 'find_invoice', { numero: 7 })]);
        })
        .mockImplementationOnce(async (messages) => {
          const [invalid] = toolMessages(messages);
          expect(invalid.error_code).toBe('INVALID_ARGS');
          expect(invalid.data.next_step).toContain('number (string, obligatorio)');
          return response([
            toolCall('c2', 'find_invoice', { number: 'FV-1' }),
          ]);
        })
        .mockResolvedValueOnce(response());
      await f.run({ max_iterations: 1 });
      expect(f.handler).toHaveBeenCalledTimes(1);
      expect(routerEvents(f)[1].free_discovery_rounds).toBe(1);
    });

    it('L2: una discovery fuera del núcleo (list_endpoints) no infla unloaded_authorized_calls', async () => {
      const f = fixture(0, true);
      f.chat
        .mockImplementationOnce(async (_messages, options) => {
          expect(offered(options)).not.toContain('list_endpoints');
          return response([toolCall('c1', 'list_endpoints', {})]);
        })
        .mockResolvedValueOnce(response());
      await f.run();
      for (const event of routerEvents(f))
        expect(event.unloaded_authorized_calls).toBe(0);
    });

    it('un 403 real del handler sí es bloqueo de permisos (la carga no lo enmascara)', async () => {
      const f = fixture(0, true);
      f.handler.mockRejectedValueOnce(new ForbiddenException('sin permiso'));
      f.chat
        .mockResolvedValueOnce(response([toolCall('c1', 'operation_59')]))
        .mockImplementationOnce(async (messages) => {
          expect(toolMessages(messages)[0].status).toBe('blocked');
          return response();
        });
      const result = await f.run();
      expect(f.handler).toHaveBeenCalledTimes(1);
      expect(result.execution?.outcome).toBe('blocked');
    });
  });
});
