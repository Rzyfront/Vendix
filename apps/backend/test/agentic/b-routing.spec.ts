import { isAgentPlanTool } from '../../src/ai-engine/interfaces/agent-plan.interface';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import { loadCorpus } from './runner';
import { AIToolRegistry } from '../../src/ai-engine/tools/ai-tool-registry';
import { ToolRouterService } from '../../src/ai-engine/tools/tool-router.service';
import {
  buildToolManifest,
  localToolRanking,
} from '../../src/ai-engine/tools/tool-catalog';
import * as factories from '../../src/ai-engine/tools';
import { createDiscoveryTools } from '../../src/ai-engine/tools/domains/discovery.tools';

const corpus = loadCorpus(resolve(__dirname, 'requests.es.jsonl'));
const reports: Array<{
  case_id: string;
  authorized_count: number;
  offered_count: number;
  estimated_definition_reduction: number;
}> = [];
let registry: AIToolRegistry;

beforeAll(() => {
  registry = new AIToolRegistry({} as any);
  // Factory declarations ONLY, with inert dependencies, not a deployed bootstrap snapshot.
  for (const [name, factory] of Object.entries(factories)) {
    if (name.startsWith('create') && typeof factory === 'function')
      registry.registerMany(
        (factory as Function)({
          embeddingService: { isAvailable: () => true },
        }),
      );
  }
  registry.registerMany(createDiscoveryTools());
  registry.register({
    name: 'restricted_probe',
    domain: 'private',
    description: 'MUST_NOT_LEAK_PRIVATE_CATALOG',
    parameters: {},
    requiredPermissions: ['never_granted'],
  });
});
afterAll(() => {
  if (process.env.AGENTIC_B_REPORT)
    writeFileSync(
      process.env.AGENTIC_B_REPORT,
      JSON.stringify(
        {
          mode: 'offline_contract_only',
          product_executions: 0,
          provider_calls: 0,
          measured_recall_at_12: null,
          measured_recall_at_24: null,
          measured_definition_tokens: null,
          measured_end_to_end_latency: null,
          measured_provider_cost: null,
          manifest_hash: buildToolManifest(registry).hash,
          factory_document_count: registry.getAll().length,
          cases: reports,
          note: 'Character/4 proxy is NOT provider tokens. No independently graded real task executions or runtime latency/cost measurements.',
        },
        null,
        2,
      ),
    );
});

describe('B 50-case corpus routing contract (NOT a measured product baseline)', () => {
  it.each(corpus.map((c) => [c.id, c] as const))(
    'case %s offers the whole authorized catalog and never unauthorized/restricted tools, even with embeddings degraded',
    async (_id, c) => {
      const permitted = registry
        .getAll()
        .filter(
          (t) =>
            c.persona !== 'revoked-operator' &&
            (c.persona !== 'operator' || t.readOnly),
        );
      const permissions = [
        ...new Set(
          permitted.flatMap((t) =>
            t.name === 'restricted_probe' ? [] : (t.requiredPermissions ?? []),
          ),
        ),
      ];
      const auth = registry.getAvailableDefinitions(permissions);
      const search = {
        rank: async (
          q: string,
          docs: any[],
          _scope: string,
          domain?: string,
        ) => ({
          names: localToolRanking(q, docs, domain),
          degraded: ['vector_unavailable'],
        }),
      };
      const router = new ToolRouterService(registry, search as any);
      const session = router.createSession(
        c.request,
        router.signature([c.scope, c.persona]),
      );
      const selected = await router.select(session, auth, false, false);
      const allowed = new Set(auth.map((d) => d.function.name));
      expect(
        selected.definitions.every((d) => allowed.has(d.function.name)),
      ).toBe(true);
      expect(JSON.stringify(selected)).not.toContain('MUST_NOT_LEAK');
      // Fix router 2026-10: relevance orders, never excludes. The whole
      // authorized catalog (minus plan tools without a hook) is offered.
      expect(selected.definitions).toHaveLength(
        auth.filter((d) => !isAgentPlanTool(d.function.name)).length,
      );
      expect(selected.degraded).toContain('vector_unavailable');
      reports.push({
        case_id: c.id,
        authorized_count: auth.length,
        offered_count: selected.definitions.length,
        estimated_definition_reduction:
          1 -
          JSON.stringify(selected.definitions).length /
            JSON.stringify(auth).length,
      });
    },
  );
  it('builds stable integer-document keys and one canonical version per real factory declaration', () => {
    const manifest = buildToolManifest(registry);
    expect(manifest.documents.length).toBeGreaterThan(150);
    expect(new Set(manifest.documents.map((d) => d.key)).size).toBe(
      manifest.documents.length,
    );
    expect(
      manifest.documents.every((d) => d.key === `tool:${d.name}:${d.version}`),
    ).toBe(true);
    expect(buildToolManifest(registry).hash).toBe(manifest.hash);
  });
});

