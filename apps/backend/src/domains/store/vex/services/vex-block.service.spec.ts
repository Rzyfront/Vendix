import { AIAgentService } from '../../../../ai-engine/ai-agent.service';
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import { createVexBlockTools } from '../../../../ai-engine/tools/domains/vex-blocks.tools';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VexBlockService } from './vex-block.service';
import { compactRecoverableToolResult } from '../../../../ai-engine/context/tool-result-compaction';

const originalScope = RequestContextService.asyncLocalStorage.getStore.bind(
  RequestContextService.asyncLocalStorage,
);

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
    jest
      .spyOn(RequestContextService.asyncLocalStorage, 'getStore')
      .mockImplementation(
        () =>
          originalScope() ??
          (jest.isMockFunction(RequestContextService.getContext)
            ? (
                RequestContextService.getContext as jest.Mock
              ).getMockImplementation()?.()
            : undefined),
      );
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
    jest.restoreAllMocks();
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

  describe('timeline, list y chart ampliado', () => {
    const chart = (chart_type: string, data: Record<string, any>) =>
      service.create({
        conversation_id: 1,
        kind: 'chart',
        spec: { chart_type },
        data,
      });

    it('acepta timeline válido y lo pagina como filas', async () => {
      const b = await service.create({
        conversation_id: 1,
        kind: 'timeline',
        spec: { title: 'Orden' },
        data: {
          events: [
            { title: 'Creada', timestamp: '2026-01-02T10:00:00Z' },
            { title: 'Pagada', status: 'success', actor: 'Ana' },
          ],
        },
      });
      const page = await service.readPaged(b.id, 1, 1);
      expect(page.total_rows).toBe(2);
      expect(page.rows).toEqual([
        { title: 'Creada', timestamp: '2026-01-02T10:00:00Z' },
      ]);
      const ui = await service.toUiBlock(b);
      expect(ui.kind).toBe('timeline');
      expect(ui.data.events).toHaveLength(2);
    });

    it.each([
      [{ events: [] }],
      [{ events: [{ title: '' }] }],
      [{ events: [{ title: 'x', timestamp: 'no-fecha' }] }],
      [{ events: [{ title: 'x', status: 'raro' }] }],
      [{ events: Array.from({ length: 201 }, () => ({ title: 'x' })) }],
    ])('rechaza timeline inválido %#', async (data) => {
      await expect(
        service.create({
          conversation_id: 1,
          kind: 'timeline',
          spec: {},
          data,
        }),
      ).rejects.toThrow(/Bloque timeline inválido/);
    });

    it('acepta list válido y lo pagina como filas', async () => {
      const b = await service.create({
        conversation_id: 1,
        kind: 'list',
        spec: { layout: 'rows' },
        data: {
          items: [
            {
              title: 'A',
              badge: { label: 'Ok', tone: 'success' },
              fields: [{ label: 'Total', value: 5 }],
            },
          ],
        },
      });
      expect((await service.readPaged(b.id)).rows).toHaveLength(1);
      expect((await service.toUiBlock(b)).spec.layout).toBe('rows');
    });

    it.each([
      [{ layout: 'grid' }, { items: [{ title: 'A' }] }],
      [{}, { items: [] }],
      [{}, { items: [{ subtitle: 'sin título' }] }],
      [{}, { items: [{ title: 'A', badge: { label: 'x', tone: 'raro' } }] }],
      [
        {},
        {
          items: [
            {
              title: 'A',
              fields: Array.from({ length: 9 }, () => ({
                label: 'l',
                value: 1,
              })),
            },
          ],
        },
      ],
    ])('rechaza list inválido %#', async (spec, data) => {
      await expect(
        service.create({ conversation_id: 1, kind: 'list', spec, data }),
      ).rejects.toThrow(/Bloque list inválido/);
    });

    it.each(['rose', 'funnel', 'stacked_bar', 'doughnut', 'bar'])(
      'acepta chart_type %s',
      async (type) => {
        await expect(
          chart(type, { labels: ['a', 'b'], series: [{ name: 's', data: [1, 2] }] }),
        ).resolves.toBeDefined();
      },
    );

    it('combo acepta type bar/line y rechaza otro', async () => {
      await expect(
        chart('combo', {
          labels: ['a'],
          series: [
            { name: 'v', data: [1], type: 'bar' },
            { name: 'm', data: [2], type: 'line' },
            { name: 'z', data: [3] },
          ],
        }),
      ).resolves.toBeDefined();
      await expect(
        chart('combo', {
          labels: ['a'],
          series: [{ name: 'v', data: [1], type: 'pie' }],
        }),
      ).rejects.toThrow(/series\[\]\.type/);
    });

    it('heatmap exige data del largo de labels', async () => {
      await expect(
        chart('heatmap', {
          labels: ['L', 'M'],
          series: [{ name: 'Mañana', data: [1, 2] }],
        }),
      ).resolves.toBeDefined();
      await expect(
        chart('heatmap', {
          labels: ['L', 'M'],
          series: [{ name: 'Mañana', data: [1] }],
        }),
      ).rejects.toThrow(/heatmap/);
    });

    it('chart_type desconocido y kind desconocido siguen rechazados', async () => {
      await expect(
        chart('sunburst', { labels: [], series: [{ name: 's', data: [1] }] }),
      ).rejects.toThrow(/chart_type/);
      await expect(
        service.create({
          conversation_id: 1,
          kind: 'nope' as any,
          spec: {},
          data: {},
        }),
      ).rejects.toThrow(/kind debe ser uno de/);
    });

    it('chart bar y table existentes siguen igual', async () => {
      const c = await chart('bar', {
        labels: ['a'],
        series: [{ name: 'x', data: [1] }],
      });
      const ui = await service.toUiBlock(c);
      expect(ui.spec.chart_type).toBe('bar');
      expect(ui.data.rows).toEqual([{ label: 'a', s0_x: 1 }]);
      const t = await service.create({
        conversation_id: 1,
        kind: 'table',
        data: { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] },
      });
      expect((await service.readPaged(t.id)).rows).toEqual([{ a: 1 }]);
    });
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
    getContext.mockReturnValue({ user_id: 9, store_id: 999 } as any);
    await expect(
      service.readPaged(created.id, 1, 50, { offset: 0 }),
    ).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
    getContext.mockReturnValue({ user_id: 9, store_id: 7 } as any);
    getContext.mockReturnValue({ user_id: 999, store_id: 7 });
    await expect(
      service.readPaged(created.id, 1, 50, { offset: 0 }),
    ).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
    getContext.mockReturnValue({ store_id: 7 });
    await expect(service.readPaged(created.id)).rejects.toMatchObject({
      errorCode: 'SYS_NOT_FOUND_001',
    });
  });

  it.each([true])(
    'real loop compaction → real block sink → real read tool recovers escaped JSON and sum (H=%s)',
    async (enabled) => {
      try {
        await RequestContextService.runIsolated(
          {
            store_id: 7,
            organization_id: 3,
            user_id: 9,
            is_owner: true,
            is_super_admin: false,
          },
          async () => {
            const raw = JSON.stringify({
              data: Array.from({ length: 400 }, (_, id) => ({
                id,
                name: `café ${id}`,
                amount: id + 1,
                memo: '\0"\n',
              })),
            });
            expect(raw.length).toBeGreaterThan(6000);
            const registry = new AIToolRegistry({} as any);
            const initialRead = jest.fn().mockResolvedValue(raw);
            registry.register({
              name: 'read_dataset',
              access: 'public',
              accessReason: 'test fixture',
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
              if (result.data.compaction_version)
                return toolCall('vex_block_read', {
                  block_id: result.data.block_id,
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
                checkExtraQuota: jest
                  .fn()
                  .mockResolvedValue({ exceeded: false }),
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
            expect(result.execution?.outcome).toBe('partial');
            expect(JSON.parse(recovered).data).toEqual(JSON.parse(raw));
            expect(JSON.parse(recovered).data.data).toHaveLength(400);
            expect(
              JSON.parse(recovered).data.data.reduce(
                (sum: number, row: { amount: number }) => sum + row.amount,
                0,
              ),
            ).toBe((400 * 401) / 2);
            expect(initialRead).toHaveBeenCalledTimes(1);
            expect(save).toHaveBeenCalledTimes(1);
            expect(
              result.tools_used.filter((t) => t.name === 'vex_block_read')
                .length,
            ).toBeGreaterThan(1);
          },
        );
      } finally {
      }
    },
  );

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

  describe('learning blocks (help_article, video, learning_path)', () => {
    const video = (id = 1, extra: Record<string, unknown> = {}) => ({
      id,
      title: `Video ${id}`,
      slug: `video-${id}`,
      summary: 'Resumen',
      video_url: 'https://www.youtube.com/watch?v=abc',
      video_source: 'YOUTUBE',
      external_id: 'abc',
      duration_seconds: 120,
      thumbnail_url: 'https://img.example.com/t.jpg',
      ...extra,
    });
    const article = (extra: Record<string, unknown> = {}) => ({
      id: 5,
      title: 'Crear un producto',
      slug: 'crear-un-producto',
      summary: 'Paso a paso',
      content: '## Paso 1\nAbre Productos.',
      type: 'TUTORIAL',
      module: 'products',
      cover_image_url: null,
      video: video(2),
      ...extra,
    });

    it('accepts valid payloads for the three kinds and maps them for the panel', async () => {
      const a = await service.create({
        conversation_id: 1,
        kind: 'help_article',
        data: { article: article() },
      });
      const v = await service.create({
        conversation_id: 1,
        kind: 'video',
        data: { video: video(), autoplay: true },
      });
      const p = await service.create({
        conversation_id: 1,
        kind: 'learning_path',
        data: {
          series: {
            id: 3,
            title: 'Ruta de inventario',
            summary: null,
            items: [
              {
                position: 1,
                video: video(1),
                article: { id: 5, title: 'A', slug: 'a' },
                progress: { seconds_watched: 30, completed: false },
              },
              { position: 2, video: video(2, { video_source: 'DIRECT_S3' }) },
            ],
          },
        },
      });
      const ui = await service.toUiBlock(a);
      expect(ui.kind).toBe('help_article');
      expect((ui.data as any).article.title).toBe('Crear un producto');
      expect((await service.toUiBlock(v)).data).toMatchObject({
        video: { id: 1 },
        autoplay: true,
      });
      const path = await service.toUiBlock(p);
      expect(path.kind).toBe('learning_path');
      expect((path.data as any).series.items).toHaveLength(2);
    });

    it.each([
      [
        'non-http video url',
        { video: video(1, { video_url: 'javascript:alert(1)' }) },
      ],
      ['unknown video_source', { video: video(1, { video_source: 'TIKTOK' }) }],
      ['unknown field', { video: video(), extra: 1 }],
      ['unknown field in VideoRef', { video: video(1, { hacked: true }) }],
      [
        'non-http thumbnail',
        { video: video(1, { thumbnail_url: 'ftp://x/y.png' }) },
      ],
    ])('rejects a video block with %s', async (_label, data) => {
      await expect(
        service.create({
          conversation_id: 1,
          kind: 'video',
          data: data as any,
        }),
      ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
      expect(delegate.rows).toHaveLength(0);
    });

    it('rejects oversized articles, unknown article fields and over-long paths', async () => {
      await expect(
        service.create({
          conversation_id: 1,
          kind: 'help_article',
          data: { article: article({ content: 'x'.repeat(20001) }) },
        }),
      ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
      await expect(
        service.create({
          conversation_id: 1,
          kind: 'help_article',
          data: { article: article({ owner_email: 'a@b.co' }) },
        }),
      ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
      await expect(
        service.create({
          conversation_id: 1,
          kind: 'learning_path',
          data: {
            series: {
              id: 3,
              title: 'Larga',
              items: Array.from({ length: 21 }, (_, i) => ({
                position: i + 1,
                video: video(i + 1),
              })),
            },
          },
        }),
      ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
      await expect(
        service.create({
          conversation_id: 1,
          kind: 'learning_path',
          data: { series: { id: 3, title: 'Vacía', items: [] } },
        }),
      ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
    });

    it('keeps validating a previous block type unchanged', async () => {
      const kpi = await service.create({
        conversation_id: 1,
        kind: 'kpi',
        data: { label: 'Ventas', value: 10 },
      });
      expect(kpi.kind).toBe('kpi');
      await expect(
        service.create({ conversation_id: 1, kind: 'kpi', data: { value: 1 } }),
      ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
    });
  });

  it('isolates blocks by store: another store id answers 404', async () => {
    const created = await service.create({
      conversation_id: 1,
      kind: 'markdown',
      data: { text: 'hola' },
    });
    getContext.mockReturnValue({ user_id: 9, store_id: 999 } as any);
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

  it('derives decimal columns and rebuilds the column list', async () => {
    const created = await service.create({
      conversation_id: 1,
      kind: 'table',
      data: {
        columns: [
          { key: 'producto', label: 'Producto' },
          { key: 'ingreso', label: 'Ingreso' },
          { key: 'costo', label: 'Costo' },
        ],
        rows: [
          { producto: 'café', ingreso: 200, costo: 150 },
          { producto: 'té', ingreso: 0, costo: 10 },
        ],
      },
    });

    const derived = await service.transform(created.id, {
      derive: [{ name: 'margen', expression: 'margin(ingreso, costo)' }],
    });

    const data = derived.data as any;
    expect(data.rows[0].margen).toBe('25');
    // Sin ingreso no hay margen: null, nunca un número inventado.
    expect(data.rows[1].margen).toBeNull();
    expect(data.columns).toEqual([
      { key: 'producto', label: 'Producto' },
      { key: 'ingreso', label: 'Ingreso' },
      { key: 'costo', label: 'Costo' },
      { key: 'margen', label: 'margen' },
    ]);
    const original = await service.getById(created.id);
    expect((original.data as any).rows[0].margen).toBeUndefined();
  });

  describe('derived decimal columns through filter, sort and aggregate', () => {
    const marginTable = () =>
      service.create({
        conversation_id: 1,
        kind: 'table',
        data: {
          columns: [
            { key: 'categoria', label: 'Categoría' },
            { key: 'ingreso', label: 'Ingreso' },
            { key: 'costo', label: 'Costo' },
          ],
          rows: [
            { categoria: 'pan', ingreso: 100, costo: 91 }, // 9
            { categoria: 'café', ingreso: 1000, costo: 548 }, // 45.2
            { categoria: 'agua', ingreso: 50, costo: 0 }, // 100
            { categoria: 'regalo', ingreso: 0, costo: 10 }, // sin base
          ],
        },
      });
    const derive = [{ name: 'margen', expression: 'margin(ingreso, costo)' }];

    it('derive + sort ranks by number, not by text', async () => {
      const created = await marginTable();
      const out = await service.transform(created.id, {
        derive,
        sort: [{ field: 'margen', direction: 'desc' }],
      });
      expect((out.data as any).rows.map((r: any) => r.margen)).toEqual([
        '100',
        '45.2',
        '9',
        null,
      ]);
    });

    it('derive + filter keeps the rows above the threshold', async () => {
      const created = await marginTable();
      const out = await service.transform(created.id, {
        derive,
        filter: [{ field: 'margen', op: 'gt', value: 5 }],
      });
      expect((out.data as any).rows.map((r: any) => r.categoria)).toEqual([
        'pan',
        'café',
        'agua',
      ]);
    });

    it('derive + aggregate adds the derived column', async () => {
      const created = await marginTable();
      const sum = await service.transform(created.id, {
        derive,
        aggregate: { field: 'margen', function: 'sum' },
      });
      expect((sum.data as any).rows).toEqual([{ sum_margen: '154.2' }]);
      const max = await service.transform(created.id, {
        derive,
        aggregate: { field: 'margen', function: 'max' },
      });
      expect((max.data as any).rows).toEqual([{ max_margen: '100' }]);
    });

    it('compare + sort ranks pct_change by number, and aggregates it', async () => {
      const created = await service.create({
        conversation_id: 1,
        kind: 'table',
        data: {
          columns: [
            { key: 'categoria', label: 'Categoría' },
            { key: 'mes', label: 'Mes' },
            { key: 'total', label: 'Total' },
          ],
          rows: [
            { categoria: 'pan', mes: '2026-09', total: 100 },
            { categoria: 'pan', mes: '2026-10', total: 109 }, // 9
            { categoria: 'café', mes: '2026-09', total: 100 },
            { categoria: 'café', mes: '2026-10', total: 200 }, // 100
            { categoria: 'té', mes: '2026-09', total: 100 },
            { categoria: 'té', mes: '2026-10', total: 55 }, // -45
          ],
        },
      });
      const compare = {
        key: 'categoria',
        period_field: 'mes',
        current: '2026-10',
        previous: '2026-09',
        value_field: 'total',
      };
      const sorted = await service.transform(created.id, {
        compare,
        sort: [{ field: 'pct_change', direction: 'desc' }],
      });
      expect(
        (sorted.data as any).rows.map((r: any) => [r.categoria, r.pct_change]),
      ).toEqual([
        ['café', '100'],
        ['pan', '9'],
        ['té', '-45'],
      ]);
      const grew = await service.transform(created.id, {
        compare,
        filter: [{ field: 'pct_change', op: 'gte', value: 9 }],
        aggregate: { field: 'delta', function: 'sum' },
      });
      expect((grew.data as any).rows).toEqual([{ sum_delta: '109' }]);
    });

    it('a range filter on a text column is a validation error, not zero rows', async () => {
      const created = await marginTable();
      await expect(
        service.transform(created.id, {
          filter: [{ field: 'categoria', op: 'gt', value: 5 }],
        }),
      ).rejects.toMatchObject({
        errorCode: 'SYS_VALIDATION_001',
        message: expect.stringContaining('no aplica a "categoria"'),
      });
    });
  });

  it('compares two periods per key with a null variation when there is no base', async () => {
    const created = await service.create({
      conversation_id: 1,
      kind: 'table',
      data: {
        columns: [
          { key: 'categoria', label: 'Categoría' },
          { key: 'mes', label: 'Mes' },
          { key: 'total', label: 'Total' },
        ],
        rows: [
          { categoria: 'café', mes: '2026-09', total: 100 },
          { categoria: 'café', mes: '2026-10', total: 125 },
          { categoria: 'té', mes: '2026-10', total: 40 },
        ],
      },
    });

    const derived = await service.transform(created.id, {
      compare: {
        key: 'categoria',
        period_field: 'mes',
        current: '2026-10',
        previous: '2026-09',
        value_field: 'total',
      },
    });

    expect((derived.data as any).rows).toEqual([
      {
        categoria: 'café',
        current: '125',
        previous: '100',
        delta: '25',
        pct_change: '25',
      },
      {
        categoria: 'té',
        current: '40',
        previous: null,
        delta: null,
        pct_change: null,
      },
    ]);
  });

  it('joins another table of the same conversation and refuses other threads', async () => {
    const ventas = await service.create({
      conversation_id: 1,
      kind: 'table',
      data: {
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'ventas', label: 'Ventas' },
        ],
        rows: [
          { sku: 'A', ventas: 10 },
          { sku: 'B', ventas: 3 },
        ],
      },
    });
    const stock = await service.create({
      conversation_id: 1,
      kind: 'table',
      data: {
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'stock', label: 'Stock' },
        ],
        rows: [{ sku: 'A', stock: 7 }],
      },
    });

    const joined = await service.transform(ventas.id, {
      join: { block_id: stock.id, on: 'sku' },
    });
    expect((joined.data as any).rows).toEqual([
      { sku: 'A', ventas: 10, stock: 7 },
    ]);

    const kpi = await service.create({
      conversation_id: 1,
      kind: 'kpi',
      data: { label: 'Ventas', value: 100 },
    });
    await expect(
      service.transform(ventas.id, { join: { block_id: kpi.id, on: 'sku' } }),
    ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
    await expect(
      service.transform(ventas.id, {
        derive: [{ name: 'x', expression: 'process.exit()' }],
      }),
    ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
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
      where: { id: 1, user_id: 9, store_id: 7 },
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

  describe('H common bounded reader (independent flag)', () => {
    const scope = {
      store_id: 7,
      organization_id: 3,
      user_id: 9,
      is_owner: true,
      is_super_admin: false,
    };
    beforeEach(() => {
      jest
        .mocked(RequestContextService.asyncLocalStorage.getStore)
        .mockRestore();
    });

    it.each(['plain', 'escaped'])(
      'compact persisted %s → Vex markdown reader round-trips without recursive storage',
      async (kind) =>
        RequestContextService.runIsolated(scope, async () => {
          const raw =
            kind === 'plain'
              ? JSON.stringify({
                  rows: Array.from({ length: 400 }, (_, id) => ({
                    id,
                    amount: id + 1,
                  })),
                })
              : '\0\n"\\'.repeat(5000);
          const saved = jest.fn(async () => ({
            block_id: (
              await service.create({
                conversation_id: 1,
                kind: 'markdown',
                data: { text: raw },
              })
            ).id,
          }));
          const compacted = JSON.parse(
            await compactRecoverableToolResult('read_sales', raw, {
              persist: saved,
            }),
          );
          const reader = createVexBlockTools({ blocks: service }).find(
            (tool) => tool.name === 'vex_block_read',
          )!;
          let cursor: string | undefined;
          let text = '';
          do {
            const serialized = await reader.handler!(
              { block_id: compacted.block_id, ...(cursor ? { cursor } : {}) },
              {} as any,
            );
            expect(serialized.length).toBeLessThan(6000);
            const { data: page } = JSON.parse(serialized);
            expect(page).toMatchObject({
              artifact: true,
              bounded: true,
              reusable_for_write: false,
              kind: 'markdown',
            });
            expect(page.text_offset).toBe(text.length);
            text += page.text;
            if (!page.has_more) {
              expect(page.cursor).toBeNull();
              break;
            }
            cursor = page.cursor;
          } while (true);
          expect(text).toBe(raw);
          expect(saved).toHaveBeenCalledTimes(1);
          expect(delegate.rows).toHaveLength(1);
        }),
    );

    it('pages escaped rows under the REAL tool envelope, projects columns and aggregates the whole saved table', async () =>
      RequestContextService.runIsolated(scope, async () => {
        const rows = Array.from({ length: 400 }, (_, id) => ({
          id,
          amount: id + 1,
          memo: '\0'.repeat(80),
        }));
        const block = await service.create({
          conversation_id: 1,
          kind: 'table',
          data: { columns: [{ key: 'id', label: 'ID' }], rows },
        });
        const registry = new AIToolRegistry({} as any);
        registry.registerMany(createVexBlockTools({ blocks: service }));
        const collected: typeof rows = [];
        let cursor: string | undefined;
        do {
          const serialized = await registry.executeTool('vex_block_read', {
            block_id: block.id,
            page_size: 500,
            ...(cursor ? { cursor } : {}),
          });
          expect(serialized.length).toBeLessThan(6000);
          const { data: page } = JSON.parse(serialized);
          collected.push(...page.rows);
          expect(page.complete).toBe(false);
          if (!page.has_more) break;
          cursor = page.cursor;
        } while (true);
        expect(collected).toEqual(rows);
        const aggregate = JSON.parse(
          await registry.executeTool('vex_block_read', {
            block_id: block.id,
            aggregate: { field: 'amount', function: 'sum' },
          }),
        ).data;
        expect(aggregate.aggregate_data.value).toBe((400 * 401) / 2);
        expect(aggregate.complete).toBe(true);
        const projected = JSON.parse(
          await registry.executeTool('vex_block_read', {
            block_id: block.id,
            page_size: 1,
            columns: ['id'],
          }),
        ).data;
        expect(projected.rows).toEqual([{ id: 0 }]);
        expect(delegate.rows).toHaveLength(1);
      }));

    it('huge rows become labeled JSON text; huge selections never overflow the reader', async () =>
      RequestContextService.runIsolated(scope, async () => {
        const rows = [{ id: 1, memo: '\0'.repeat(12000) }];
        const block = await service.create({
          conversation_id: 1,
          kind: 'table',
          data: { columns: [{ key: 'id', label: 'ID' }], rows },
        });
        await service.recordInteraction(block.id, {
          type: 'select',
          payload: { selection: rows },
        });
        let cursor: string | undefined;
        let text = '';
        do {
          const page = await service.readPaged(block.id, 1, 50, { cursor });
          expect(JSON.stringify(page).length).toBeLessThan(6000);
          expect(page).toMatchObject({
            format: 'text',
            encoding: 'json',
            selection_omitted: 1,
          });
          text += page.text;
          if (!page.has_more) break;
          cursor = page.cursor!;
        } while (true);
        expect(JSON.parse(text)).toEqual(rows);
      }));

    it('rejects fallback/static context and foreign-owner/store cursors before returning data', async () => {
      const block = await RequestContextService.runIsolated(scope, () =>
        service.create({
          conversation_id: 1,
          kind: 'markdown',
          data: { text: '\0'.repeat(9000) },
        }),
      );
      const first = await RequestContextService.runIsolated(scope, () =>
        service.readPaged(block.id),
      );
      for (const other of [
        { ...scope, store_id: 999 },
        { ...scope, user_id: 55 },
      ])
        await expect(
          RequestContextService.runIsolated(other, () =>
            service.readPaged(block.id, 1, 50, { cursor: first.cursor! }),
          ),
        ).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
      // Existing mocked fallback still has the legitimate principal, but no ALS is not authority.
      await expect(service.readPaged(block.id)).rejects.toMatchObject({
        errorCode: 'STORE_CONTEXT_001',
      });
    });
  });
});
