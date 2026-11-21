import { AIChatController } from './ai-chat.controller';

/**
 * F3 r2 P2-3: the provider cost persisted per message (T24) never reaches the
 * store's browser, neither in the conversation nor in the list preview.
 */
describe('AIChatController keeps cost_usd out of message rows', () => {
  const row = (id: number) => ({
    id,
    role: 'assistant',
    content: 'Listo.',
    tokens_used: 12,
    cost_usd: '0.01234567',
    metadata: { context_budget: { estimated_input_tokens: 1 } },
  });

  function build() {
    const chatService = {
      getConversation: jest
        .fn()
        .mockResolvedValue({ id: 7, title: 'x', messages: [row(1), row(2)] }),
      listConversations: jest.fn().mockResolvedValue({
        data: [{ id: 7, title: 'x', messages: [row(2)] }, { id: 8, title: 'y' }],
        meta: { total: 2, page: 1, limit: 20, totalPages: 1 },
      }),
    };
    const responseService = {
      success: jest.fn((data: unknown, message: string, meta?: unknown) => ({
        data,
        message,
        meta,
      })),
    };
    const controller = new AIChatController(
      chatService as never,
      responseService as never,
      {} as never,
    );
    return { controller };
  }

  it('GET conversations/:id returns the rows without cost_usd, the rest intact', async () => {
    const { controller } = build();
    const out = (await controller.getConversation(7)) as {
      data: { messages: Record<string, unknown>[] };
    };
    expect(out.data.messages).toHaveLength(2);
    for (const message of out.data.messages) {
      expect(message).not.toHaveProperty('cost_usd');
      expect(message).toMatchObject({ role: 'assistant', tokens_used: 12 });
      expect(message.metadata).toEqual({
        context_budget: { estimated_input_tokens: 1 },
      });
    }
  });

  it('GET conversations keeps the last-message preview without cost_usd', async () => {
    const { controller } = build();
    const out = (await controller.listConversations({} as never)) as {
      data: Array<{ id: number; messages?: Record<string, unknown>[] }>;
      meta: unknown;
    };
    expect(out.data[0].messages![0]).not.toHaveProperty('cost_usd');
    expect(out.data[0].messages![0].content).toBe('Listo.');
    expect(out.data[1]).toEqual({ id: 8, title: 'y' });
    expect(out.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
  });
});
