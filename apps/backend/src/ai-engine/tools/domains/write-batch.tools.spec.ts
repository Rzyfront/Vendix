import {
  createWriteBatchTools,
  PROPOSE_WRITE_BATCH,
  WRITE_BATCH_MAX_STEPS_PER_CALL,
} from './write-batch.tools';

describe('propose_write_batch tool (T34)', () => {
  const step = (n: number) => ({ tool: 'update_price', arguments: { id: n }, label: `p${n}` });

  function build(propose: jest.Mock = jest.fn()) {
    const [tool] = createWriteBatchTools({ batches: { propose } as any });
    // `handler` is optional on RegisteredTool; this tool always declares one.
    expect(tool.handler).toBeDefined();
    const call = async (args: Record<string, unknown>) => JSON.parse(await tool.handler!(args as any, {} as any));
    return { tool, propose, call };
  }

  it('is a public read-only tool named propose_write_batch', () => {
    const { tool } = build();
    expect(tool.name).toBe('propose_write_batch');
    expect(PROPOSE_WRITE_BATCH).toBe('propose_write_batch');
    expect(tool.readOnly).toBe(true);
    expect(tool.access).toBe('public');
    expect(tool.accessReason).toEqual(expect.any(String));
  });

  it('returns an error envelope without conversation_id and does not propose', async () => {
    const { call, propose } = build();
    for (const conversation_id of [undefined, 0, -1, 1.5, 'abc']) {
      const out = await call({ conversation_id, goal: 'g', steps: [step(1)] });
      expect(out.tool).toBe('propose_write_batch');
      expect(out.error).toContain('conversation_id');
      expect(out.next_step).toEqual(expect.any(String));
      expect(out.data).toBeUndefined();
    }
    expect(propose).not.toHaveBeenCalled();
  });

  it('rejects more than 100 steps without calling propose', async () => {
    const { call, propose } = build();
    const steps = Array.from({ length: WRITE_BATCH_MAX_STEPS_PER_CALL + 1 }, (_, i) => step(i));
    const out = await call({ conversation_id: 5, goal: 'g', steps });
    expect(out.error).toContain('101');
    expect(out.error).toContain('No propuse el lote');
    expect(propose).not.toHaveBeenCalled();
  });

  it('accepts exactly 100 steps', async () => {
    const propose = jest.fn().mockResolvedValue({ group_id: null, batches: [] });
    const { call } = build(propose);
    const steps = Array.from({ length: 100 }, (_, i) => step(i));
    await call({ conversation_id: 5, goal: 'g', steps });
    expect(propose).toHaveBeenCalledTimes(1);
  });

  it('forwards a refusal explanation verbatim in an error envelope', async () => {
    const explanation = 'Tu rol no permite inventario (paso 2: Ajustar). No propuse el lote; pídeselo al dueño.';
    const propose = jest.fn().mockResolvedValue({ refused: true, reason: 'permission_denied', explanation });
    const { call } = build(propose);
    const out = await call({ conversation_id: 5, goal: 'g', steps: [step(1)] });
    expect(out.error).toBe(explanation);
    expect(out.next_step).toContain('No digas que se aplicó nada');
    expect(out.data).toBeUndefined();
  });

  it('gives a distinct next_step for irreversible refusals', async () => {
    const propose = jest
      .fn()
      .mockResolvedValue({ refused: true, reason: 'irreversible', explanation: 'no se puede deshacer' });
    const { call } = build(propose);
    const out = await call({ conversation_id: 5, goal: 'g', steps: [step(1)] });
    expect(out.error).toBe('no se puede deshacer');
    expect(out.next_step).toContain('irreversible');
  });

  it('passes conversation, goal and steps to propose', async () => {
    const propose = jest.fn().mockResolvedValue({ group_id: null, batches: [] });
    const { call } = build(propose);
    await call({ conversation_id: 5, goal: 'Subir 5 %', steps: [step(1)] });
    expect(propose).toHaveBeenCalledWith({ conversationId: 5, goal: 'Subir 5 %', steps: [step(1)] });
  });

  it('success: envelope with block_id, kind write_batch and no part_blocks for one part', async () => {
    const block = { id: 'blk1', kind: 'write_batch' };
    const propose = jest.fn().mockResolvedValue({
      group_id: null,
      batches: [{ batch_id: 'b1', part_index: 1, part_total: 1, step_count: 3, block_id: 'blk1', block }],
    });
    const { call } = build(propose);
    const out = await call({ conversation_id: 5, goal: 'g', steps: [step(1), step(2), step(3)] });
    expect(out.error).toBeUndefined();
    expect(out.data).toMatchObject({
      block_id: 'blk1',
      kind: 'write_batch',
      block,
      part_blocks: [],
      group_id: null,
      proposed_steps: 3,
      summary: 'Propuse 3 cambios en una tarjeta.',
    });
    expect(out.data.batches).toEqual([
      { batch_id: 'b1', part_index: 1, part_total: 1, step_count: 3, block_id: 'blk1' },
    ]);
    expect(out.data.next_step).toContain('Nada se aplicó todavía');
  });

  it('success with several parts: part_blocks carries parts 2..n only', async () => {
    const b = (n: number) => ({ id: `blk${n}`, kind: 'write_batch' });
    const propose = jest.fn().mockResolvedValue({
      group_id: 'g1',
      batches: [
        { batch_id: 'b1', part_index: 1, part_total: 3, step_count: 25, block_id: 'blk1', block: b(1) },
        { batch_id: 'b2', part_index: 2, part_total: 3, step_count: 25, block_id: 'blk2', block: b(2) },
        { batch_id: 'b3', part_index: 3, part_total: 3, step_count: 5, block_id: 'blk3', block: b(3) },
      ],
    });
    const { call } = build(propose);
    const out = await call({ conversation_id: 5, goal: 'g', steps: [step(1)] });
    expect(out.data.block_id).toBe('blk1');
    expect(out.data.part_blocks).toEqual([b(2), b(3)]);
    expect(out.data.group_id).toBe('g1');
    expect(out.data.proposed_steps).toBe(55);
    expect(out.data.summary).toBe('Propuse 55 cambios en 3 tarjetas; cada una se aprueba por separado.');
    // Raw blocks are not duplicated into the batches list.
    expect(out.data.batches.every((x: any) => !('block' in x))).toBe(true);
  });

  it('singular wording for one change; missing blocks are filtered from part_blocks', async () => {
    const propose = jest.fn().mockResolvedValue({
      group_id: 'g',
      batches: [
        { batch_id: 'b1', part_index: 1, part_total: 2, step_count: 1 },
        { batch_id: 'b2', part_index: 2, part_total: 2, step_count: 0 },
      ],
    });
    const { call } = build(propose);
    const out = await call({ conversation_id: 5, goal: 'g', steps: [step(1)] });
    expect(out.data.part_blocks).toEqual([]);
    expect(out.data.block_id).toBeUndefined();

    const single = build(jest.fn().mockResolvedValue({
      group_id: null,
      batches: [{ batch_id: 'b1', part_index: 1, part_total: 1, step_count: 1 }],
    }));
    const one = await single.call({ conversation_id: 5, goal: 'g', steps: [step(1)] });
    expect(one.data.summary).toBe('Propuse 1 cambio en una tarjeta.');
  });
});
