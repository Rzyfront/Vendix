import { AIAgentService } from './ai-agent.service';
import { RequestContextService } from '../common/context/request-context.service';
import { AIStreamChunk } from './interfaces/ai-provider.interface';

/**
 * T21 (F3 FIX B1): the engine measures the real context budget on every
 * streamed step; the agent must forward the LAST step's budget on the turn's
 * final `done` (and on its result) instead of dropping it.
 */
describe('AIAgentService T21 context_budget forwarding (agentic stream)', () => {
  const budgetOf = (tokens: number) => ({
    estimated_input_tokens: tokens,
    omitted_messages: 0,
    context_window_tokens: 128000,
    provenance: 'configured' as const,
    method: 'conservative_estimate' as const,
  });

  function build(steps: AIStreamChunk[][]) {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      permissions: ['p'],
      roles: [],
    } as any);
    let index = 0;
    const runAgentStream = jest.fn(async function* () {
      for (const chunk of steps[Math.min(index++, steps.length - 1)])
        yield chunk;
    });
    const registry = {
      getAvailableDefinitions: jest.fn(() => [
        {
          type: 'function' as const,
          function: { name: 'list_things', description: 'x', parameters: {} },
        },
      ]),
      getDeniedPermissions: jest.fn(() => []),
      canonicalName: (n: string) => n,
      matchesScope: () => true,
      get: (n: string) => ({ name: n, domain: 'things' }),
      getDeprecation: () => undefined,
      isClientSide: () => false,
      isReadOnly: () => true,
      executeTool: jest.fn().mockResolvedValue('{"success":true,"data":[]}'),
      executeToolResult: jest.fn(async () => ({
        success: true,
        data: [],
      })),
    };
    const service = new AIAgentService(
      {
        supportsAgentStreaming: jest.fn().mockResolvedValue(true),
        runAgentStream,
        run: jest.fn(),
        chat: jest.fn(),
        chatWith: jest.fn(),
      } as any,
      {} as any,
      registry as any,
      { emit: jest.fn() } as any,
      { awaitResult: jest.fn() } as any,
      {
        canUseAIFeature: jest.fn(),
        getAIFeatureConfig: jest.fn(),
        consumeAIQuota: jest.fn(),
        checkExtraQuota: jest.fn().mockResolvedValue({
          exceeded: false,
          cap: null,
          used: 0,
          degradation: 'block',
        }),
        consumeExtraQuota: jest.fn(),
      } as any,
    );
    return { service, runAgentStream };
  }

  async function drain(service: AIAgentService) {
    const chunks: AIStreamChunk[] = [];
    const gen = service.runAgentStream({ goal: 'hola', app_key: 'vex_agent' });
    let next = await gen.next();
    while (!next.done) {
      chunks.push(next.value);
      next = await gen.next();
    }
    return { chunks, result: next.value };
  }

  afterEach(() => jest.restoreAllMocks());

  it('forwards the engine budget on the final done and the result', async () => {
    const { service, runAgentStream } = build([
      [
        { type: 'text', content: 'Tienes 3 pedidos.' },
        {
          type: 'done',
          finish_reason: 'stop',
          usage: { promptTokens: 9, completionTokens: 4, totalTokens: 13 },
          context_budget: budgetOf(96000),
          cost_usd: 0.002,
        },
      ],
    ]);
    const { chunks, result } = await drain(service);
    expect(runAgentStream).toHaveBeenCalled();
    const done = chunks.filter((c) => c.type === 'done');
    expect(done).toHaveLength(1);
    expect(done[0].context_budget).toEqual(budgetOf(96000));
    expect(result.context_budget).toEqual(budgetOf(96000));
  });

  it('uses the LAST step budget when the turn ran several inferences', async () => {
    const toolStep: AIStreamChunk[] = [
      {
        type: 'done',
        finish_reason: 'tool_calls',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'list_things', arguments: '{}' },
          },
        ],
        usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
        context_budget: budgetOf(40000),
      },
    ];
    const answerStep: AIStreamChunk[] = [
      { type: 'text', content: 'No hay cosas.' },
      {
        type: 'done',
        finish_reason: 'stop',
        usage: { promptTokens: 8, completionTokens: 3, totalTokens: 11 },
        context_budget: budgetOf(52000),
      },
    ];
    const { service, runAgentStream } = build([toolStep, answerStep]);
    const { chunks, result } = await drain(service);
    expect(runAgentStream).toHaveBeenCalledTimes(2);
    const done = chunks.filter((c) => c.type === 'done');
    expect(done[done.length - 1].context_budget).toEqual(budgetOf(52000));
    expect(result.context_budget).toEqual(budgetOf(52000));
  });

  it('leaves done without a budget when the engine reported none', async () => {
    const { service } = build([
      [
        { type: 'text', content: 'hola' },
        {
          type: 'done',
          finish_reason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      ],
    ]);
    const { chunks, result } = await drain(service);
    const done = chunks.find((c) => c.type === 'done');
    expect(done).toBeDefined();
    expect(done).not.toHaveProperty('context_budget');
    expect(result).not.toHaveProperty('context_budget');
  });
});
