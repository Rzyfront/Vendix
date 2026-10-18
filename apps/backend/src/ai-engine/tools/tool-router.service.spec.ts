import { AIToolRegistry } from './ai-tool-registry';
import { ToolRouterService } from './tool-router.service';
import {
  buildToolManifest,
  buildToolDocument,
  catalogHash,
  localToolRanking,
} from './tool-catalog';
import { createPlaybookTools } from './domains/playbook.tools';
import { createDiscoveryTools } from './domains/discovery.tools';
import { discoveryPage, bridgeDataPage } from './discovery-pagination';
import { RegisteredTool } from './interfaces/tool.interface';
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
    rank = jest.fn(async (query, docs, _scope, domain) => ({
      names: localToolRanking(query, docs, domain),
      degraded: [],
    }));
    router = new ToolRouterService(registry, { rank } as any);
  });
  afterAll(() => {});
  it.each(['find_coffee', 'buscar_cafe', 'CAFÉ', 'reposición'])(
    'finds ES/snake_case/exact alias %s at K12',
    async (query) => {
      const selection = await router.select(
        router.createSession(query, 'scope'),
        registry.getAllDefinitions(),
        false,
        false,
      );
      expect(selection.operationalCount).toBe(12);
      expect(selection.definitions.map((d) => d.function.name)).toContain(
        'find_coffee',
      );
      expect(selection.definitions.length).toBe(13);
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
  it('expands 12→24→40 exactly twice, not during the provider batch', async () => {
    const session = router.createSession('operation_00', 'scope');
    const auth = registry.getAllDefinitions();
    const first = await router.select(session, auth, false, false);
    const names = [...session.names];
    expect(
      JSON.parse(await router.search(session, { query: 'operation_59' }, auth))
        .enabled_next_inference,
    ).toBe(true);
    expect(session.names).toEqual(names);
    expect(first.definitions.map((d) => d.function.name)).not.toContain(
      'operation_59',
    );
    expect(
      JSON.parse(await router.search(session, { query: 'find_coffee' }, auth))
        .error,
    ).toBeTruthy();
    const second = await router.select(session, auth, false, false);
    expect(second.operationalCount).toBe(24);
    expect(second.definitions.map((d) => d.function.name)).toContain(
      'operation_59',
    );
    await router.search(session, { query: 'find_child' }, auth);
    const third = await router.select(session, auth, false, false);
    expect(third.operationalCount).toBe(40);
    expect(third.definitions.map((d) => d.function.name)).toContain(
      'find_child',
    );
    expect(
      JSON.parse(await router.search(session, { query: 'anything' }, auth))
        .expanded,
    ).toBe(false);
  });
  it('paginates discovery schemas without consuming more expansion slots and rechecks revoked names', async () => {
    const session = router.createSession('x', 's');
    const auth = registry.getAllDefinitions();
    await router.select(session, auth, false, false);
    const first = JSON.parse(
      await router.search(session, { query: 'operation_59', limit: 2 }, auth),
    );
    expect(first.results).toHaveLength(2);
    expect(first.results[0].name).toBe('operation_59');
    expect(first.total).toBe(24);
    expect(first.has_more).toBe(true);
    const count = session.expansions;
    const next = JSON.parse(
      await router.search(
        session,
        { query: 'operation_59', limit: 2, cursor: first.cursor },
        auth,
      ),
    );
    expect(next.results).toHaveLength(2);
    expect(session.expansions).toBe(count);
    const changed = auth.filter((d) => d.function.name !== 'operation_59');
    expect(
      JSON.parse(
        await router.search(
          session,
          { query: 'operation_59', cursor: first.cursor },
          changed,
        ),
      ).error_code,
    ).toBe('INVALID_DISCOVERY_PAGE');
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
    router.markUsed(session, 'operation_59');
    const selection = await router.select(
      session,
      registry.getAvailableDefinitions([]),
      false,
      false,
    );
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
    expect(result.definitions).toEqual(auth);
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
  it('falls back to authorized local lexical ranking when index is down', async () => {
    rank.mockRejectedValue(new Error('offline'));
    const result = await router.select(
      router.createSession('buscar_cafe', 's'),
      registry.getAllDefinitions(),
      false,
      false,
    );
    expect(result.degraded).toContain('router_lexical_fallback');
    expect(result.definitions.map((d) => d.function.name)).toContain(
      'find_coffee',
    );
  });

  it.each([
    {},
    { query: '' },
    { query: 'x'.repeat(501) },
    { query: 'x', domain: [] },
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
  it('C discovery stays in authorized scaffold, pins only available step tools within K12', async () => {
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
    expect(selection.operationalCount).toBe(12);
    expect(selection.definitions.map((d) => d.function.name)).toEqual(
      expect.arrayContaining([
        'search_playbooks',
        'load_playbook',
        'find_coffee',
      ]),
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
