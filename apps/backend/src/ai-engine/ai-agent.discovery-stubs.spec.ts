import { createHash } from 'crypto';
import { AIAgentService } from './ai-agent.service';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { ToolRouterService } from './tools/tool-router.service';
import { createDiscoveryTools } from './tools/domains/discovery.tools';
import { localToolRanking, localToolScores } from './tools/tool-catalog';
import { AgentTraceService } from './observability/agent-trace.service';
import { RequestContextService } from '../common/context/request-context.service';

/**
 * F10/T62: progressive discovery in the routing turn. Switch off: the turn is
 * byte-identical to the pre-F10 one (golden hash taken from the code before the
 * change). Switch on: the preload travels as one-line stubs in a system message,
 * `describe_tool` is answered by the router and never touches the definitions.
 */
describe('T62: AI_TOOL_DISCOVERY_STUBS in the agent turn', () => {
  const original = process.env.AI_TOOL_DISCOVERY_STUBS;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_TOOL_DISCOVERY_STUBS;
    else process.env.AI_TOOL_DISCOVERY_STUBS = original;
    jest.restoreAllMocks();
  });

  const toolCall = (id: string, name: string, args = {}) => ({
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });

  function build(script: Array<Array<ReturnType<typeof toolCall>>> = []) {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(createDiscoveryTools());
    for (let i = 0; i < 40; i++)
      registry.register({
        name: `operation_${String(i).padStart(2, '0')}`,
        access: 'public',
        accessReason: 'test fixture',
        domain: 'inventory',
        description: `Operation ${i}. Segunda frase que no va en la ficha.`,
        parameters: {
          type: 'object',
          properties: { sku: { type: 'string' } },
        },
        readOnly: i % 2 === 0,
        handler: async () => '{}',
      });
    registry.register({
      name: 'payroll_secret',
      access: 'public',
      accessReason: 'test fixture',
      domain: 'payroll',
      description: 'Liquida nómina secreta.',
      parameters: { type: 'object', properties: {} },
      readOnly: true,
      handler: async () => '{}',
    });
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
    chat.mockImplementation(async () => {
      const calls = script[step++] ?? [];
      return {
        success: true,
        content: calls.length ? '' : 'Listo.',
        tool_calls: calls,
        usage: { totalTokens: 10 },
      };
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
    const routerAttrs: Array<Record<string, any>> = [];
    const original = trace.endSpan.bind(trace);
    jest.spyOn(trace, 'endSpan').mockImplementation((handle, end) => {
      if (handle?.kind === 'router' && end?.attributes)
        routerAttrs.push({ ...(end.attributes as any) });
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
        () =>
          service.runAgent({
            goal: 'operation_00',
            max_iterations: 4,
            agent_denied_tools: ['payroll_secret'],
          }),
      );
    return { run, chat, routerAttrs, trace };
  }

  const systemTexts = (messages: any[]) =>
    messages.filter((m) => m.role === 'system').map((m) => m.content as string);
  const toolNames = (options: any) =>
    (options?.tools ?? []).map((t: any) => t.function.name);

  it('switch off: the first inference is byte-identical to the pre-T62 turn', async () => {
    delete process.env.AI_TOOL_DISCOVERY_STUBS;
    const f = build();
    await f.run();
    const [messages, options] = f.chat.mock.calls[0];
    const texts = systemTexts(messages);
    expect(texts.join('\n')).not.toContain('describe_tool');
    expect(texts.join('\n')).not.toContain('Fichas');
    expect(toolNames(options)).not.toContain('describe_tool');
    const { latency_ms, ...stable } = f.routerAttrs[0] as any;
    const snapshot = JSON.stringify({
      system: texts,
      tools: toolNames(options),
      attrs: stable,
    });
    expect(createHash('sha256').update(snapshot).digest('hex')).toBe(
      '0bbdab0216090031407a7299a4093f4456388077f42d20d39aa1b50f8be9e79b',
    );
  });

  it('switch on: the preload is one line per tool in a system message and leaves the definitions', async () => {
    process.env.AI_TOOL_DISCOVERY_STUBS = 'true';
    const f = build();
    await f.run();
    const [messages, options] = f.chat.mock.calls[0];
    const names = toolNames(options);
    expect(names).toContain('describe_tool');
    expect(names).not.toContain('operation_00');
    const texts = systemTexts(messages).join('\n');
    expect(texts).toContain('describe_tool');
    expect(texts).toMatch(/- operation_00 — Operation 0\. \(lee\)/);
    // Only the preload is a stub: the rest of the shop stays in the index.
    expect(texts).not.toMatch(/- operation_01 — /);
    expect(texts).not.toContain('Segunda frase');
    expect(f.routerAttrs[0].offered_tool_count).toBe(names.length);
  });

  it('switch on: describe_tool is answered by the router and a not-loaded or stubbed tool can still be called', async () => {
    process.env.AI_TOOL_DISCOVERY_STUBS = 'true';
    const f = build([
      [
        toolCall('c1', 'describe_tool', { name: 'operation_00' }),
        toolCall('c2', 'describe_tool', { name: 'payroll_secret' }),
      ],
      [toolCall('c3', 'operation_00', { sku: 'A' })],
    ]);
    await f.run();
    const second = f.chat.mock.calls[1][0].filter(
      (m: any) => m.role === 'tool',
    );
    const ok = JSON.parse(second.find((m: any) => m.tool_call_id === 'c1').content);
    expect(ok.name).toBe('operation_00');
    expect(ok.declaration).toContain('operation_00');
    const denied = JSON.parse(
      second.find((m: any) => m.tool_call_id === 'c2').content,
    );
    expect(denied.error).toMatch(/Tu rol no permite/);
    // The definitions of the second inference are untouched by describe_tool.
    expect(toolNames(f.chat.mock.calls[1][1])).not.toContain('operation_00');
    // The stubbed tool ran (no AI_AGENT_TOOL_NOT_ALLOWED) and the model got its result.
    const third = f.chat.mock.calls[2][0].filter(
      (m: any) => m.role === 'tool' && m.tool_call_id === 'c3',
    );
    expect(third).toHaveLength(1);
    expect(third[0].content).not.toContain('AI_AGENT_TOOL_NOT_ALLOWED');
  });
});
