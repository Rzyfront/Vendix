import {
  CHAT_WINDOW_MESSAGES,
  ConversationCompactorService,
  MAX_KEEP_MESSAGES,
  MAX_SUMMARY_CHARS,
  MIN_KEEP_MESSAGES,
  VEX_SUMMARIZER_APP_KEY,
  type CompactableMessage,
} from './conversation-compactor.service';

const budgetOf = (percent: number, window = 32768) => ({
  estimated_input_tokens: Math.round((window * percent) / 100),
  omitted_messages: 0,
  context_window_tokens: window,
  provenance: 'configured' as const,
  method: 'conservative_estimate' as const,
});

/** Alternating turns; assistant rows answer with a figure. */
const msgs = (n: number, size = 40, from = 1): CompactableMessage[] =>
  Array.from({ length: n }, (_, i) => {
    const id = from + i;
    return i % 2 === 0
      ? { id, role: 'user', content: `pregunta ${id} ${'x'.repeat(size)}` }
      : {
          id,
          role: 'assistant',
          content: `Hecho. Total de la respuesta ${id}: $${id}.000. ${'y'.repeat(size)}`,
        };
  });

function build(run: jest.Mock) {
  const update = jest.fn().mockResolvedValue({});
  const service = new ConversationCompactorService(
    { run } as never,
    { ai_conversations: { update } } as never,
  );
  return { service, update, run };
}

const down = () => jest.fn().mockRejectedValue(new Error('app inactive'));

