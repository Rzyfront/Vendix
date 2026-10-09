import { AIAgentService } from '../../../../ai-engine/ai-agent.service';
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import { createVexBlockTools } from '../../../../ai-engine/tools/domains/vex-blocks.tools';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VexBlockService } from './vex-block.service';

function makeDelegate() {
  const rows: any[] = [];
  return {
    rows,
    findFirst: jest.fn(async ({ where }: any) => {
      const found = rows.find(
        (r) =>
          (where.id === undefined || r.id === where.id) &&
          (where.store_id === undefined || r.store_id === where.store_id) &&
          (where.conversation_id === undefined ||
            r.conversation_id === where.conversation_id),
      );
      return found ? { ...found } : null;
    }),
    findMany: jest.fn(async ({ where }: any) => {
      return rows
        .filter(
          (r) =>
            (where.store_id === undefined || r.store_id === where.store_id) &&
            (where.conversation_id === undefined ||
              r.conversation_id === where.conversation_id),
        )
        .map((r) => ({ ...r }));
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { ...data, created_at: new Date() };
      rows.push(row);
      return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) {
        const idMatch =
          where.id === undefined ||
          (typeof where.id === 'object' && where.id !== null
            ? (where.id.in ?? []).includes(r.id)
            : r.id === where.id);
        const messageMatch =
          where.message_id === undefined ||
          (where.message_id === null
            ? r.message_id === null || r.message_id === undefined
            : r.message_id === where.message_id);
        if (
          idMatch &&
          messageMatch &&
          (where.store_id === undefined || r.store_id === where.store_id)
        ) {
          Object.assign(r, data);
          count++;
        }
      }
      return { count };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].id === where.id && rows[i].store_id === where.store_id) {
          rows.splice(i, 1);
        }
      }
      return { count: before - rows.length };
    }),
  };
}

