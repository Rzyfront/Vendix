import { AIToolRegistry } from './ai-tool-registry';
import { agentToolCore, ToolRouterService } from './tool-router.service';
import {
  buildToolManifest,
  buildToolDocument,
  catalogHash,
  localToolRanking,
  localToolScores,
} from './tool-catalog';
import { TOOL_WORKING_SET } from './tool-working-set';
import { createPlaybookTools } from './domains/playbook.tools';
import { createProceduralRecipeTools } from './domains/recipe.tools';
import { createDiscoveryTools } from './domains/discovery.tools';
import { discoveryPage, bridgeDataPage } from './discovery-pagination';
import { RegisteredTool } from './interfaces/tool.interface';
import { createAccountingTools } from './domains/accounting.tools';
import { createAiToolboxTools } from './domains/ai-toolbox.tools';
import { createCashRegisterTools } from './domains/cash-register.tools';
import { createFiscalTools } from './domains/fiscal.tools';
import { createOrdersTools } from './domains/orders.tools';
import { createPaymentTools } from './domains/payments.tools';
import { createProductTools } from './domains/products.tools';
import { createReportingTools } from './domains/reporting.tools';
import { createReportTools } from './domains/reports.tools';
/** Lexical ranking over a complete index (shape of KnowledgeSearchService.rank). */
const lexicalRank = (
  query: string,
  docs: any[],
  _scope?: string,
  domain?: string,
) => ({
  names: localToolRanking(query, docs, domain),
  degraded: [] as string[],
  scores: Object.fromEntries(
    [...localToolScores(query, docs, domain)].filter(([, s]) => s > 0),
  ),
  coverage: 1,
  source: 'lexical_local',
});
const tool = (
  name: string,
  domain = 'inventory',
  description = name,
): RegisteredTool => ({
  name,
  domain,
  description,
  parameters: { type: 'object', properties: {} },
  readOnly: true,
  handler: async () => '{}',
});

