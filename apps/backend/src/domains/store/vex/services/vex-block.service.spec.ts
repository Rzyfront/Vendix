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
        if (r.id === where.id && r.store_id === where.store_id) {
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
  let service: VexBlockService;
  let getStoreId: jest.SpyInstance;

  beforeEach(() => {
    delegate = makeDelegate();
    const prisma = { withoutScope: () => ({ ai_ui_blocks: delegate }) };
    const s3 = {
      getPresignedUrl: jest.fn(async (key: string) => `https://signed/${key}`),
    };
    service = new VexBlockService(prisma as any, s3 as any);
    getStoreId = jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(7);
  });

  afterEach(() => {
    getStoreId.mockRestore();
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
});
