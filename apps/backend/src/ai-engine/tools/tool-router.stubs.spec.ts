import { AIToolRegistry } from './ai-tool-registry';
import { ToolRouterService } from './tool-router.service';
import { localToolRanking, localToolScores } from './tool-catalog';
import { createDiscoveryTools } from './domains/discovery.tools';
import { RegisteredTool } from './interfaces/tool.interface';
import { coreDiscovery, toolDiscoveryStubsEnabled } from './tool-working-set';

const lexicalRank = (query: string, docs: any[], _s?: string, d?: string) => ({
  names: localToolRanking(query, docs, d),
  degraded: [] as string[],
  scores: Object.fromEntries(
    [...localToolScores(query, docs, d)].filter(([, s]) => s > 0),
  ),
  coverage: 1,
  source: 'lexical_local',
});

const tool = (
  name: string,
  description: string,
  readOnly: boolean,
  domain = 'inventory',
): RegisteredTool => ({
  name,
  access: 'public',
  accessReason: 'test fixture',
  domain,
  description,
  parameters: {
    type: 'object',
    properties: { sku: { type: 'string', description: 'Código del producto' } },
    required: ['sku'],
  },
  readOnly,
  handler: async () => '{}',
});

describe('F10/T61 tool stubs and the discovery switch', () => {
  const original = process.env.AI_TOOL_DISCOVERY_STUBS;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_TOOL_DISCOVERY_STUBS;
    else process.env.AI_TOOL_DISCOVERY_STUBS = original;
  });

  const build = () => {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(createDiscoveryTools());
    registry.register(
      tool(
        'find_coffee',
        'Busca café tostado en bodega. Devuelve existencias por sede.',
        true,
      ),
    );
    registry.register(
      tool('adjust_coffee_stock', 'Ajusta el stock de café tostado.', false),
    );
    registry.register(
      tool(
        'payroll_secret',
        'Liquida nómina secreta de café.',
        true,
        'payroll',
      ),
    );
    const router = new ToolRouterService(registry, {
      rank: jest.fn(async (q: string, docs: any[], s?: string, d?: string) =>
        lexicalRank(q, docs, s, d),
      ),
    } as any);
    return { registry, router };
  };
  const authorizedFor = (registry: AIToolRegistry) =>
    registry
      .getAllDefinitions()
      .filter((d) => d.function.name !== 'payroll_secret');

  it('the switch is true only for the literal "true"', () => {
    expect(toolDiscoveryStubsEnabled({})).toBe(false);
    expect(toolDiscoveryStubsEnabled({ AI_TOOL_DISCOVERY_STUBS: '1' })).toBe(
      false,
    );
    expect(toolDiscoveryStubsEnabled({ AI_TOOL_DISCOVERY_STUBS: 'true' })).toBe(
      true,
    );
  });

  it('switch off: core without describe_tool, select output identical and no stubs key', async () => {
    delete process.env.AI_TOOL_DISCOVERY_STUBS;
    expect(coreDiscovery()).not.toContain('describe_tool');
    const { registry, router } = build();
    expect(registry.get('describe_tool')).toBeUndefined();
    const auth = authorizedFor(registry);
    const selection = await router.select(
      router.createSession('café', 'scope'),
      auth,
      false,
      false,
    );
    expect(selection).not.toHaveProperty('stubs');
    expect(selection.definitions.map((d) => d.function.name)).toContain(
      'find_coffee',
    );
    expect(selection.definitions.map((d) => d.function.name)).not.toContain(
      'describe_tool',
    );
  });

  it('switch on: describe_tool joins the core', () => {
    process.env.AI_TOOL_DISCOVERY_STUBS = 'true';
    expect(coreDiscovery()).toContain('describe_tool');
  });

  it('stub level: the preload arrives as cards without schema, in read/write terms', async () => {
    process.env.AI_TOOL_DISCOVERY_STUBS = 'true';
    const { registry, router } = build();
    const auth = authorizedFor(registry);
    const selection = await router.select(
      router.createSession('café', 'scope'),
      auth,
      false,
      false,
      { stubs: true },
    );
    const offered = selection.definitions.map((d) => d.function.name);
    expect(offered).toContain('describe_tool');
    expect(offered).not.toContain('find_coffee');
    expect(selection.stubs).toEqual(
      expect.arrayContaining([
        {
          name: 'find_coffee',
          one_line: 'Busca café tostado en bodega.',
          access: 'read',
        },
        {
          name: 'adjust_coffee_stock',
          one_line: 'Ajusta el stock de café tostado.',
          access: 'write',
        },
      ]),
    );
    for (const stub of selection.stubs!)
      expect(Object.keys(stub).sort()).toEqual(['access', 'name', 'one_line']);
  });

  it('a tool the role lacks never shows in search, stubs, index or the offered list', async () => {
    process.env.AI_TOOL_DISCOVERY_STUBS = 'true';
    const { registry, router } = build();
    const auth = authorizedFor(registry);
    const session = router.createSession('nómina café', 'scope');
    const selection = await router.select(session, auth, false, false, {
      stubs: true,
    });
    const found = await router.search(session, { query: 'nómina' }, auth);
    const index = router.buildToolIndexDigest(auth);
    for (const text of [
      JSON.stringify(selection.stubs),
      JSON.stringify(selection.definitions),
      found,
      index,
    ])
      expect(text).not.toContain('payroll_secret');
  });

  it('hard rule intact: an authorized tool that was not preloaded is still callable', async () => {
    process.env.AI_TOOL_DISCOVERY_STUBS = 'true';
    const { registry, router } = build();
    const auth = authorizedFor(registry);
    const session = router.createSession('ajusta stock', 'scope');
    await router.select(session, auth, false, false, { stubs: true });
    expect(router.isUnloadedOperational(session, 'find_coffee')).toBe(true);
    expect(router.markUsed(session, 'find_coffee', auth)).toEqual([
      'find_coffee',
    ]);
    expect(router.isLoaded(session, 'find_coffee')).toBe(true);
  });
});
