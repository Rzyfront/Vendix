import { AIChatService } from './ai-chat.service';
import { ChatStreamReplay } from './chat-stream-replay';
import { RequestContextService } from '../../../common/context/request-context.service';

const context = {
  store_id: 1,
  organization_id: 2,
  user_id: 3,
  is_super_admin: false,
  is_owner: false,
};
async function collect(generator: AsyncGenerator<unknown>): Promise<unknown[]> {
  const result: unknown[] = [];
  for await (const frame of generator) result.push(frame);
  return result;
}
describe('H chat reattachment revalidates current access before transport lookup', () => {
  const previous = process.env.AI_AGENT_STREAMING_ENABLED;
  afterEach(() => {
    if (previous === undefined) delete process.env.AI_AGENT_STREAMING_ENABLED;
    else process.env.AI_AGENT_STREAMING_ENABLED = previous;
  });
  function fixture() {
    const execute = jest.fn(async function* () {
      yield { type: 'text', content: 'registro leído' };
      yield { type: 'done' };
    });
    const getConversation = jest
      .fn()
      .mockResolvedValue({ id: 7, metadata: null, status: 'active' });
    const gate = jest.fn().mockResolvedValue(undefined);
    const service = Object.assign(
      Object.create(AIChatService.prototype) as AIChatService,
      {
        streamReplay: new ChatStreamReplay(),
        executeMessageStream: execute,
        getConversation,
        assertVexTurnAccess: gate,
      },
    );
    return { service, execute, getConversation, gate };
  }
  it.each([undefined, 'false', 'TRUE'])(
    'keeps the legacy direct generator and shape with flag %s',
    async (flag) => {
      if (flag === undefined) delete process.env.AI_AGENT_STREAMING_ENABLED;
      else process.env.AI_AGENT_STREAMING_ENABLED = flag;
      const { service, execute, gate } = fixture();
      expect(await collect(service.sendMessageStream(7, 'opaque'))).toEqual([
        { type: 'text', content: 'registro leído' },
        { type: 'done' },
      ]);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(gate).not.toHaveBeenCalled();
    },
  );
  it('replays only after fresh scoped conversation and current gate checks, with no second execute', async () => {
    process.env.AI_AGENT_STREAMING_ENABLED = 'true';
    const { service, execute, getConversation, gate } = fixture();
    await RequestContextService.run(context, async () => {
      await collect(service.sendMessageStream(7, 'opaque'));
      await collect(
        service.sendMessageStream(7, 'opaque', undefined, {
          after_sequence: 1,
        }),
      );
      expect(execute).toHaveBeenCalledTimes(1);
      expect(getConversation).toHaveBeenCalledTimes(2);
      expect(gate).toHaveBeenCalledTimes(2);
      gate.mockRejectedValueOnce(new Error('access revoked'));
      await expect(
        collect(
          service.sendMessageStream(7, 'opaque', undefined, {
            after_sequence: 1,
          }),
        ),
      ).rejects.toThrow('access revoked');
      getConversation.mockRejectedValueOnce(
        new Error('conversation not found'),
      );
      await expect(
        collect(
          service.sendMessageStream(7, 'opaque', undefined, {
            after_sequence: 1,
          }),
        ),
      ).rejects.toThrow('conversation not found');
      expect(execute).toHaveBeenCalledTimes(1);
    });
  });
  it('fails closed without explicit AsyncLocalStorage scope', async () => {
    process.env.AI_AGENT_STREAMING_ENABLED = 'true';
    const { service, execute } = fixture();
    await expect(
      collect(service.sendMessageStream(7, 'opaque')),
    ).rejects.toThrow('AI_STREAM_CONTEXT_REQUIRED');
    expect(execute).not.toHaveBeenCalled();
  });
  it('never resurrects cached single-step or plan consent from another tab; keeps evidence and sequence', async () => {
    process.env.AI_AGENT_STREAMING_ENABLED = 'true';
    const { service } = fixture();
    const execute = jest.fn(async function* () {
      yield {
        type: 'tool_result',
        tool: {
          id: 'call',
          name: 'create_order',
          summary: JSON.stringify({
            requires_confirmation: true,
            confirmation_token: 'already-spent-in-other-tab',
          }),
        },
      };
      yield {
        type: 'plan_approval',
        plan_approval: { plan_id: 'plan', token: 'never-replay' },
      };
      yield {
        type: 'tool_result',
        tool: { id: 'read', name: 'get_order', summary: 'fresh evidence' },
      };
      yield { type: 'done' };
    });
    Object.assign(service, { executeMessageStream: execute });
    await RequestContextService.run(context, async () => {
      const initial = await collect(service.sendMessageStream(7, 'opaque'));
      expect(JSON.stringify(initial)).toContain('already-spent-in-other-tab');
      const resumed = (await collect(
        service.sendMessageStream(7, 'opaque', undefined, {
          after_sequence: 1,
        }),
      )) as Array<{
        type: string;
        replay: { sequence: number };
        reconcile_required?: boolean;
      }>;
      expect(JSON.stringify(resumed)).not.toContain(
        'already-spent-in-other-tab',
      );
      expect(JSON.stringify(resumed)).not.toContain('never-replay');
      expect(resumed.slice(0, 2).map((frame) => frame.type)).toEqual([
        'progress',
        'progress',
      ]);
      expect(resumed[0].reconcile_required).toBe(true);
      expect(resumed.map((frame) => frame.replay.sequence)).toEqual([
        2, 3, 4, 5,
      ]);
      expect(JSON.stringify(resumed)).toContain('fresh evidence');
      expect(execute).toHaveBeenCalledTimes(1);
    });
  });
  it('wires disconnect through the real chat generator, drains and persists cancellation without re-consuming intent', async () => {
    process.env.AI_AGENT_STREAMING_ENABLED = 'true';
    const conversation = {
      id: 7,
      store_id: 1,
      organization_id: 2,
      user_id: 3,
      title: 'existing',
      status: 'active',
      app_key: null,
      metadata: null,
      messages: [],
    };
    const prisma = {
      ai_conversations: {
        findFirst: jest.fn().mockResolvedValue(conversation),
        update: jest.fn().mockResolvedValue({}),
      },
      ai_messages: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: data.role === 'user' ? 1 : 2,
          ...data,
        })),
      },
    };
    const consume = jest.fn().mockResolvedValue({
      conversation_id: 7,
      user_id: 3,
      content: 'Revisa el registro',
    });
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const execute = jest.fn(async function* (params: {
      signal: AbortSignal;
      shouldAbort: () => Promise<boolean>;
    }) {
      started();
      if (!params.signal.aborted)
        await new Promise<void>((resolve) =>
          params.signal.addEventListener('abort', () => resolve(), {
            once: true,
          }),
        );
      expect(await params.shouldAbort()).toBe(true);
      // The legacy abort path can return without a terminal frame.
      return {
        content: '',
        total_tokens: 0,
        tools_used: [
          { name: 'observed_tool', args: {}, result: 'effect uncertain' },
          {
            name: 'read_sales',
            args: {},
            result: JSON.stringify({
              compaction_version: '1',
              ids: Array.from({ length: 120 }, (_, id) => ({ id })),
              artifact_ref: { result_id: 'whole-ref-at-end' },
              complete: false,
            }),
          },
        ],
        aborted: true,
      };
    });
    const service = new AIChatService(
      prisma as never,
      { ai_agents: { findUnique: jest.fn().mockResolvedValue(null) } } as never,
      {
        getApplication: jest
          .fn()
          .mockResolvedValue({ metadata: { agent_enabled: true } }),
      } as never,
      {} as never,
      { runAgentStream: execute } as never,
      {} as never,
      { emit: jest.fn() } as never,
      { buildSnapshot: jest.fn().mockResolvedValue({}) } as never,
      {
        consume,
        claimTurn: jest.fn(),
        isCurrentTurn: jest.fn().mockResolvedValue(true),
      } as never,
      { registerTurn: jest.fn(), releaseTurn: jest.fn() } as never,
      {} as never,
      {
        getActive: jest.fn().mockResolvedValue(null),
        get: jest.fn().mockResolvedValue(null),
        createHook: jest.fn(),
      } as never,
    );
    const client = new AbortController();
    await RequestContextService.run(context, async () => {
      const draining = collect(
        service.sendMessageStream(7, 'opaque', client.signal),
      );
      await running;
      client.abort();
      const terminalFrames = await draining;
      expect(terminalFrames.at(-1)).toMatchObject({
        type: 'done',
        message_id: 2,
      });
      expect(
        prisma.ai_messages.create.mock.calls.map(([input]) => input.data.role),
      ).toEqual(['user', 'assistant']);
      const assistant = prisma.ai_messages.create.mock.calls[1][0].data;
      expect(assistant.content).toContain('verifica');
      expect(assistant.metadata.stream_id).toBe('opaque');
      expect(assistant.tool_calls[0].result).toBe('effect uncertain');
      expect(assistant.tool_calls[1].result.length).toBeGreaterThan(1000);
      expect(JSON.parse(assistant.tool_calls[1].result)).toMatchObject({
        artifact_ref: { result_id: 'whole-ref-at-end' },
        complete: false,
      });
      await collect(
        service.sendMessageStream(7, 'opaque', undefined, {
          after_sequence: 1,
        }),
      );
      expect(consume).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(1);
    });
  });
});
