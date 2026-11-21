import {
  ConversationCompactorService,
  KEEP_LAST_MESSAGES,
  MAX_FALLBACK_SUMMARY_CHARS,
} from './conversation-compactor.service';

const msgs = (n: number, size = 40) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${i % 2 === 0 ? 'pregunta' : 'respuesta'} ${i + 1} ${'x'.repeat(size)}`,
  }));

const budgetOf = (percent: number, window = 32768) => ({
  estimated_input_tokens: Math.round((window * percent) / 100),
  omitted_messages: 0,
  context_window_tokens: window,
  provenance: 'configured' as const,
  method: 'conservative_estimate' as const,
});

function build(run: jest.Mock) {
  const update = jest.fn().mockResolvedValue({});
  const service = new ConversationCompactorService(
    { run } as never,
    { ai_conversations: { update } } as never,
  );
  return { service, update, run };
}

describe('T22 ConversationCompactorService', () => {
  it('does nothing under 75 % of the ring measure or without a budget', async () => {
    const { service, update, run } = build(jest.fn());
    const conv = {
      id: 7,
      summary: null,
      summary_through_message_id: null,
      messages: msgs(40),
    };
    expect(await service.compactIfNeeded(conv, budgetOf(74))).toBeNull();
    const out = await service.compactIfNeeded(conv, null);
    expect(out).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('summarizes older messages with the model, keeps last 10, persists', async () => {
    const run = jest
      .fn()
      .mockResolvedValue({ success: true, content: 'Resumen del modelo' });
    const { service, update } = build(run);
    const out = await service.compactIfNeeded(
      {
        id: 7,
        summary: 'previo',
        summary_through_message_id: 2,
        messages: msgs(40),
      },
      budgetOf(80),
    );
    expect(out).toEqual({
      summary: 'Resumen del modelo',
      summary_through_message_id: 40 - KEEP_LAST_MESSAGES,
    });
    expect(run).toHaveBeenCalledWith(
      'vex_context_summarizer',
      expect.objectContaining({
        previous_summary: 'previo',
        transcript: expect.stringContaining('pregunta 3'),
      }),
    );
    const transcript = run.mock.calls[0][1].transcript as string;
    expect(transcript).not.toContain('pregunta 1 ');
    expect(transcript).not.toContain('respuesta 40');
    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { summary: 'Resumen del modelo', summary_through_message_id: 30 },
    });
  });

  it('falls back to a bounded extractive summary when the model fails', async () => {
    const run = jest.fn().mockRejectedValue(new Error('app inactive'));
    const { service, update } = build(run);
    const out = await service.compactIfNeeded(
      {
        id: 7,
        summary: 'previo',
        summary_through_message_id: null,
        messages: msgs(200, 60),
      },
      budgetOf(80),
    );
    expect(out).not.toBeNull();
    expect(out!.summary.startsWith('previo')).toBe(true);
    expect(out!.summary).toContain('pregunta 1 ');
    expect(out!.summary.length).toBeLessThanOrEqual(MAX_FALLBACK_SUMMARY_CHARS);
    expect(out!.summary_through_message_id).toBe(190);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('still returns the summary when persisting fails (turn never fails)', async () => {
    const run = jest.fn().mockResolvedValue({ success: false });
    const { service, update } = build(run);
    update.mockRejectedValue(new Error('db'));
    const out = await service.compactIfNeeded(
      { id: 7, summary: null, summary_through_message_id: null, messages: msgs(60) },
      budgetOf(80),
    );
    expect(out?.summary_through_message_id).toBe(50);
  });
});