describe('ToolRouterService B: relevance is not authority', () => {
  let registry: AIToolRegistry;
  let router: ToolRouterService;
  let rank: jest.Mock;
  beforeEach(() => {
    registry = new AIToolRegistry({} as any);
    registry.registerMany(createDiscoveryTools());
    for (let i = 0; i < 60; i++)
      registry.register(tool(`operation_${String(i).padStart(2, '0')}`));
    registry.register(
      tool(
        'find_coffee',
        'inventory',
        'Busca café tostado, bodega y reposición',
      ),
    );
    registry.register(tool('find_child', 'customers', 'Buscar niño y niña'));
    registry.registerAlias('buscar_cafe', 'find_coffee');
    rank = jest.fn(async (query, docs, scope, domain) =>
      lexicalRank(query, docs, scope, domain),
    );
    router = new ToolRouterService(registry, { rank } as any);
  });
  afterAll(() => {});
  it.each(['find_coffee', 'buscar_cafe', 'CAFÉ', 'reposición'])(
    'loads ES/snake_case/alias %s right after the core, not the whole catalog',
    async (query) => {
      const all = registry.getAllDefinitions();
      const selection = await router.select(
        router.createSession(query, 'scope'),
        all,
        false,
        false,
      );
      expect(selection.loadedCount).toBeGreaterThan(0);
      expect(selection.definitions[selection.coreCount].function.name).toBe(
        'find_coffee',
      );
      expect(selection.operationalCount).toBeLessThanOrEqual(
        TOOL_WORKING_SET.maxLoaded,
      );
      expect(selection.definitions.length).toBeLessThan(all.length);
    },
  );
  it('keeps ñ distinct from n', () => {
    const docs = [
      buildToolDocument(tool('a', 'd', 'año fiscal')),
      buildToolDocument(tool('b', 'd', 'ano campo')),
    ];
    expect(localToolRanking('año', docs)[0]).toBe('a');
    expect(localToolRanking('ano', docs)[0]).toBe('b');
  });
  it('search_tools loads its results for the next inference, append-only', async () => {
    const session = router.createSession('operation_00', 'scope');
    const auth = registry.getAllDefinitions();
    const first = await router.select(session, auth, false, false);
    const names = first.definitions.map((d) => d.function.name);
    expect(names).not.toContain('find_coffee');
    const found = JSON.parse(
      await router.search(session, { query: 'find_coffee' }, auth),
    );
    expect(found.results[0].name).toBe('find_coffee');
    expect(found.next_step).toMatch(/cargadas/);
    const second = await router.select(session, auth, false, false);
    const after = second.definitions.map((d) => d.function.name);
    // The previous list is an untouched prefix: loads only append (cache).
    expect(after.slice(0, names.length)).toEqual(names);
    expect(after).toContain('find_coffee');
  });
  it('search loads 5 by default and at most 10; a larger limit is rejected', async () => {
    const session = router.createSession('x', 's');
    const auth = registry.getAllDefinitions();
    await router.select(session, auth, false, false);
    const before = session.loaded.length;
    const first = JSON.parse(
      await router.search(session, { query: 'operation' }, auth),
    );
    expect(first.results).toHaveLength(TOOL_WORKING_SET.searchDefault);
    expect(session.loaded.length - before).toBe(TOOL_WORKING_SET.searchDefault);
    const ten = JSON.parse(
      await router.search(session, { query: 'operation', limit: 10 }, auth),
    );
    expect(ten.results).toHaveLength(10);
    expect(
      JSON.parse(
        await router.search(session, { query: 'operation', limit: 11 }, auth),
      ).error_code,
    ).toBe('INVALID_ARGS');
  });
  it('pins used tools and authorized dependencies, never a deny', async () => {
    registry.register({
      ...tool('prepare'),
      discovery: { dependencies: ['find_coffee', 'restricted'] },
    });
    registry.register({
      ...tool('restricted', 'admin', 'SECRET DESCRIPTION'),
      requiredPermissions: ['admin'],
    });
    const session = router.createSession('prepare', 'sig', ['prepare']);
    const available = registry.getAvailableDefinitions([]);
    router.markUsed(session, 'operation_59', available);
    const selection = await router.select(session, available, false, false);
    expect(selection.definitions.map((d) => d.function.name)).toEqual(
      expect.arrayContaining(['prepare', 'find_coffee', 'operation_59']),
    );
    expect(JSON.stringify(selection)).not.toContain('SECRET DESCRIPTION');
  });
  it('re-filters cached/pinned names after permission/agent/plan/caller changes', async () => {
    const session = router.createSession('find_coffee', 'sig');
    await router.select(session, registry.getAllDefinitions(), false, false);
    router.markUsed(session, 'find_coffee');
    const auth = registry
      .getAllDefinitions()
      .filter((d) => d.function.name !== 'find_coffee');
    expect(
      (await router.select(session, auth, false, false)).definitions.map(
        (d) => d.function.name,
      ),
    ).not.toContain('find_coffee');
  });
  it('does not reintroduce discovery or business tools through scaffold exceptions', async () => {
    const auth = registry.getAgentDefinitions([], {
      allowed_tools: ['inventory'],
      denied_tools: ['find_coffee'],
    });
    const result = await router.select(
      router.createSession('café', 's'),
      auth,
      false,
      false,
    );
    expect(result.degraded).toContain('discovery_not_authorized');
    expect(result.definitions.map((d) => d.function.name).sort()).toEqual(
      auth.map((d) => d.function.name).sort(),
    );
    expect(JSON.stringify(result)).not.toContain('find_coffee');
    expect(JSON.stringify(result)).not.toContain('search_tools');
  });
  it('loads only minimum planning bodies until a plan exists', async () => {
    ['propose_plan', 'ask_user', 'update_plan_step'].forEach((name) =>
      registry.register(tool(name, 'planning')),
    );
    const session = router.createSession('plan', 's');
    const auth = registry.getAllDefinitions();
    expect(
      (await router.select(session, auth, false, false)).definitions.map(
        (d) => d.function.name,
      ),
    ).not.toContain('propose_plan');
    const hook = await router.select(session, auth, true, false);
    expect(hook.definitions.map((d) => d.function.name)).toEqual(
      expect.arrayContaining(['propose_plan', 'ask_user']),
    );
    expect(hook.definitions.map((d) => d.function.name)).not.toContain(
      'update_plan_step',
    );
    expect(
      (await router.select(session, auth, true, true)).definitions.map(
        (d) => d.function.name,
      ),
    ).toContain('update_plan_step');
  });
  it('index down → full authorized catalog (cascade floor), never fewer tools', async () => {
    rank.mockRejectedValue(new Error('offline'));
    const all = registry.getAllDefinitions();
    const result = await router.select(
      router.createSession('buscar_cafe', 's'),
      all,
      false,
      false,
    );
    expect(result.degraded).toEqual(
      expect.arrayContaining(['router_error', 'full_catalog_fallback']),
    );
    expect(result.definitions).toHaveLength(all.length);
  });
  it('index coverage under 90 % → full authorized catalog', async () => {
    rank.mockImplementation(async (query, docs) => ({
      ...lexicalRank(query, docs),
      coverage: 0.5,
    }));
    const all = registry.getAllDefinitions();
    const result = await router.select(
      router.createSession('find_coffee', 's'),
      all,
      false,
      false,
    );
    expect(result.retrievalSource).toBe('full_catalog_fallback');
    expect(result.definitions).toHaveLength(all.length);
  });
  it('a hung search times out to the full catalog instead of blocking the turn', async () => {
    jest.useFakeTimers();
    try {
      rank.mockImplementation(() => new Promise(() => undefined));
      const all = registry.getAllDefinitions();
      const pending = router.select(
        router.createSession('find_coffee', 's'),
        all,
        false,
        false,
      );
      await jest.advanceTimersByTimeAsync(TOOL_WORKING_SET.prefetchTimeoutMs);
      const result = await pending;
      expect(result.degraded).toContain('router_timeout');
      expect(result.definitions).toHaveLength(all.length);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    {},
    { query: '' },
    { query: 'x'.repeat(501) },
    { query: 'x', domain: [] },
    { query: 'x', limit: 0 },
    { query: 'x', limit: 11 },
  ])('rejects malformed search %j', async (args) => {
    expect(
      JSON.parse(
        await router.search(
          router.createSession('x', 's'),
          args,
          registry.getAllDefinitions(),
        ),
      ).error_code,
    ).toBe('INVALID_ARGS');
  });
  it('hashes schema/aliases/permissions/descriptions, not registration order', () => {
    const first = buildToolManifest(registry);
    const reversed = new AIToolRegistry({} as any);
    reversed.registerMany(registry.getAll().reverse());
    reversed.registerAlias('buscar_cafe', 'find_coffee');
    expect(buildToolManifest(reversed).hash).toBe(first.hash);
    registry.registerAlias('rare_alias', 'find_coffee');
    expect(buildToolManifest(registry).hash).not.toBe(first.hash);
    expect(
      first.documents.filter((d) => d.name === 'find_coffee'),
    ).toHaveLength(1);
    expect(first.documents.find((d) => d.name === 'find_coffee')?.key).toBe(
      'tool:find_coffee:1',
    );
    expect(catalogHash({ a: 1, b: 2 })).toBe(catalogHash({ b: 2, a: 1 }));
  });
  it('validates synthetic examples/pure preflight but never handler or preview', () => {
    const handler = jest.fn();
    const preview = jest.fn();
    const preflight = jest.fn(() => true);
    const base = {
      ...tool('x'),
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer' } },
        required: ['id'],
      },
      handler,
      preview,
    };
    buildToolDocument({
      ...base,
      discovery: {
        preflight,
        examples: [{ intent: 'Leer ejemplo', arguments: { id: 1 } }],
      },
    });
    expect(preflight).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(() =>
      buildToolDocument({
        ...base,
        discovery: { examples: [{ intent: 'mal', arguments: { id: 'bad' } }] },
      }),
    ).toThrow('INVALID_CATALOG_EXAMPLE');
    expect(() =>
      buildToolDocument({
        ...base,
        parameters: {
          type: 'object',
          properties: {
            ids: { type: 'array', minItems: 2, items: { type: 'integer' } },
          },
          required: ['ids'],
        },
        discovery: {
          examples: [{ intent: 'Invalid full schema', arguments: { ids: [] } }],
        },
      }),
    ).toThrow();
    expect(() =>
      buildToolDocument({
        ...base,
        discovery: {
          examples: [
            { intent: 'secret', arguments: { id: 1, password: 'secret' } },
          ],
        },
      }),
    ).toThrow();
  });
  it('C discovery stays in authorized scaffold and never offers unauthorized names', async () => {
    registry.registerMany(createPlaybookTools());
    const session = router.createSession('operation_00', 'scope', [
      'find_coffee',
      'not_authorized',
    ]);
    const selection = await router.select(
      session,
      registry.getAllDefinitions(),
      false,
      false,
    );
    // Playbook discovery is out of the core (callable via the hard rule).
    expect(selection.definitions.map((d) => d.function.name)).toEqual(
      expect.arrayContaining(['search_tools', 'operation_00', 'find_coffee']),
    );
    expect(selection.definitions.map((d) => d.function.name)).not.toContain(
      'load_playbook',
    );
    expect(selection.definitions.map((d) => d.function.name)).not.toContain(
      'not_authorized',
    );
    const denied = await router.select(
      router.createSession('operation_00', 'denied'),
      registry
        .getAllDefinitions()
        .filter((d) => d.function.name !== 'load_playbook'),
      false,
      false,
    );
    expect(denied.definitions.map((d) => d.function.name)).not.toContain(
      'load_playbook',
    );
  });
});
describe('ToolRouterService M1/L2/L3: discovery con sesión, contador y sesiones legadas', () => {
  let registry: AIToolRegistry;
  let router: ToolRouterService;
  const names = (s: { definitions: { function: { name: string } }[] }) =>
    s.definitions.map((d) => d.function.name);
  const SESSION_TOOLS = [
    'search_playbooks',
    'load_playbook',
    'search_recipes',
    'load_recipe',
  ];
  beforeEach(() => {
    registry = new AIToolRegistry({} as any);
    registry.registerMany(createDiscoveryTools());
    registry.registerMany(createPlaybookTools());
    registry.registerMany(createProceduralRecipeTools());
    for (let i = 0; i < 40; i++)
      registry.register(tool(`operation_${String(i).padStart(2, '0')}`));
    router = new ToolRouterService(registry, {
      rank: jest.fn(async (q, docs, scope, domain) =>
        lexicalRank(q, docs, scope, domain),
      ),
    } as any);
  });

  it('M1: sin sesión, playbooks y recetas no se ofrecen ni se cargan', async () => {
    const session = router.createSession('operation_00', 's');
    const auth = registry.getAllDefinitions();
    const selection = await router.select(session, auth, false, false);
    for (const name of SESSION_TOOLS)
      expect(names(selection)).not.toContain(name);
    expect(router.load(session, SESSION_TOOLS, auth)).toEqual([]);
  });

  it('M1: con playbookSession/recipeSession se ofrecen en el núcleo, estable y ∩ autoridad', async () => {
    const session = router.createSession('operation_00', 's');
    router.enableSessionDiscovery(session, { playbooks: true, recipes: true });
    const auth = registry.getAllDefinitions();
    const first = await router.select(session, auth, false, false);
    const core = names(first).slice(0, first.coreCount);
    expect(core).toEqual(expect.arrayContaining(SESSION_TOOLS));
    // El núcleo sigue ordenado por nombre (prefijo cacheable).
    expect(core).toEqual([...core].sort((a, b) => a.localeCompare(b)));
    expect(router.isLoaded(session, 'load_playbook')).toBe(true);
    expect(router.isUnloadedOperational(session, 'search_recipes')).toBe(false);
    // Otra ronda: mismo prefijo.
    const second = await router.select(session, auth, false, false);
    expect(names(second).slice(0, second.coreCount)).toEqual(core);
  });

  it('M1: sólo los de la sesión existente; sin autoridad no se ofrecen', async () => {
    const session = router.createSession('operation_00', 's');
    router.enableSessionDiscovery(session, { playbooks: true });
    const auth = registry
      .getAllDefinitions()
      .filter((d) => d.function.name !== 'load_playbook');
    const selection = await router.select(session, auth, false, false);
    expect(names(selection)).toContain('search_playbooks');
    expect(names(selection)).not.toContain('load_playbook');
    expect(names(selection)).not.toContain('search_recipes');
    expect(names(selection)).not.toContain('load_recipe');
    expect(router.load(session, ['load_playbook'], auth)).toEqual([]);
  });

  it('M1: enableSessionDiscovery no admite nombres ajenos a playbooks/recetas', async () => {
    const session = router.createSession('operation_00', 's');
    session.sessionDiscovery = ['list_endpoints', 'search_playbooks'];
    const auth = registry.getAllDefinitions();
    const selection = await router.select(session, auth, false, false);
    expect(names(selection)).toContain('search_playbooks');
    expect(names(selection)).not.toContain('list_endpoints');
    expect(router.load(session, ['list_endpoints'], auth)).toEqual([]);
  });

  it('M1: load() no duplica en `loaded` la discovery de la sesión (ya es núcleo) y sin autoridad la rechaza', () => {
    const session = router.createSession('operation_00', 's');
    router.enableSessionDiscovery(session, { recipes: true });
    const auth = registry.getAllDefinitions();
    // En el núcleo: ya ofrecida, load no la duplica en `loaded`.
    expect(router.load(session, ['load_recipe'], auth)).toEqual([]);
    expect(router.isLoaded(session, 'load_recipe')).toBe(true);
    // Sin autoridad sigue fuera.
    expect(
      router.load(
        session,
        ['load_recipe'],
        auth.filter((d) => d.function.name !== 'load_recipe'),
      ),
    ).toEqual([]);
  });

  it('M1: con fullCatalog el orden y el conjunto no cambian por tener sesión', async () => {
    const auth = registry.getAllDefinitions();
    const plain = router.createSession('operation_00', 's');
    plain.fullCatalog = 'router_error';
    plain.prefetched = true;
    const withSessions = router.createSession('operation_00', 's');
    withSessions.fullCatalog = 'router_error';
    withSessions.prefetched = true;
    router.enableSessionDiscovery(withSessions, {
      playbooks: true,
      recipes: true,
    });
    router.markUsed(withSessions, 'search_playbooks', auth);
    router.markUsed(plain, 'search_playbooks', auth);
    const a = await router.select(plain, auth, false, false);
    const b = await router.select(withSessions, auth, false, false);
    expect(names(b)).toEqual(names(a));
    expect(b.coreCount).toBe(a.coreCount);
    expect(withSessions.loaded).not.toContain('search_playbooks');
  });

  it('L2: discovery fuera del núcleo no cuenta como llamada autorizada no cargada', () => {
    const session = router.createSession('operation_00', 's');
    expect(router.isUnloadedOperational(session, 'list_endpoints')).toBe(false);
    expect(router.isUnloadedOperational(session, 'search_playbooks')).toBe(
      false,
    );
    expect(router.isUnloadedOperational(session, 'operation_39')).toBe(true);
    expect(router.isUnloadedOperational(session, 'search_tools')).toBe(false);
  });

  it('L3: una sesión persistida con la forma de #934 (sin loaded/used) no da TypeError', async () => {
    const legacy = JSON.parse(
      JSON.stringify({
        query: 'operation_00',
        signature: 's',
        dependencies: [],
        unloadedAuthorizedCalls: 0,
      }),
    );
    const auth = registry.getAllDefinitions();
    expect(router.isLoaded(legacy, 'operation_39')).toBe(false);
    expect(() => router.markUsed(legacy, 'operation_39', auth)).not.toThrow();
    expect(legacy.loaded).toContain('operation_39');
    expect(legacy.used).toContain('operation_39');
    const selection = await router.select(legacy, auth, false, false);
    expect(names(selection)).toContain('operation_39');
    const bare: any = { query: 'x', signature: 's' };
    expect(router.restore(bare)).toMatchObject({
      loaded: [],
      used: [],
      dependencies: [],
      unloadedAuthorizedCalls: 0,
    });
    expect(router.load(bare, ['operation_01'], auth)).toEqual(['operation_01']);
  });
});
describe('ToolRouterService (d): cierre de caja en lenguaje coloquial', () => {
  // Regresión prod (hotfix Vexi): "me ayudas a analizar un cierre de caja que
  // no me dio?" empataba las lecturas de caja con tools fiscales/contables y
  // ai_summarize; el modelo pedía lecturas no ofrecidas (TOOL_NOT_OFFERED) y el
  // chip mostraba "4 no se pudieron". Fábricas REALES, ranking léxico local.
  const QUERY = 'Oe me ayudas a analizar un cierre de caja que no me dio?';
  const CASH_READS = [
    'get_active_cash_session',
    'get_cash_session_close_report',
    'get_cash_session_status',
    'list_cash_session_movements',
    'list_cash_sessions',
  ];
  let registry: AIToolRegistry;
  let router: ToolRouterService;
  beforeEach(() => {
    const deps = {} as any;
    registry = new AIToolRegistry(deps);
    registry.registerMany(createDiscoveryTools());
    for (const factory of [
      createAccountingTools,
      createAiToolboxTools,
      createCashRegisterTools,
      createFiscalTools,
      createOrdersTools,
      createPaymentTools,
      createProductTools,
      createReportingTools,
      createReportTools,
    ])
      registry.registerMany(factory(deps));
    router = new ToolRouterService(registry, {
      rank: jest.fn(async (query, docs, scope, domain) =>
        lexicalRank(query, docs, scope, domain),
      ),
    } as any);
  });

  it('(d) carga las lecturas de caja de primeras tras el núcleo, sin search_tools', async () => {
    const session = router.createSession(QUERY, 'scope');
    const all = registry.getAllDefinitions();
    const selection = await router.select(session, all, false, false);
    const names = selection.definitions.map((d) => d.function.name);
    expect(names.length).toBeLessThan(all.length);
    const core = names.slice(0, selection.coreCount);
    expect(core).toEqual(
      expect.arrayContaining(
        [...agentToolCore('vexi')].filter((n) => names.includes(n)),
      ),
    );
    const loaded = names.slice(selection.coreCount);
    expect([...loaded.slice(0, CASH_READS.length)].sort()).toEqual(CASH_READS);
  });

  it('(d) las lecturas de caja encabezan el ranking, por delante de escrituras y de otros dominios', () => {
    const docs = buildToolManifest(registry).documents;
    const top = localToolRanking(QUERY, docs).slice(0, CASH_READS.length);
    expect([...top].sort()).toEqual(CASH_READS);
    expect(top.every((name) => registry.get(name)?.readOnly === true)).toBe(
      true,
    );
  });

  it('(d) usar list_cash_sessions fija el reporte de cierre y los movimientos como dependencias', async () => {
    const session = router.createSession('operation', 'scope');
    const all = registry.getAllDefinitions();
    router.markUsed(session, 'list_cash_sessions', all);
    const selection = await router.select(session, all, false, false);
    expect(selection.definitions.map((d) => d.function.name)).toEqual(
      expect.arrayContaining([
        'list_cash_sessions',
        'get_cash_session_close_report',
        'list_cash_session_movements',
      ]),
    );
  });

  it('(d) una tool autorizada no cargada queda cargada al ejecutarse (regla dura)', async () => {
    const auth = registry.getAllDefinitions();
    const session = router.createSession('producto', 'scope');
    const first = await router.select(session, auth, false, false);
    expect(first.definitions.map((d) => d.function.name)).not.toContain(
      'get_cash_session_close_report',
    );
    expect(router.isLoaded(session, 'get_cash_session_close_report')).toBe(
      false,
    );
    router.markUsed(session, 'get_cash_session_close_report', auth);
    const next = await router.select(session, auth, false, false);
    expect(next.definitions.map((d) => d.function.name)).toContain(
      'get_cash_session_close_report',
    );
  });

  it('(d) nunca ofrece una tool fuera de la autoridad del turno', async () => {
    const auth = registry
      .getAllDefinitions()
      .filter((d) => d.function.name !== 'list_cash_session_movements');
    const session = router.createSession(QUERY, 'scope', [], undefined, {
      history: ['list_cash_session_movements'],
    });
    router.markUsed(
      session,
      'list_cash_session_movements',
      registry.getAllDefinitions(),
    );
    const selection = await router.select(session, auth, false, false);
    expect(selection.definitions.map((d) => d.function.name)).not.toContain(
      'list_cash_session_movements',
    );
    expect(
      JSON.parse(
        await router.search(
          session,
          { query: 'list_cash_session_movements' },
          auth,
        ),
      ).results.map((r: { name: string }) => r.name),
    ).not.toContain('list_cash_session_movements');
  });
});
describe('Discovery pagination B', () => {
  it('returns whole rows and stable total/has_more/cursor', () => {
    const rows = Array.from({ length: 8 }, (_, id) => ({ id }));
    const first = discoveryPage(rows, { limit: 3 }, 's');
    expect(first.total).toBe(8);
    expect(first.has_more).toBe(true);
    expect(
      discoveryPage(rows, { limit: 3, cursor: first.cursor }, 's').data.map(
        (r) => r.id,
      ),
    ).toEqual([3, 4, 5]);
    expect(() =>
      discoveryPage(rows.slice(1), { cursor: first.cursor }, 's'),
    ).toThrow('Cursor');
  });
  it.each([-1, 0, 1.5, 21, NaN])('rejects invalid limit %s', (limit) =>
    expect(() => discoveryPage([], { limit }, 's')).toThrow(),
  );
  it('retains upstream pagination, never claims complete', () => {
    const body = JSON.stringify({
      data: {
        items: Array.from({ length: 8 }, (_, id) => ({ id })),
        pagination: { total: 50, page: 1 },
      },
    });
    const first = JSON.parse(bridgeDataPage(body, {}, 'store/items'));
    expect(first.data).toHaveLength(3);
    expect(first.total).toBe(8);
    expect(first.source_total).toBe(50);
    expect(first.complete).toBe(false);
    expect(
      JSON.parse(
        bridgeDataPage(body, { result_cursor: first.cursor }, 'store/items'),
      ).data[0].id,
    ).toBe(3);
  });
  it('does not pretend a huge scalar/row or unstructured string is a page', () => {
    expect(
      JSON.parse(bridgeDataPage('x'.repeat(7000), {}, 'p')).error_code,
    ).toBe('UNSTRUCTURED_RESPONSE');
    expect(
      JSON.parse(
        bridgeDataPage(JSON.stringify({ big: 'x'.repeat(7000) }), {}, 'p'),
      ).error_code,
    ).toBe('DETAIL_CONTRACT_REQUIRED');
    expect(
      JSON.parse(
        bridgeDataPage(
          JSON.stringify([{ id: 4, big: 'x'.repeat(7000) }]),
          {},
          'p',
        ),
      ).data[0].omitted_large_row,
    ).toBe(true);
  });
});