describe('T22 ConversationCompactorService', () => {
  it('rows that fit the window: below 75 % or without a budget nothing runs', async () => {
    const { service, update, run } = build(jest.fn());
    const conv = {
      id: 7,
      summary: null,
      summary_through_message_id: null,
      messages: msgs(CHAT_WINDOW_MESSAGES),
    };
    expect(await service.compactIfNeeded(conv, budgetOf(74))).toBeNull();
    expect(await service.compactIfNeeded(conv, null)).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('B3: live rows past the window compact even under 75 % or without a budget', async () => {
    const { service } = build(down());
    const conv = {
      id: 7,
      summary: null,
      summary_through_message_id: null,
      messages: msgs(CHAT_WINDOW_MESSAGES + 1),
    };
    const low = await service.compactIfNeeded(conv, budgetOf(20));
    expect(low!.summary_through_message_id).toBe(
      CHAT_WINDOW_MESSAGES + 1 - MAX_KEEP_MESSAGES,
    );
    const legacy = await service.compactIfNeeded(conv, null);
    expect(legacy!.summary_through_message_id).toBe(
      low!.summary_through_message_id,
    );
  });

  it('keeps half the window literal when it fits, so a pass always frees room', async () => {
    const { service } = build(down());
    const out = await service.compactIfNeeded(
      { id: 7, summary: null, summary_through_message_id: null, messages: msgs(40) },
      budgetOf(80),
    );
    expect(out!.summary_through_message_id).toBe(40 - MAX_KEEP_MESSAGES);
  });

  it('keeps fewer (never under the last exchange) when the recent rows do not fit the window share', async () => {
    const { service } = build(down());
    const out = await service.compactIfNeeded(
      {
        id: 7,
        summary: null,
        summary_through_message_id: null,
        messages: msgs(40, 3000),
      },
      budgetOf(80),
    );
    const kept = 40 - out!.summary_through_message_id;
    expect(kept).toBeGreaterThanOrEqual(MIN_KEEP_MESSAGES);
    expect(kept).toBeLessThan(MAX_KEEP_MESSAGES);
  });

  it('model path: transcript carries assistant turns and actions; the call is cancellable', async () => {
    const run = jest
      .fn()
      .mockResolvedValue({ success: true, content: 'Resumen del modelo' });
    const { service, update } = build(run);
    const messages = msgs(40);
    messages[1] = {
      ...messages[1],
      tool_calls: [{ name: 'list_orders', result: '{"success":true}' }],
    };
    const out = await service.compactIfNeeded(
      { id: 7, summary: 'previo', summary_through_message_id: null, messages },
      budgetOf(90),
    );
    expect(out).toEqual({
      summary: 'Resumen del modelo',
      summary_through_message_id: 40 - MAX_KEEP_MESSAGES,
    });
    const [appKey, vars, , options] = run.mock.calls[0];
    expect(appKey).toBe(VEX_SUMMARIZER_APP_KEY);
    expect(vars.previous_summary).toBe('previo');
    expect(vars.transcript).toContain('assistant: Hecho. Total de la respuesta 2');
    expect(vars.transcript).toContain('list_orders (ok)');
    expect(vars.transcript).toContain('pregunta 29 ');
    expect(vars.transcript).not.toContain('pregunta 31 ');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        summary: 'Resumen del modelo',
        summary_through_message_id: 40 - MAX_KEEP_MESSAGES,
      },
    });
  });

  it('B3 model path: a transcript too long gives every older row an even share, none is cut off', async () => {
    const run = jest
      .fn()
      .mockResolvedValue({ success: true, content: 'Resumen del modelo' });
    const { service } = build(run);
    const out = await service.compactIfNeeded(
      {
        id: 7,
        summary: null,
        summary_through_message_id: null,
        messages: msgs(300, 400),
      },
      budgetOf(80, 1_000_000),
    );
    expect(out!.summary_through_message_id).toBe(300 - MAX_KEEP_MESSAGES);
    const transcript: string = run.mock.calls[0][1].transcript;
    expect(transcript.length).toBeLessThanOrEqual(60_000);
    const rows = transcript.split('\n');
    expect(rows).toHaveLength(300 - MAX_KEEP_MESSAGES);
    expect(rows[0]).toContain('pregunta 1 ');
    expect(rows[rows.length - 1]).toContain('respuesta 290');
  });

  it('timeout aborts the summarizer call and falls back to the extractive summary', async () => {
    let signal: AbortSignal | undefined;
    const run = jest.fn((_k, _v, _m, options) => {
      signal = options.signal;
      return new Promise(() => undefined);
    });
    const { service } = build(run as jest.Mock);
    const out = await service.compactIfNeeded(
      { id: 7, summary: null, summary_through_message_id: null, messages: msgs(40) },
      budgetOf(80),
      20,
    );
    expect(signal?.aborted).toBe(true);
    expect(out!.summary).toContain('- Persona: pregunta 1 ');
  });

  it('first extractive compaction: the person and Vex (figures + actions), all covered', async () => {
    const { service } = build(down());
    const messages = msgs(40);
    messages[3] = {
      ...messages[3],
      tool_calls: [
        { name: 'create_product', result: '{"success":true}' },
        { name: 'list_orders', result: '{"success":false,"error":"x"}' },
      ],
    };
    const out = await service.compactIfNeeded(
      { id: 7, summary: null, summary_through_message_id: null, messages },
      budgetOf(80),
    );
    expect(out!.summary_through_message_id).toBe(40 - MAX_KEEP_MESSAGES);
    expect(out!.summary).toContain('- Persona: pregunta 1 ');
    expect(out!.summary).toContain('- Vex: Hecho. Total de la respuesta 2: $2.000.');
    expect(out!.summary).toContain('create_product (ok), list_orders (error)');
    expect(out!.summary).toContain('pregunta 29 ');
    expect(out!.summary).toContain('respuesta 30');
    expect(out!.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
  });

  it('second compaction: the full previous summary is re-summarized, the new rows enter and the beginning survives', async () => {
    const { service, update } = build(down());
    const first = await service.compactIfNeeded(
      {
        id: 7,
        summary: null,
        summary_through_message_id: null,
        messages: msgs(80, 120),
      },
      budgetOf(80),
    );
    expect(first!.summary.length).toBeGreaterThan(MAX_SUMMARY_CHARS * 0.8);
    const second = await service.compactIfNeeded(
      {
        id: 7,
        summary: first!.summary,
        summary_through_message_id: first!.summary_through_message_id,
        messages: msgs(120, 120),
      },
      budgetOf(80),
    );
    expect(second).not.toBeNull();
    const s = second!.summary;
    expect(s.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    // What was said at the very beginning is still there…
    expect(s).toContain('pregunta 1 ');
    // …and the rows this pass covers made it in, up to the new pointer.
    const through = second!.summary_through_message_id;
    expect(through).toBeGreaterThan(first!.summary_through_message_id);
    expect(s).toContain(`respuesta ${through % 2 === 0 ? through : through - 1}`);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('B3: covers every older row in one pass; what does not fit is counted, never dropped', async () => {
    const { service } = build(down());
    const messages = msgs(300, 200);
    const out = await service.compactIfNeeded(
      { id: 7, summary: null, summary_through_message_id: null, messages },
      budgetOf(80, 1_000_000),
    );
    const through = out!.summary_through_message_id;
    // The pointer reaches the last older row: no gap before the window…
    expect(through).toBe(300 - MAX_KEEP_MESSAGES);
    const lines = out!.summary.split('\n').slice(1);
    // …the beginning and the newest covered rows keep their line…
    expect(out!.summary).toContain('pregunta 1 ');
    expect(out!.summary).toContain(`respuesta ${through}`);
    // …and the rows in between are counted in the marker: one point per row.
    const marker = lines.find((l) => /puntos intermedios omitidos/.test(l));
    const omitted = Number(/(\d+) puntos/.exec(marker!)![1]);
    expect(lines.length - 1 + omitted).toBe(through);
    expect(out!.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
  });

  it('a failed persist is no compaction: no result, so no «Resumí…» notice', async () => {
    const { service, update } = build(down());
    update.mockRejectedValue(new Error('db'));
    const out = await service.compactIfNeeded(
      { id: 7, summary: null, summary_through_message_id: null, messages: msgs(60) },
      budgetOf(80),
    );
    expect(out).toBeNull();
  });
});
