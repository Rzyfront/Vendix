import { AIAgentService } from './ai-agent.service';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { ToolRouterService } from './tools/tool-router.service';
import { createDiscoveryTools } from './tools/domains/discovery.tools';
import { localToolRanking, localToolScores } from './tools/tool-catalog';
import { AgentTraceService } from './observability/agent-trace.service';
import { RequestContextService } from '../common/context/request-context.service';

/**
 * T60: every turn leaves its tool-definition and context size, the estimator
 * that produced them and whether the router fell back to the full catalog in
 * its trace spans. Measurement only: the model sees exactly what it saw before.
 */
describe('T60: definition_tokens / context_tokens in the turn trace', () => {
  function build(opts: { router: boolean; dynamic?: boolean }) {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(createDiscoveryTools());
    for (let i = 0; i < 40; i++)
      registry.register({
        name: `operation_${String(i).padStart(2, '0')}`,
        access: 'public',
        accessReason: 'test fixture',
        domain: 'inventory',
        description: `Operation ${i}`,
        parameters: { type: 'object', properties: {} },
        readOnly: true,
        handler: async () => '{}',
      });
    const router = opts.router
      ? new ToolRouterService(registry, {
          rank: async (q: string, docs: any[], _s: string, domain: string) => ({
            names: localToolRanking(q, docs, domain),
            degraded: [],
            ...(opts.dynamic && {
              scores: Object.fromEntries(
                [...localToolScores(q, docs, domain)].filter(([, v]) => v > 0),
              ),
              coverage: 1,
              source: 'lexical_local',
            }),
          }),
        } as any)
      : undefined;
    const chat = jest.fn().mockResolvedValue({
      success: true,
      content: 'Listo.',
      usage: { totalTokens: 10 },
    });
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
    const trace = new AgentTraceService({
      ai_agent_trace_spans: { upsert: jest.fn(async () => undefined) },
    } as any);
    (service as any).trace = trace;
    // Attributes as the loop wrote them (before the persistence redaction).
    const ended: Array<{ kind: string; attributes: Record<string, any> }> = [];
    const original = trace.endSpan.bind(trace);
    jest.spyOn(trace, 'endSpan').mockImplementation((handle, end) => {
      if (handle && end?.attributes)
        ended.push({ kind: handle.kind, attributes: end.attributes as any });
      return original(handle, end);
    });
    const run = () =>
      RequestContextService.runIsolated(
        {
          organization_id: 7,
          store_id: 11,
          user_id: 3,
          permissions: [],
          roles: [],
          is_owner: true,
          is_super_admin: false,
          request_id: 'external-not-a-uuid',
        },
        () => service.runAgent({ goal: 'operation_00', max_iterations: 2 }),
      );
    const spans = (kind: string) => ended.filter((e) => e.kind === kind);
    return { run, spans, chat, registry, trace };
  }

  afterEach(() => jest.restoreAllMocks());

  it('a router-less turn still writes non-null measures, the estimator and counts', async () => {
    const f = build({ router: false });
    await f.run();
    await f.trace.flush();
    const [context] = f.spans('context');
    const a = context.attributes;
    expect(a.definition_tokens).toEqual(expect.any(Number));
    expect(a.definition_tokens).toBeGreaterThan(0);
    expect(a.context_tokens).toEqual(expect.any(Number));
    expect(a.context_tokens).toBeGreaterThan(a.definition_tokens);
    expect(a.token_estimator).toBe('bytes_v1');
    expect(a.offered_tool_count).toBe(a.tool_count);
    expect(a.authorized_tool_count).toBe(a.tool_count);
    expect(a.full_catalog_fallback).toBe(false);
    expect(a.full_catalog_reason).toBeNull();
  });

  it('a routed turn that falls back records offered=authorized, the flag and its reason per round', async () => {
    const f = build({ router: true, dynamic: false });
    await f.run();
    await f.trace.flush();
    const [context] = f.spans('context');
    expect(context.attributes.definition_tokens).toBeGreaterThan(0);
    expect(context.attributes.context_tokens).toBeGreaterThan(0);
    expect(context.attributes.token_estimator).toBe('bytes_v1');
    const [round] = f.spans('router');
    expect(round.attributes.full_catalog_fallback).toBe(true);
    expect(round.attributes.full_catalog_reason).toBe('index_coverage_below_90');
    expect(round.attributes.offered_tool_count).toBe(
      round.attributes.authorized_tool_count,
    );
    expect(round.attributes.token_estimator).toBe('bytes_v1');
    expect(round.attributes.context_tokens).toBeGreaterThan(
      round.attributes.definition_tokens,
    );
  });

  it('a routed turn with a healthy index offers fewer tools and records no fallback', async () => {
    const f = build({ router: true, dynamic: true });
    await f.run();
    await f.trace.flush();
    const [round] = f.spans('router');
    expect(round.attributes.full_catalog_fallback).toBe(false);
    expect(round.attributes.full_catalog_reason).toBeNull();
    expect(round.attributes.offered_tool_count).toBeLessThan(
      round.attributes.authorized_tool_count,
    );
    expect(round.attributes.definition_tokens).toBeGreaterThan(0);
  });
});
