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
const saved = process.env.AI_TOOL_ROUTING_ENABLED;
beforeAll(() => {
  process.env.AI_TOOL_ROUTING_ENABLED = 'true';
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
  if (saved === undefined) delete process.env.AI_TOOL_ROUTING_ENABLED;
  else process.env.AI_TOOL_ROUTING_ENABLED = saved;
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
    'case %s never offers unauthorized/restricted tools even with embeddings degraded',
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
      expect(selected.operationalCount).toBeLessThanOrEqual(12);
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
