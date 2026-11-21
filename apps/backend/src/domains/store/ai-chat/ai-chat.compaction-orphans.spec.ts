import { AIChatService } from './ai-chat.service';
import { ConversationCompactorService } from '../../../ai-engine/context/conversation-compactor.service';
import { estimateAgentInputTokens } from '../../../ai-engine/context/agent-context-budget';

/**
 * B3 (F3 r2): every live row after the summary pointer either travels to the
 * model in the window or is covered by the summary. An «orphan» is a
 * conversational row newer than the pointer that the window leaves out.
 * Drives the real `compactVexHistory` + `buildContextWindow` with the real
 * compactor (summarizer down = what production runs today).
 */

type Row = {
  id: number;
  role: string;
  content: string;
  tool_calls?: unknown;
  metadata?: unknown;
};

type Conversation = {
  id: number;
  metadata: unknown;
  summary: string | null;
  summary_through_message_id: number | null;
  messages: Row[];
};

type Harness = {
  compactVexHistory(
    conversation: Conversation,
    agentKey: string,
  ): Promise<{ conversation: Conversation; frame: unknown }>;
  buildContextWindow(
    conversation: Conversation,
    newMessage?: string,
  ): Array<{ role: string; content: string }>;
};

const WINDOW = 32768;
const budgetAt = (percent: number) => ({
  estimated_input_tokens: Math.round((WINDOW * percent) / 100),
  omitted_messages: 0,
  context_window_tokens: WINDOW,
  max_output_tokens: 4096,
  provenance: 'configured' as const,
  method: 'conservative_estimate' as const,
});

/** The auditor's turns: 220-char question, 700-char answer with a tool and a block. */
function turnRows(from: number, count: number, percent: number): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const id = from + i;
    if (id % 2 === 1) {
      return { id, role: 'user', content: `«r${id}» ${'pregunta '.repeat(24)}` };
    }
    return {
      id,
      role: 'assistant',
      content: `«r${id}» Listo. Vendiste $${id}.000 hoy. ${'detalle '.repeat(84)}`,
      tool_calls: [{ name: 'list_orders', result: '{"success":true}' }],
      metadata: {
        blocks: [{ block_id: `blk-${id}-abcdef`, kind: 'table', rows: 12 }],
        context_budget: budgetAt(percent),
      },
    };
  });
}

function harness() {
  const update = jest.fn().mockResolvedValue({});
  const compactor = new ConversationCompactorService(
    { run: jest.fn().mockRejectedValue(new Error('app inactive')) } as never,
    { ai_conversations: { update } } as never,
  );
  const service = Object.create(AIChatService.prototype) as Harness;
  // Instance fields: Object.create skips initializers.
  Object.assign(service, { MAX_CONTEXT_MESSAGES: 20, compactor });
  return { service, update };
}

/** Conversational rows newer than the pointer that the window leaves out. */
function orphansOf(service: Harness, conversation: Conversation): number[] {
  const window = service.buildContextWindow(conversation, 'nuevo');
  const sent = window.map((m) => m.content).join('\n');
  const through = conversation.summary_through_message_id ?? 0;
  return conversation.messages
    .filter(
      (m) =>
        m.id > through &&
        (m.role === 'user' || m.role === 'assistant' || m.role === 'system'),
    )
    .filter((m) => !sent.includes(`«r${m.id}»`))
    .map((m) => m.id);
}

/** Estimated tokens of the history the window sends (the part compaction controls). */
function windowTokens(service: Harness, conversation: Conversation): number {
  return estimateAgentInputTokens(
    service.buildContextWindow(conversation, 'nuevo') as never,
    [],
  );
}

async function turn(service: Harness, conversation: Conversation) {
  return (await service.compactVexHistory(conversation, 'vex')).conversation;
}

const fresh = (rows: Row[]): Conversation => ({
  id: 9,
  metadata: { agent_key: 'vex' },
  summary: null,
  summary_through_message_id: null,
  messages: rows,
});

describe('B3 no live row is left out of the window without being summarized', () => {
  // 34 %: the flat ring the auditor measured from row 20 on; 80 %: over the threshold.
  describe.each([34, 80])('ring at %i %%', (percent) => {
    it.each([60, 200])('a %i-row thread has 0 orphans after its turn', async (n) => {
      const { service } = harness();
      const after = await turn(service, fresh(turnRows(1, n, percent)));
      expect(orphansOf(service, after)).toEqual([]);
    });

    it('three compactions in a row (+24 rows each) leave 0 orphans every time', async () => {
      const { service, update } = harness();
      let conversation = fresh(turnRows(1, 48, percent));
      const orphans: number[][] = [];
      for (let pass = 0; pass < 3; pass++) {
        conversation = await turn(service, conversation);
        orphans.push(orphansOf(service, conversation));
        const next = conversation.messages.length + 1;
        conversation = {
          ...conversation,
          messages: [...conversation.messages, ...turnRows(next, 24, percent)],
        };
      }
      expect(orphans).toEqual([[], [], []]);
      expect(update).toHaveBeenCalledTimes(3);
    });
  });

  describe('P1-1 compacting lowers what the next turn sends', () => {
    it.each([60, 200])('%i rows over the threshold: the window shrinks', async (n) => {
      const { service } = harness();
      const before = fresh(turnRows(1, n, 80));
      const after = await turn(service, before);
      expect(after).not.toBe(before);
      expect(windowTokens(service, after)).toBeLessThan(
        windowTokens(service, before),
      );
    });

    it('every one of three passes shrinks the window', async () => {
      const { service } = harness();
      let conversation = fresh(turnRows(1, 48, 80));
      for (let pass = 0; pass < 3; pass++) {
        const after = await turn(service, conversation);
        expect(after).not.toBe(conversation);
        expect(windowTokens(service, after)).toBeLessThan(
          windowTokens(service, conversation),
        );
        const next = after.messages.length + 1;
        conversation = {
          ...after,
          messages: [...after.messages, ...turnRows(next, 24, 80)],
        };
      }
    });
  });

  it('a thread that never had a ring budget (legacy) also compacts once rows overflow the window', async () => {
    const { service } = harness();
    const rows = turnRows(1, 60, 34).map((r) => ({ ...r, metadata: undefined }));
    const after = await turn(service, fresh(rows));
    expect(orphansOf(service, after)).toEqual([]);
  });

  it('tool rows (applied writes) do not steal window slots from conversational rows', async () => {
    const { service } = harness();
    const rows: Row[] = [];
    let id = 1;
    // 9 exchanges, each followed by an applied-write `tool` row: 27 rows, 18 conversational.
    for (let i = 0; i < 9; i++) {
      rows.push({ id, role: 'user', content: `«r${id}» hola` });
      id++;
      rows.push({
        id,
        role: 'assistant',
        content: `«r${id}» listo`,
        metadata: { context_budget: budgetAt(34) },
      });
      id++;
      rows.push({ id, role: 'tool', content: '' });
      id++;
    }
    const after = await turn(service, fresh(rows));
    expect(orphansOf(service, after)).toEqual([]);
  });

  it('pins previous behavior: a thread that fits the window under the threshold does not compact', async () => {
    const { service, update } = harness();
    const conversation = fresh(turnRows(1, 20, 34));
    const after = await turn(service, conversation);
    expect(after).toBe(conversation);
    expect(update).not.toHaveBeenCalled();
    expect(orphansOf(service, after)).toEqual([]);
  });
});
