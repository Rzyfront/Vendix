/** Offline H seam: real loop + registry; provider/domain boundaries synthetic. */
import {
  AIAgentService,
  AgentRunParams,
} from '../../src/ai-engine/ai-agent.service';
import { AIToolRegistry } from '../../src/ai-engine/tools/ai-tool-registry';
import { RequestContextService } from '../../src/common/context/request-context.service';
import type {
  AIResponse,
  AIStreamChunk,
  AIToolCall,
} from '../../src/ai-engine/interfaces/ai-provider.interface';

const context = {
  store_id: 11,
  organization_id: 22,
  user_id: 33,
  permissions: ['read', 'write'],
  roles: ['owner'],
  is_super_admin: false,
  is_owner: true,
};
const scope = <T>(work: () => T) =>
  RequestContextService.runIsolated(context, work);
const call = (args = '{"id":7}', name = 'read_record'): AIToolCall => ({
  id: 'c1',
  type: 'function',
  function: { name, arguments: args },
});
const answer = (tool_calls?: AIToolCall[], content = ''): AIResponse => ({
  success: true,
  content,
  tool_calls,
  usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
  finish_reason: tool_calls ? 'tool_calls' : 'stop',
});
function fixture(responses: AIResponse[]) {
  const handler = jest.fn().mockResolvedValue('{"id":7,"quantity":5}');
  const mutation = jest.fn().mockResolvedValue('{"applied":true}');
  const registry = new AIToolRegistry({
    issue: jest.fn().mockResolvedValue('proposal-one-use'),
  } as never);
  registry.register({
    name: 'read_record',
    domain: 'records',
    description: 'Read',
    readOnly: true,
    requiredPermissions: ['read'],
    parameters: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'number' } },
    },
    handler,
  });
  registry.register({
    name: 'change_record',
    domain: 'records',
    description: 'Change',
    requiresConfirmation: true,
    requiredPermissions: ['write'],
    parameters: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'number' } },
    },
    handler: mutation,
    preview: async () => ({
      target: 'registro',
      changes: [{ field: 'quantity', from: 5, to: 6 }],
    }),
  });
  const run = jest.fn(
    async () => responses.shift() ?? answer(undefined, 'Consulta final.'),
  );
  const runAgentStream = jest.fn(async function* () {
    const response = responses.shift() ?? answer(undefined, 'Consulta final.');
    if (!response.success) {
      yield {
        type: 'error' as const,
        error: response.error,
        usage: response.usage,
      };
      return;
    }
    if (response.content)
      yield { type: 'text' as const, content: response.content };
    yield { type: 'done' as const, ...response };
  });
  const supportsAgentStreaming = jest.fn().mockResolvedValue(true);
  const agent = new AIAgentService(
    { run, runAgentStream, supportsAgentStreaming } as never,
    {} as never,
    registry,
    { emit: jest.fn() } as never,
    {} as never,
    {
      canUseAIFeature: async () => ({ allowed: true }),
      getAIFeatureConfig: async () => ({ tools_allowed: ['*'] }),
      consumeAIQuota: jest.fn(),
      checkExtraQuota: async () => ({ exceeded: false }),
      consumeExtraQuota: jest.fn(),
    } as never,
  );
  return {
    agent,
    registry,
    handler,
    mutation,
    run,
    runAgentStream,
    supportsAgentStreaming,
  };
}
async function drain(
  agent: AIAgentService,
  patch: Partial<AgentRunParams> = {},
) {
  const iterator = agent.runAgentStream({
    goal: 'Consulta registro 7',
    app_key: 'vexi_assistant',
    max_iterations: 3,
    timeout_ms: 5000,
    ...patch,
  });
  const chunks: AIStreamChunk[] = [];
  let step = await iterator.next();
  while (!step.done) {
    chunks.push(step.value);
    step = await iterator.next();
  }
  return { chunks, result: step.value };
}
describe('H agentic streaming end-to-end seam offline', () => {
  beforeEach(() => {});
  afterEach(() => {});
  it('streamed and buffered entry points share registry execution and terminal output', async () =>
    scope(async () => {
      const streamed = fixture([
        answer([call()]),
        answer(undefined, 'Cantidad consultada: cinco.'),
      ]);
      const result = await drain(streamed.agent);
      expect(streamed.handler).toHaveBeenCalledTimes(1);
      expect(streamed.run).not.toHaveBeenCalled();
      expect(streamed.runAgentStream).toHaveBeenCalledTimes(2);
      expect(result.result).toMatchObject({
        success: true,
        content: 'Cantidad consultada: cinco.',
        total_tokens: 20,
      });
      expect(result.chunks.some((chunk) => chunk.type === 'progress')).toBe(
        true,
      );
      const drained = fixture([
        answer([call()]),
        answer(undefined, 'Cantidad consultada: cinco.'),
      ]);
      expect(
        await drained.agent.runAgent({
          goal: 'Consulta',
          app_key: 'vexi_assistant',
        }),
      ).toMatchObject({ content: result.result.content, total_tokens: 20 });
    }));
  it.each(['{"id":', '{"id":false}', '[]', 'null'])(
    'invalid streamed JSON/schema never reaches handler: %s',
    async (args) =>
      scope(async () => {
        const f = fixture([
          answer([call(args)]),
          answer(undefined, 'Necesito un identificador válido.'),
        ]);
        const result = await drain(f.agent);
        expect(f.handler).not.toHaveBeenCalled();
        expect(result.chunks).toContainEqual(
          expect.objectContaining({
            type: 'tool_result',
            tool: expect.objectContaining({ failed: true }),
          }),
        );
      }),
  );
  it('never displays streamed false-write prose before the real proposal and does not apply', async () =>
    scope(async () => {
      const f = fixture([
        answer([call('{"id":7}', 'change_record')], 'Ya cambié la cantidad.'),
      ]);
      const result = await drain(f.agent);
      expect(f.mutation).not.toHaveBeenCalled();
      expect(result.result.pending_confirmation?.confirmation_token).toBe(
        'proposal-one-use',
      );
      expect(
        result.chunks
          .filter((chunk) => chunk.type === 'text')
          .map((chunk) => chunk.content)
          .join(''),
      ).not.toContain('Ya cambié');
      expect(f.runAgentStream).toHaveBeenCalledTimes(1);
    }));

  it('chooses buffered BEFORE dispatch when concrete provider usage capability is unproved', async () =>
    scope(async () => {
      const f = fixture([
        answer([call()]),
        answer(undefined, 'Respuesta medida.'),
      ]);
      f.supportsAgentStreaming.mockResolvedValue(false);
      const result = await drain(f.agent);
      expect(f.runAgentStream).not.toHaveBeenCalled();
      expect(f.run).toHaveBeenCalledTimes(2);
      expect(f.handler).toHaveBeenCalledTimes(1);
      expect(result.result.total_tokens).toBe(20);
    }));
  it('does not retry an empty streaming inference or switch to buffered transport', async () =>
    scope(async () => {
      const f = fixture([answer()]);
      await drain(f.agent);
      expect(f.runAgentStream).toHaveBeenCalledTimes(1);
      expect(f.run).not.toHaveBeenCalled();
    }));
  it('retains reported error usage even when D0 and durable flags are OFF', async () =>
    scope(async () => {
      const f = fixture([
        {
          success: false,
          error: 'Invalid final batch',
          usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
        },
      ]);
      const result = await drain(f.agent);
      expect(result.result).toMatchObject({ success: false, total_tokens: 10 });
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.runAgentStream).toHaveBeenCalledTimes(1);
      expect(f.run).not.toHaveBeenCalled();
    }));
  it('pre-aborted H request never dispatches provider or domain', async () =>
    scope(async () => {
      const f = fixture([answer([call()])]);
      const controller = new AbortController();
      controller.abort();
      const result = await drain(f.agent, { signal: controller.signal });
      expect(f.runAgentStream).not.toHaveBeenCalled();
      expect(f.handler).not.toHaveBeenCalled();
      expect(result.result.success).toBe(false);
    }));
});
