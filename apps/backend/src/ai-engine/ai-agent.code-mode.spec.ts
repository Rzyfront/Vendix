import { AIAgentService } from './ai-agent.service';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { ToolRouterService } from './tools/tool-router.service';
import { createDiscoveryTools } from './tools/domains/discovery.tools';
import { createCodeModeTools } from './tools/domains/code-execution.tools';
import { localToolRanking, localToolScores } from './tools/tool-catalog';
import { AgentTraceService } from './observability/agent-trace.service';
import { codeModeInvocation } from './sandbox/codemode-invocation.context';
import { RequestContextService } from '../common/context/request-context.service';
import type { AIStreamChunk } from './interfaces/ai-provider.interface';

/**
 * F10/T65b: `run_code` in the agent loop. Offered only to Vex with the runner
 * available AND the plan granting `vex.code_mode`; with either switch off the
 * turn is identical to one where the tool does not exist. Scripts run in NORMAL
 * turns, at most 3 per turn, inside `codeModeInvocation` with the turn's
 * role-filtered authority; their blocks go to the screen, not to the model.
 */
describe('T65b: run_code in the agent turn', () => {
  const toolCall = (id: string, name: string, args: object = {}) => ({
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });

  const entitlementRows = (capability: string | null) => ({
    found: true,
    planId: 5,
    rows: capability
      ? [
          {
            agent_key: 'vex',
            capability_key: capability,
            enabled: true,
            cap_value: null,
          },
        ]
      : [],
  });

  interface Options {
    registerRunCode?: boolean;
    capability?: string | null;
    runnerAvailable?: boolean;
    withServices?: boolean;
    agentKey?: string;
    script?: Array<Array<ReturnType<typeof toolCall>>>;
    runResult?: any;
    streaming?: boolean;
    denied?: string[];
  }

  function build(opts: Options = {}) {
    const {
      registerRunCode = true,
      capability = 'code_mode',
      runnerAvailable = true,
      withServices = true,
      agentKey = 'vex',
      script = [],
      streaming = false,
    } = opts;
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(createDiscoveryTools());
    for (const name of ['list_orders', 'list_products'])
      registry.register({
        name,
        access: 'public',
        accessReason: 'test fixture',
        domain: 'orders',
        description: `${name}. Lee datos.`,
        parameters: { type: 'object', properties: {} },
        readOnly: true,
        handler: async () => '{}',
      });
    registry.register({
      name: 'create_order',
      access: 'public',
      accessReason: 'test fixture',
      domain: 'orders',
      description: 'Crea un pedido.',
      parameters: { type: 'object', properties: {} },
      handler: async () => '{}',
    });
    const seen: any[] = [];
    const runner = {
      available: jest.fn(() => runnerAvailable),
      run: jest.fn(async (request: any) => {
        const invocation = codeModeInvocation.getStore();
        seen.push({
          agentKey: invocation?.agentKey,
          initialNames: invocation?.initialNames,
          revalidated: invocation ? await invocation.revalidate() : null,
          durable: invocation?.durable,
          request,
        });
        return (
          opts.runResult ?? {
            run_id: 'run-1',
            source_hash: 'h-1',
            result: { total: 3 },
            result_truncated: false,
            logs: [],
            calls: [],
            rows_seen: 0,
            blocks: [
              {
                kind: 'table',
                spec: {},
                data: {
                  rows: Array.from({ length: 9 }, (_, i) => ({ n: i })),
                },
              },
            ],
          }
        );
      }),
    };
    const created: any[] = [];
    if (registerRunCode)
      registry.registerMany(
        createCodeModeTools({
          runner: runner as any,
          blocks: {
            create: async (b: any) => {
              created.push(b);
              return { id: `blk-${created.length}` } as any;
            },
            toUiBlock: async (row: any) => ({
              block_id: row.id,
              kind: 'table',
              version: 1,
              spec: { analysis: { run_id: 'run-1', language: 'js' } },
              data: { rows: [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }, { n: 7 }, { n: 8 }] },
            }),
          } as any,
          entitlements: { codeModeEnabled: async () => true },
          registry,
          policy: { allowlisted: () => true, eligible: () => true },
        }),
      );
    const router = new ToolRouterService(registry, {
      rank: async (q: string, docs: any[], _s: string, d: string) => ({
        names: localToolRanking(q, docs, d),
        degraded: [],
        scores: Object.fromEntries(
          [...localToolScores(q, docs, d)].filter(([, v]) => v > 0),
        ),
        coverage: 1,
        source: 'lexical_local',
      }),
    } as any);
    const chat = jest.fn();
    let step = 0;
    const nextStep = () => {
      const calls = script[step++] ?? [];
      return {
        success: true,
        content: calls.length ? '' : 'Listo.',
        tool_calls: calls,
        usage: { totalTokens: 10 },
      };
    };
    chat.mockImplementation(async () => nextStep());
    const runAgentStream = jest.fn(async function* () {
      const r = nextStep();
      yield {
        type: 'done',
        finish_reason: r.tool_calls.length ? 'tool_calls' : 'stop',
        tool_calls: r.tool_calls.length ? r.tool_calls : undefined,
        content: r.content,
        usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
      } as any;
    });
    const resolveForStore = jest.fn(async () => entitlementRows(capability));
    const service = new AIAgentService(
      {
        chat,
        ...(streaming
          ? {
              supportsAgentStreaming: jest.fn().mockResolvedValue(true),
              runAgentStream,
            }
          : {}),
      } as any,
      {} as any,
      registry,
      { emit: jest.fn() } as any,
      { awaitResult: jest.fn() } as any,
      {
        canUseAIFeature: async () => ({ allowed: true }),
        getAIFeatureConfig: async () => ({ tools_allowed: ['*'] }),
        checkExtraQuota: async () => ({ exceeded: false }),
        consumeExtraQuota: jest.fn(),
        consumeAIQuota: jest.fn(),
      } as any,
      undefined,
      router,
      undefined,
      undefined,
      withServices ? ({ resolveForStore } as any) : undefined,
      withServices ? (runner as any) : undefined,
    );
    const trace = new AgentTraceService({
      ai_agent_trace_spans: { upsert: jest.fn(async () => undefined) },
    } as any);
    (service as any).trace = trace;
    const routerAttrs: Array<Record<string, any>> = [];
    const original = trace.endSpan.bind(trace);
    jest.spyOn(trace, 'endSpan').mockImplementation((handle, end) => {
      if (handle?.kind === 'router' && end?.attributes)
        routerAttrs.push({ ...(end.attributes as any) });
      return original(handle, end);
    });
    const run = async () => {
      const chunks: AIStreamChunk[] = [];
      await RequestContextService.runIsolated(
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
        async () => {
          const gen = service.runAgentStream({
            goal: 'list_orders',
            max_iterations: 8,
            conversation_id: 42,
            ...(opts.denied ? { agent_denied_tools: opts.denied } : {}),
            agent_key: agentKey,
            ...(streaming ? { app_key: 'vex_agent' } : {}),
          });
          let next = await gen.next();
          while (!next.done) {
            chunks.push(next.value);
            next = await gen.next();
          }
        },
      );
      return chunks;
    };
    const authority = () =>
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
        async () =>
          (
            await service.resolveToolAuthority({
              goal: 'x',
              agent_key: agentKey,
            })
          ).map((d) => d.function.name),
      );
    return {
      run,
      chat,
      runner,
      seen,
      created,
      routerAttrs,
      resolveForStore,
      authority,
    };
  }

  const systemTexts = (messages: any[]) =>
    messages.filter((m) => m.role === 'system').map((m) => m.content as string);
  const toolNames = (options: any) =>
    (options?.tools ?? []).map((t: any) => t.function.name);
  /**
   * `catalog_hash` is the registry-wide manifest hash, so a registry that holds
   * `run_code` (T65a registers it unconditionally) hashes differently from one
   * that never had it; it is compared only between registries that both hold it.
   */
  const firstTurn = (f: ReturnType<typeof build>, withHash = true) => {
    const [messages, options] = f.chat.mock.calls[0];
    const { latency_ms, catalog_hash, ...attrs } = (f.routerAttrs[0] ??
      {}) as any;
    if (withHash) attrs.catalog_hash = catalog_hash;
    return JSON.stringify({
      system: systemTexts(messages),
      tools: toolNames(options),
      attrs,
    });
  };

  describe('offer rule', () => {
    it('golden: with the plan capability off the turn is byte-identical to one where run_code does not exist', async () => {
      const baseline = build({ registerRunCode: false });
      await baseline.run();
      const off = build({ capability: null });
      await off.run();
      const reference = build({ runnerAvailable: false });
      await reference.run();
      expect(toolNames(off.chat.mock.calls[0][1])).not.toContain('run_code');
      expect(firstTurn(off, false)).toBe(firstTurn(baseline, false));
      expect(firstTurn(off)).toBe(firstTurn(reference));
    });

    it('golden: with the runner unavailable the turn is byte-identical and the plan is never consulted', async () => {
      const baseline = build({ registerRunCode: false });
      await baseline.run();
      const off = build({ runnerAvailable: false });
      await off.run();
      const reference = build({ capability: null });
      await reference.run();
      expect(firstTurn(off, false)).toBe(firstTurn(baseline, false));
      expect(firstTurn(off)).toBe(firstTurn(reference));
      expect(off.resolveForStore).not.toHaveBeenCalled();
    });

    it('is never offered without the entitlement/runner services or to another agent', async () => {
      const baseline = build({ registerRunCode: false });
      await baseline.run();
      const noServices = build({ withServices: false });
      await noServices.run();
      expect(firstTurn(noServices, false)).toBe(firstTurn(baseline, false));
      const vexi = build({ agentKey: 'vexi' });
      await vexi.run();
      expect(toolNames(vexi.chat.mock.calls[0][1])).not.toContain('run_code');
    });

    it('a plan with a different capability does not grant it', async () => {
      const f = build({ capability: 'code_analysis' });
      await f.run();
      expect(f.resolveForStore).toHaveBeenCalled();
      expect(toolNames(f.chat.mock.calls[0][1])).not.toContain('run_code');
      expect(await f.authority()).not.toContain('run_code');
    });

    it('with both switches on, run_code is in the authority of a NORMAL (non-durable) turn', async () => {
      expect(await build().authority()).toContain('run_code');
      expect(await build({ capability: null }).authority()).not.toContain(
        'run_code',
      );
      expect(await build({ runnerAvailable: false }).authority()).not.toContain(
        'run_code',
      );
      expect(await build({ agentKey: 'vexi' }).authority()).not.toContain(
        'run_code',
      );
    });

    it('an unoffered run_code call is rejected as not allowed and never reaches the runner', async () => {
      const f = build({
        capability: null,
        script: [
          [
            toolCall('c1', 'run_code', {
              source: 'return 1',
              tools: ['list_orders'],
              purpose: 'x',
            }),
          ],
        ],
      });
      await f.run();
      expect(f.runner.run).not.toHaveBeenCalled();
      const tool = f.chat.mock.calls[1][0].find(
        (m: any) => m.role === 'tool',
      );
      expect(tool.content).toContain('AI_AGENT_TOOL_NOT_ALLOWED');
    });
  });

  describe('execution', () => {
    const script = (id: string) =>
      toolCall(id, 'run_code', {
        source: 'return await tools.list_orders({})',
        tools: ['list_orders'],
        purpose: 'contar pedidos',
      });

    it('runs inside codeModeInvocation with the turn authority, never the global catalog', async () => {
      const f = build({ script: [[script('c1')]] });
      await f.run();
      expect(f.seen).toHaveLength(1);
      const seen = f.seen[0];
      expect(seen.agentKey).toBe('vex');
      expect(seen.durable).toBeUndefined();
      expect(seen.initialNames).toEqual(
        expect.arrayContaining(['list_orders', 'list_products', 'create_order']),
      );
      expect(seen.revalidated).toEqual(seen.initialNames);
    });

    it('a tool denied to the agent is absent from the invocation authority', async () => {
      const f = build({ script: [[script('c1')]], denied: ['list_products'] });
      await f.run();
      expect(f.seen[0].initialNames).not.toContain('list_products');
      expect(f.seen[0].initialNames).toContain('list_orders');
    });

    it('the 4th run_code in one turn answers a Spanish error without invoking the bridge', async () => {
      const f = build({
        script: [
          [script('c1'), script('c2')],
          [script('c3'), script('c4')],
        ],
      });
      await f.run();
      expect(f.runner.run).toHaveBeenCalledTimes(3);
      const tools = f.chat.mock.calls[2][0].filter((m: any) => m.role === 'tool');
      const fourth = JSON.parse(
        tools.find((m: any) => m.tool_call_id === 'c4').content,
      );
      expect(fourth.error_code).toBe('CODEMODE_TURN_LIMIT');
      expect(fourth.error).toMatch(/máximo/);
      const third = JSON.parse(
        tools.find((m: any) => m.tool_call_id === 'c3').content,
      );
      expect(third.error_code).toBeFalsy();
    });

    it('a script that asks for a write tool is rejected before the bridge runs', async () => {
      const f = build({
        script: [
          [
            toolCall('c1', 'run_code', {
              source: 'return 1',
              tools: ['create_order'],
              purpose: 'x',
            }),
          ],
        ],
      });
      await f.run();
      expect(f.runner.run).not.toHaveBeenCalled();
    });

    it('blocks go to the screen; the model gets block id, row count and a 5-row preview only', async () => {
      const f = build({ script: [[script('c1')]] });
      const chunks = await f.run();
      const uiBlocks = chunks.filter((c) => c.type === 'ui_block');
      expect(uiBlocks).toHaveLength(1);
      expect(uiBlocks[0].ui_block).toMatchObject({
        block_id: 'blk-1',
        kind: 'table',
      });
      expect(uiBlocks[0].ui_block?.spec).toMatchObject({
        analysis: { run_id: 'run-1', language: 'js' },
      });
      const content = f.chat.mock.calls[1][0].find(
        (m: any) => m.role === 'tool' && m.tool_call_id === 'c1',
      ).content;
      expect(content).not.toContain('ui_blocks');
      const data = JSON.parse(content).data;
      expect(data.ui_blocks).toBeUndefined();
      expect(data.blocks).toEqual([
        expect.objectContaining({
          block_id: 'blk-1',
          rows: 9,
          preview: expect.any(Array),
        }),
      ]);
      expect(data.blocks[0].preview).toHaveLength(5);
    });

    it('emits one progress frame «Consultando datos con un script…» when the turn streams', async () => {
      const f = build({ script: [[script('c1')]], streaming: true });
      const chunks = await f.run();
      expect(
        chunks.filter(
          (c) =>
            c.type === 'progress' &&
            c.content === 'Consultando datos con un script…',
        ),
      ).toHaveLength(1);
    });
  });
});
