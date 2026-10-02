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