describe('F10/T62 golden routing: progressive discovery stubs', () => {
  const original = process.env.AI_TOOL_DISCOVERY_STUBS;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_TOOL_DISCOVERY_STUBS;
    else process.env.AI_TOOL_DISCOVERY_STUBS = original;
  });
  const tool = (name: string, description: string, readOnly: boolean) => ({
    name,
    access: 'public' as const,
    accessReason: 'golden fixture',
    domain: 'inventory',
    description,
    parameters: { type: 'object', properties: {} },
    readOnly,
    handler: async () => '{}',
  });
  const build = () => {
    const local = new AIToolRegistry({} as any);
    local.registerMany(createDiscoveryTools());
    local.register(
      tool('list_products', 'Lista productos con su stock. Filtra por sede.', true),
    );
    local.register(tool('adjust_stock', 'Ajusta el stock de un producto.', false));
    local.register({
      ...tool('payroll_close', 'Cierra la nómina del mes.', false),
      domain: 'payroll',
    });
    const router = new ToolRouterService(local, {
      rank: async (q: string, docs: any[], _s: string, domain?: string) => ({
        names: localToolRanking(q, docs, domain),
        degraded: [],
        scores: { list_products: 1, adjust_stock: 0.9 },
        coverage: 1,
        source: 'golden',
      }),
    } as any);
    const authorized = local
      .getAllDefinitions()
      .filter((d) => d.function.name !== 'payroll_close');
    return { local, router, authorized };
  };

  it('stubs on: the preload is a one-line stub, not a definition', async () => {
    process.env.AI_TOOL_DISCOVERY_STUBS = 'true';
    const { router, authorized } = build();
    const selected = await router.select(
      router.createSession('productos con stock', 'scope'),
      authorized,
      false,
      false,
      { stubs: true },
    );
    const offered = selected.definitions.map((d) => d.function.name);
    expect(offered).toContain('describe_tool');
    expect(offered).not.toContain('list_products');
    expect(selected.stubs).toEqual(
      expect.arrayContaining([
        {
          name: 'list_products',
          one_line: 'Lista productos con su stock.',
          access: 'read',
        },
      ]),
    );
    expect(JSON.stringify(selected)).not.toContain('payroll_close');
  });

  it('stubs on: describe_tool of a tool the role lacks answers «Tu rol no permite…» and leaks nothing', async () => {
    process.env.AI_TOOL_DISCOVERY_STUBS = 'true';
    const { router, authorized } = build();
    const denied = JSON.parse(
      router.describe({ name: 'payroll_close' }, authorized),
    );
    expect(denied.error).toMatch(/^Tu rol no permite/);
    expect(JSON.stringify(denied)).not.toContain('nómina');
    const allowed = JSON.parse(
      router.describe({ name: 'list_products' }, authorized),
    );
    expect(allowed.access).toBe('read');
  });

  it('switch off: the same request gets the pre-F10 offer, no stubs and no describe_tool', async () => {
    delete process.env.AI_TOOL_DISCOVERY_STUBS;
    const { router, authorized } = build();
    const selected = await router.select(
      router.createSession('productos con stock', 'scope'),
      authorized,
      false,
      false,
    );
    const offered = selected.definitions.map((d) => d.function.name);
    expect(selected).not.toHaveProperty('stubs');
    expect(offered).not.toContain('describe_tool');
    expect(offered).toContain('list_products');
    expect(offered).toContain('adjust_stock');
  });
});