describe('VexBlockService', () => {
  let delegate: ReturnType<typeof makeDelegate>;
  let findConversation: jest.Mock;
  let service: VexBlockService;
  let getStoreId: jest.SpyInstance;
  let getContext: jest.SpyInstance;

  beforeEach(() => {
    delegate = makeDelegate();
    // El hilo 1 es del usuario 9 en la tienda 7; cualquier otro
    // `conversation_id` (o usuario) no existe para este contexto.
    findConversation = jest.fn(async ({ where }: any) =>
      where.id === 1 && where.user_id === 9
        ? { id: 1, store_id: 7, user_id: 9 }
        : null,
    );
    const prisma = {
      ai_ui_blocks: delegate,
      ai_conversations: { findFirst: findConversation },
    };
    const s3 = {
      getPresignedUrl: jest.fn(async (key: string) => `https://signed/${key}`),
    };
    service = new VexBlockService(prisma as any, s3 as any);
    getStoreId = jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(7);
    getContext = jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9, store_id: 7 } as any);
  });

  afterEach(() => {
    getStoreId.mockRestore();
    getContext.mockRestore();
  });

  it('creates a table block and reads its rows back paged', async () => {
    const created = await service.create({
      conversation_id: 1,
      kind: 'table',
      spec: { title: 'Ventas' },
      data: {
        columns: [{ key: 'total', label: 'Total' }],
        rows: [{ total: 1 }, { total: 2 }, { total: 3 }],
      },
    });
    expect(created.version).toBe(1);
    expect(created.store_id).toBe(7);

    const page = await service.readPaged(created.id, 2, 2);
    expect(page.total_rows).toBe(3);
    expect(page.rows).toEqual([{ total: 3 }]);
  });

  it.each(['plain', 'escaped'])(
    'reconstructs long %s markdown by cursor without recursive compaction',
    async (kind) => {
      const text =
        kind === 'plain'
          ? 'Ventas café ☕\n'.repeat(1000)
          : String.fromCharCode(0).repeat(9000) + 'fin';
      const created = await service.create({
        conversation_id: 1,
        kind: 'markdown',
        data: { text },
      });
      const read = createVexBlockTools({ blocks: service }).find(
        (t) => t.name === 'vex_block_read',
      )!;
      let offset = 0;
      let reconstructed = '';
      let pages = 0;
      while (true) {
        const envelope = await read.handler!(
          { block_id: created.id, text_offset: offset },
          {} as any,
        );
        expect(envelope.length).toBeLessThan(6000);
        const { data } = JSON.parse(envelope);
        expect(data.kind).toBe('markdown');
        expect(data.total_chars).toBe(text.length);
        expect(data.text_offset).toBe(offset);
        expect(data.text.length).toBeLessThanOrEqual(3000);
        reconstructed += data.text;
        pages++;
        if (!data.has_more) {
          expect(data.next_offset).toBeNull();
          break;
        }
        expect(data.next_offset).toBeGreaterThan(offset);
        offset = data.next_offset;
        expect(pages).toBeLessThan(100);
      }
      expect(pages).toBeGreaterThan(1);
      expect(reconstructed).toBe(text);
      const end = await service.readPaged(created.id, 1, 50, {
        offset: text.length + 10,
      });
      expect(end).toMatchObject({
        text: '',
        has_more: false,
        next_offset: null,
      });
    },
  );

  it.each([
    { offset: -9, limit: 999999 },
    { offset: NaN, limit: Infinity },
    { offset: 0.9, limit: 1.9 },
  ])('clamps malformed text reader bounds %j', async (options) => {
    const text = 'x'.repeat(7000);
    const created = await service.create({
      conversation_id: 1,
      kind: 'markdown',
      data: { text },
    });
    const page = await service.readPaged(created.id, 1, 50, options);
    expect(page.text_offset).toBe(0);
    expect(page.text!.length).toBeGreaterThan(0);
    expect(page.text!.length).toBeLessThanOrEqual(3000);
    expect(page.next_offset).toBe(page.text!.length);
  });

  it('markdown cursor reads still fail closed for another store or conversation owner', async () => {
    const created = await service.create({
      conversation_id: 1,
      kind: 'markdown',
      data: { text: 'privado' },
    });
    getStoreId.mockReturnValue(999);
    await expect(
      service.readPaged(created.id, 1, 50, { offset: 0 }),
    ).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
    getStoreId.mockReturnValue(7);
    getContext.mockReturnValue({ user_id: 999, store_id: 7 });
    await expect(
      service.readPaged(created.id, 1, 50, { offset: 0 }),
    ).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
    getContext.mockReturnValue({ store_id: 7 });
    await expect(service.readPaged(created.id)).rejects.toMatchObject({
      errorCode: 'SYS_NOT_FOUND_001',
    });
  });

  it('real loop compaction → real block sink → real read tool recovers the original JSON', async () => {
    const raw = JSON.stringify({
      data: Array.from({ length: 400 }, (_, id) => ({
        id,
        name: `café ${id}`,
      })),
    });
    expect(raw.length).toBeGreaterThan(6000);
    const registry = new AIToolRegistry({} as any);
    const initialRead = jest.fn().mockResolvedValue(raw);
    registry.register({
      name: 'read_dataset',
      domain: 'probe',
      readOnly: true,
      description: 'Leer',
      parameters: { type: 'object' },
      handler: initialRead,
    });
    registry.registerMany(createVexBlockTools({ blocks: service }));
    let recovered = '';
    let callId = 0;
    const toolCall = (name: string, args: any) => ({
      success: true,
      content: '',
      usage: { totalTokens: 1 },
      tool_calls: [
        {
          id: `c${++callId}`,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    });
    const chat = jest.fn(async (messages: any[]) => {
      const last = messages.at(-1);
      if (last.role !== 'tool') return toolCall('read_dataset', {});
      const result = JSON.parse(last.content);
      if (result.block_id)
        return toolCall('vex_block_read', {
          block_id: result.block_id,
          text_offset: 0,
        });
      recovered += result.data.text;
      if (result.data.has_more)
        return toolCall('vex_block_read', {
          block_id: result.data.block_id,
          text_offset: result.data.next_offset,
        });
      return {
        success: true,
        content: 'Datos recuperados',
        usage: { totalTokens: 1 },
      };
    });
    const save = jest.fn(
      async (input: any) => (await service.create(input)).id,
    );
    const loop = new AIAgentService(
      { chat } as any,
      {} as any,
      registry,
      { emit: jest.fn() } as any,
      {} as any,
      {
        canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
        getAIFeatureConfig: jest
          .fn()
          .mockResolvedValue({ tools_allowed: ['*'] }),
        checkExtraQuota: jest.fn().mockResolvedValue({ exceeded: false }),
        consumeExtraQuota: jest.fn(),
        consumeAIQuota: jest.fn(),
      } as any,
    );
    const result = await loop.runAgent({
      goal: 'Leer todo',
      agent_key: 'vex',
      conversation_id: 1,
      block_sink: { save },
    });
    expect(result.success).toBe(true);
    expect(result.content).toBe('Datos recuperados');
    expect(recovered).toBe(raw);
    expect(JSON.parse(recovered).data).toHaveLength(400);
    expect(initialRead).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      result.tools_used.filter((t) => t.name === 'vex_block_read').length,
    ).toBeGreaterThan(1);
  });

  it.each([
    { text_offset: 1.5 },
    { text_offset: true },
    { text_limit: 'not a number' },
    { text_limit: [] },
  ])(
    'registry rejects invalid text cursor args %j before calling the reader',
    async (args) => {
      const registry = new AIToolRegistry({} as any);
      registry.registerMany(createVexBlockTools({ blocks: service }));
      const read = jest.spyOn(service, 'readPaged');
      const result = JSON.parse(
        await registry.executeTool('vex_block_read', {
          block_id: 'blk_1',
          ...args,
        }),
      );
      expect(result.error).toBeTruthy();
      expect(read).not.toHaveBeenCalled();
      read.mockRestore();
    },
  );

  it('retains registry numeric-string coercion and bounds text in the reader', async () => {
    const created = await service.create({
      conversation_id: 1,
      kind: 'markdown',
      data: { text: 'x'.repeat(7000) },
    });
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(createVexBlockTools({ blocks: service }));
    const result = JSON.parse(
      await registry.executeTool('vex_block_read', {
        block_id: created.id,
        text_offset: '5',
        text_limit: '99999',
      }),
    );
    expect(result.data.text_offset).toBe(5);
    expect(result.data.text.length).toBe(3000);
    expect(result.data.next_offset).toBe(3005);
  });

  it('rejects tables without columns and enforces the 5000-row cap', async () => {
    await expect(
      service.create({
        conversation_id: 1,
        kind: 'table',
        data: { rows: [] },
      }),
    ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });

    await expect(
      service.create({
        conversation_id: 1,
        kind: 'table',
        data: {
          columns: [{ key: 'a', label: 'A' }],
          rows: Array.from({ length: 5001 }, () => ({ a: 1 })),
        },
      }),
    ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
  });

  it('isolates blocks by store: another store id answers 404', async () => {
    const created = await service.create({
      conversation_id: 1,
      kind: 'markdown',
      data: { text: 'hola' },
    });
    getStoreId.mockReturnValue(999);
    await expect(service.getById(created.id)).rejects.toMatchObject({
      errorCode: 'SYS_NOT_FOUND_001',
    });
  });

  it('transforms filter + sum into a new version without touching the original', async () => {
    const created = await service.create({
      conversation_id: 1,
      kind: 'table',
      data: {
        columns: [
          { key: 'categoria', label: 'Categoría' },
          { key: 'total', label: 'Total' },
        ],
        rows: [
          { categoria: 'café', total: 10 },
          { categoria: 'té', total: 4 },
          { categoria: 'café', total: 6 },
        ],
      },
    });

    const derived = await service.transform(created.id, {
      filter: [{ field: 'total', op: 'gte', value: 5 }],
      group_by: 'categoria',
      aggregate: { field: 'total', function: 'sum' },
    });

    expect(derived.id).not.toBe(created.id);
    expect(derived.version).toBe(2);
    expect(derived.spec.derived_from).toBe(created.id);
    expect((derived.data as any).rows).toEqual([
      { categoria: 'café', sum_total: 16 },
    ]);

    const original = await service.getById(created.id);
    expect((original.data as any).rows).toHaveLength(3);
  });

  it('sorts transform output and refuses to transform non-tables', async () => {
    const created = await service.create({
      conversation_id: 1,
      kind: 'table',
      data: {
        columns: [{ key: 'total', label: 'Total' }],
        rows: [{ total: 2 }, { total: 9 }, { total: 5 }],
      },
    });
    const derived = await service.transform(created.id, {
      sort: [{ field: 'total', direction: 'desc' }],
    });
    expect((derived.data as any).rows.map((r: any) => r.total)).toEqual([
      9, 5, 2,
    ]);

    const kpi = await service.create({
      conversation_id: 1,
      kind: 'kpi',
      data: { label: 'Ventas', value: 100 },
    });
    await expect(service.transform(kpi.id, {})).rejects.toMatchObject({
      errorCode: 'SYS_VALIDATION_001',
    });
  });

  it('stores S3 keys only and signs them at read time', async () => {
    const created = await service.create({
      conversation_id: 1,
      kind: 'image',
      data: { s3_key: 'vex-blocks/stores/7/abc.png', alt: 'gráfico' },
    });
    expect((created.data as any).s3_key).toBe('vex-blocks/stores/7/abc.png');

    const read = await service.getById(created.id);
    expect(read.signed_url).toBe('https://signed/vex-blocks/stores/7/abc.png');

    await expect(
      service.create({
        conversation_id: 1,
        kind: 'file',
        data: {
          s3_key: 'https://bucket.s3.amazonaws.com/x.xlsx?X-Amz-Expires=1',
          filename: 'x.xlsx',
        },
      }),
    ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
  });

  it('records interactions inside spec, never inside data', async () => {
    const created = await service.create({
      conversation_id: 1,
      kind: 'table',
      data: {
        columns: [{ key: 'total', label: 'Total' }],
        rows: [{ total: 1 }],
      },
    });
    const updated = await service.recordInteraction(created.id, {
      type: 'row_select',
      payload: { keys: [0] },
    });
    expect((updated.spec as any).last_interaction.type).toBe('row_select');
    expect((updated.data as any).rows).toEqual([{ total: 1 }]);
  });

  it('deletes scoped: missing or foreign ids answer 404', async () => {
    const created = await service.create({
      conversation_id: 1,
      kind: 'markdown',
      data: { text: 'x' },
    });
    await service.delete(created.id);
    await expect(service.getById(created.id)).rejects.toMatchObject({
      errorCode: 'SYS_NOT_FOUND_001',
    });
    await expect(service.delete('no-existe')).rejects.toMatchObject({
      errorCode: 'SYS_NOT_FOUND_001',
    });
  });

  it('create valida la conversación en tienda y usuario', async () => {
    await service.create({
      conversation_id: 1,
      kind: 'markdown',
      data: { text: 'ok' },
    });
    expect(findConversation).toHaveBeenCalledWith({
      where: { id: 1, user_id: 9 },
    });
  });

  it('create con conversation_id de otra tienda o usuario → 404 sin persistir', async () => {
    await expect(
      service.create({
        conversation_id: 999,
        kind: 'markdown',
        data: { text: 'x' },
      }),
    ).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
    expect(delegate.create).not.toHaveBeenCalled();

    getContext.mockReturnValue({ user_id: 55, store_id: 7 } as any);
    await expect(
      service.create({
        conversation_id: 1,
        kind: 'markdown',
        data: { text: 'x' },
      }),
    ).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it('attachToMessage enlaza solo huérfanos de la tienda', async () => {
    const a = await service.create({
      conversation_id: 1,
      kind: 'markdown',
      data: { text: 'a' },
    });
    const b = await service.create({
      conversation_id: 1,
      kind: 'markdown',
      data: { text: 'b' },
    });
    const linked = await service.create({
      conversation_id: 1,
      kind: 'markdown',
      message_id: 41,
      data: { text: 'c' },
    });

    const count = await service.attachToMessage([a.id, b.id, linked.id], 77);
    expect(count).toBe(2);

    const where = delegate.updateMany.mock.calls[0][0].where;
    expect(where).toEqual({
      id: { in: [a.id, b.id, linked.id] },
      store_id: 7,
      message_id: null,
    });
    expect((await service.getById(a.id)).message_id).toBe(77);
    expect((await service.getById(linked.id)).message_id).toBe(41);
    expect(await service.attachToMessage([], 77)).toBe(0);
  });
  it('otro usuario no lee, transforma ni interactúa con un bloque ajeno (404)', async () => {
    const block = await service.create({
      conversation_id: 1,
      kind: 'table',
      spec: {},
      data: { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] },
    });
    getContext.mockReturnValue({ user_id: 10, store_id: 7 } as any);
    await expect(service.getById(block.id)).rejects.toMatchObject({
      errorCode: 'SYS_NOT_FOUND_001',
    });
    await expect(service.getUiBlock(block.id)).rejects.toMatchObject({
      errorCode: 'SYS_NOT_FOUND_001',
    });
    await expect(
      service.recordInteraction(block.id, { type: 'row_select', payload: {} }),
    ).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
    await expect(service.transform(block.id, {} as any)).rejects.toMatchObject({
      errorCode: 'SYS_NOT_FOUND_001',
    });
  });

  it('create sin user_id en el contexto falla cerrado y no persiste', async () => {
    getContext.mockReturnValue({ store_id: 7 } as any);
    await expect(
      service.create({
        conversation_id: 1,
        kind: 'table',
        spec: {},
        data: { columns: [{ key: 'a', label: 'A' }], rows: [] },
      }),
    ).rejects.toMatchObject({ errorCode: 'AUTH_PERM_001' });
    expect(delegate.rows).toHaveLength(0);
    expect(findConversation).not.toHaveBeenCalled();
  });
});
