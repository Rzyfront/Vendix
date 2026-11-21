import { AIChatService } from './ai-chat.service';
import { renderTurnActionsLine } from '../../../ai-engine/context/agent-context-budget';

type Msg = {
  id: number;
  role: string;
  content: string;
  tool_calls?: unknown;
  metadata?: unknown;
};

function windowOf(
  messages: Msg[],
  extra: {
    summary?: string | null;
    summary_through_message_id?: number | null;
    metadata?: unknown;
  } = {},
) {
  const service = Object.create(AIChatService.prototype) as unknown as {
    buildContextWindow(
      conversation: unknown,
      newMessage?: string,
    ): Array<{ role: string; content: string }>;
  };
  // MAX_CONTEXT_MESSAGES is an instance field; Object.create skips initializers.
  Object.assign(service, { MAX_CONTEXT_MESSAGES: 20 });
  return service.buildContextWindow(
    {
      id: 1,
      messages,
      summary: null,
      summary_through_message_id: null,
      metadata: { agent_key: 'vex' },
      ...extra,
    },
    'nuevo',
  );
}

const rows = (n: number, from = 1): Msg[] =>
  Array.from({ length: n }, (_, i) => ({
    id: from + i,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `m${from + i}`,
  }));

describe('T22/T23 buildContextWindow', () => {
  it('pins previous behavior: without summary yields the last 20 + new turn', () => {
    const out = windowOf(rows(30));
    expect(out).toHaveLength(21);
    expect(out[0].content).toBe('m11');
    expect(out[19].content).toBe('m30');
    expect(out[20]).toEqual({ role: 'user', content: 'nuevo' });
  });

  it('T22: with summary prepends it and drops messages covered by it', () => {
    const out = windowOf(rows(30), {
      summary: 'Se creó el producto X.',
      summary_through_message_id: 25,
    });
    expect(out[0].role).toBe('system');
    expect(out[0].content).toContain('Resumen de la conversación anterior');
    expect(out[0].content).toContain('Se creó el producto X.');
    const contents = out.map((m) => m.content);
    expect(contents).not.toContain('m25');
    expect(contents).toContain('m26');
    expect(out).toHaveLength(1 + 5 + 1);
  });

  it('T23: assistant rows carry a compact line with tools and blocks', () => {
    const out = windowOf([
      { id: 1, role: 'user', content: 'hazlo' },
      {
        id: 2,
        role: 'assistant',
        content: 'Listo.',
        tool_calls: [
          { name: 'create_product', result: '{"success":true,"data":{"id":5}}' },
          { name: 'list_orders', result: '{"success":false,"error":"x"}' },
        ],
        metadata: {
          blocks: [{ block_id: 'ab12cd34ef', kind: 'table', version: 1, rows: 12 }],
          pending_confirmation: 'tok-secret',
        },
      },
    ]);
    const line = out[1].content;
    expect(line.startsWith('Listo.')).toBe(true);
    expect(line).toContain(
      '[Acciones de este turno: create_product (ok), list_orders (error)',
    );
    expect(line).toContain('Bloques: table#ab12cd34 (12 filas)]');
    expect(line).not.toContain('tok-secret');
    expect(line).not.toContain('"id":5');
    expect(line.length).toBeLessThan('Listo.'.length + 1 + 320);
  });

  it('S9: a Vexi thread keeps its assistant rows byte-identical', () => {
    const out = windowOf(
      [
        {
          id: 1,
          role: 'assistant',
          content: 'Listo.',
          tool_calls: [{ name: 'create_product', result: '{"success":true}' }],
        },
      ],
      { metadata: null },
    );
    expect(out[0].content).toBe('Listo.');
  });

  it('B3: in a Vex thread applied-write tool rows take no slot; Vexi keeps its raw last-20', () => {
    const mixed: Msg[] = [];
    for (let id = 1; id <= 30; id++)
      mixed.push(
        id % 3 === 0
          ? { id, role: 'tool', content: '' }
          : { id, role: id % 3 === 1 ? 'user' : 'assistant', content: `m${id}` },
      );
    const vex = windowOf(mixed);
    // 20 conversational rows (+ the new turn): m1 is the 20th newest one.
    expect(vex).toHaveLength(21);
    expect(vex[0].content).toBe('m1');
    const vexi = windowOf(mixed, { metadata: null });
    // Previous behavior: the last 20 raw rows, tool rows dropped afterwards.
    expect(vexi[0].content).toBe('m11');
    expect(vexi).toHaveLength(13 + 1);
  });

  it('borde agent_key: a Vexi thread ignores a stored summary and keeps its window', () => {
    const out = windowOf(rows(30), {
      summary: 'Resumen escrito bajo Vex',
      summary_through_message_id: 25,
      metadata: null,
    });
    expect(out).toHaveLength(21);
    expect(out.some((m) => m.content.includes('Resumen'))).toBe(false);
    expect(out[0].content).toBe('m11');
  });

  it('T23: block refs carry the row count production writes (plan §3.4)', async () => {
    const service = Object.create(AIChatService.prototype) as any;
    const vexTurn = { blocks: new Map(), plan: null };
    service.collectVexFrame(vexTurn, {
      type: 'ui_block',
      ui_block: {
        block_id: 'ab12cd34ef',
        kind: 'table',
        version: 2,
        data: { rows: Array.from({ length: 12 }, () => ({})) },
      },
    });
    Object.assign(service, {
      vexBlocks: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'cd56ef7890', kind: 'table', version: 1 }),
      },
    });
    await service
      .blockSinkFor({ id: 1 }, vexTurn)
      .save({ kind: 'table', spec: {}, data: { rows: [1, 2, 3] } });
    const refs = [...vexTurn.blocks.values()];
    expect(refs).toEqual([
      { block_id: 'ab12cd34ef', kind: 'table', version: 2, rows: 12 },
      { block_id: 'cd56ef7890', kind: 'table', version: 1, rows: 3 },
    ]);
    expect(renderTurnActionsLine(undefined, { blocks: refs })).toBe(
      '[Bloques: table#ab12cd34 (12 filas), table#cd56ef78 (3 filas)]',
    );
  });

  it('T23: assistant rows without tools or blocks stay untouched', () => {
    const out = windowOf([{ id: 1, role: 'assistant', content: 'hola' }]);
    expect(out[0].content).toBe('hola');
  });
});
