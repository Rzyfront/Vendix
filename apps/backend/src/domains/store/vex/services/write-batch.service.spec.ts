import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  WriteBatchService,
  toWriteBatchView,
  writeBatchArgsHash,
  estimateAffectedRecords,
} from './write-batch.service';
import {
  WRITE_BATCH_STALE_EXECUTING_MS,
  WRITE_BATCH_UNDO_WINDOW_MS,
} from './write-batch.types';

describe('WriteBatchService (T34 · propose / read)', () => {
  const USER = 11;
  const STORE = 7;
  const ORG = 3;

  type ToolDef = Record<string, any>;

  const writeTool = (over: ToolDef = {}): ToolDef => ({
    name: 'x',
    requiresConfirmation: true,
    preview: jest.fn(),
    access: 'permission',
    requiredPermissions: [],
    ...over,
  });

  function build(tools: Record<string, ToolDef>, over: ToolDef = {}) {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn();
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      ai_agent_write_batches: { createMany, findFirst, updateMany },
    } as any;
    const previewForConsent = jest.fn(async (name: string) => ({
      preview: {
        status: 'ok',
        target: `target of ${name}`,
        changes: [{ field: 'price', label: 'Precio', from: 100, to: 105 }],
        domain: 'catalog',
      },
    }));
    const registry = {
      canonicalName: (n: string) => n,
      get: jest.fn((n: string) => tools[n]),
      isIrreversible: jest.fn((n: string) => !!tools[n]?.__irreversible),
      previewForConsent: over.previewForConsent ?? previewForConsent,
      getToolVersion: jest.fn().mockReturnValue('1'),
    } as any;
    const planApproval = {
      classifySteps: jest.fn().mockReturnValue({ reconfirm: [] }),
    } as any;
    let blockSeq = 0;
    const blocks = {
      create: jest.fn(async () => ({ id: `blk${++blockSeq}` })),
      toUiBlock: jest.fn(async (b: any) => ({ id: b.id, kind: 'write_batch' })),
    } as any;
    const service = new WriteBatchService(prisma, registry, planApproval, blocks);
    return {
      service,
      createMany,
      findFirst,
      updateMany,
      registry,
      previewForConsent: registry.previewForConsent as jest.Mock,
      blocks,
    };
  }

  const ctx = (over: Record<string, unknown> = {}) =>
    ({
      organization_id: ORG,
      store_id: STORE,
      user_id: USER,
      roles: ['owner'],
      permissions: ['store:products:update', 'store:customers:update', 'store:inventory:update'],
      ...over,
    }) as any;
  const run = <T>(fn: () => Promise<T>, over: Record<string, unknown> = {}) =>
    RequestContextService.run(ctx(over), fn) as Promise<T>;

  const threeTools = () => ({
    update_product_price: writeTool({ requiredPermissions: ['store:products:update'] }),
    tag_customer: writeTool({ requiredPermissions: ['store:customers:update'] }),
    adjust_stock: writeTool({
      requiredPermissions: ['store:inventory:update'],
      compensate: { label: 'undo', capture: jest.fn(), undo: jest.fn() },
    }),
  });

  describe('propose', () => {
    it('persists ONE row with s1..s3, hashes, preview and a write_batch block', async () => {
      const h = build(threeTools());
      const steps = [
        { tool: 'update_product_price', arguments: { product_id: 1, new_price: 105 }, label: 'Subir precio' },
        { tool: 'tag_customer', arguments: { customer_id: 2 }, label: 'Etiquetar' },
        { tool: 'adjust_stock', arguments: { product_id: 3 }, label: 'Ajustar' },
      ];
      const res: any = await run(() =>
        h.service.propose({ conversationId: 9, goal: '  Subir precios  ', steps }),
      );

      expect(h.createMany).toHaveBeenCalledTimes(1);
      const rows = h.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row).toMatchObject({
        store_id: STORE,
        organization_id: ORG,
        user_id: USER,
        conversation_id: 9,
        goal: 'Subir precios',
        status: 'proposed',
        step_count: 3,
        affected_records: 3,
        part_index: 1,
        part_total: 1,
        group_id: null,
      });
      expect(row.expires_at).toBeInstanceOf(Date);
      expect(row.steps.map((s: any) => s.step_id)).toEqual(['s1', 's2', 's3']);
      expect(row.steps.map((s: any) => s.order)).toEqual([1, 2, 3]);
      expect(row.steps.every((s: any) => s.status === 'pending')).toBe(true);
      expect(row.steps[0].args_hash).toBe(
        writeBatchArgsHash('update_product_price', { product_id: 1, new_price: 105 }),
      );
      expect(row.steps[0].preview_hash).toEqual(expect.any(String));
      expect(row.steps[0].preview_hash.length).toBeGreaterThan(10);
      expect(row.steps[0].preview).toMatchObject({
        status: 'ok',
        target: 'target of update_product_price',
        changes: [{ field: 'price', from: 100, to: 105 }],
      });
      expect(row.steps.map((s: any) => s.compensable)).toEqual([false, false, true]);
      expect(row.steps[0]).not.toHaveProperty('operation_id');

      expect(h.blocks.create).toHaveBeenCalledTimes(1);
      expect(h.blocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: 9,
          kind: 'write_batch',
          data: expect.objectContaining({ batch_id: row.id, step_count: 3 }),
        }),
      );
      expect(res.group_id).toBeNull();
      expect(res.batches).toEqual([
        expect.objectContaining({
          batch_id: row.id,
          part_index: 1,
          part_total: 1,
          step_count: 3,
          block_id: 'blk1',
        }),
      ]);
    });

    it('splits 26 steps into 25 + 1 parts sharing one group_id', async () => {
      const h = build(threeTools());
      const steps = Array.from({ length: 26 }, (_, i) => ({
        tool: 'update_product_price',
        arguments: { product_id: i + 1 },
        label: `p${i + 1}`,
      }));
      const res: any = await run(() =>
        h.service.propose({ conversationId: 9, goal: 'g', steps }),
      );
      expect(h.createMany).toHaveBeenCalledTimes(1);
      const rows = h.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.step_count)).toEqual([25, 1]);
      expect(rows.map((r: any) => [r.part_index, r.part_total])).toEqual([
        [1, 2],
        [2, 2],
      ]);
      expect(rows[0].group_id).toEqual(expect.any(String));
      expect(rows[0].group_id).toBe(rows[1].group_id);
      // Order restarts at 1 in each part.
      expect(rows[1].steps[0].order).toBe(1);
      expect(res.group_id).toBe(rows[0].group_id);
      expect(res.batches).toHaveLength(2);
      expect(h.blocks.create).toHaveBeenCalledTimes(2);
    });

    it('refuses with permission_denied naming the area and persists nothing', async () => {
      const tools = threeTools();
      const h = build(tools);
      const res: any = await run(
        () =>
          h.service.propose({
            conversationId: 9,
            goal: 'g',
            steps: [
              { tool: 'update_product_price', arguments: { product_id: 1 }, label: 'Precio' },
              { tool: 'adjust_stock', arguments: { product_id: 3 }, label: 'Ajustar' },
              { tool: 'tag_customer', arguments: { customer_id: 2 }, label: 'Etiquetar' },
            ],
          }),
        { permissions: ['store:products:update', 'store:customers:update'] },
      );
      expect(res).toMatchObject({
        refused: true,
        reason: 'permission_denied',
        step_order: 2,
      });
      expect(res.explanation).toContain('Tu rol no permite inventario');
      expect(res.explanation).toContain('paso 2: Ajustar');
      expect(h.createMany).not.toHaveBeenCalled();
      expect(h.blocks.create).not.toHaveBeenCalled();
      // Step 1 was previewed; step 3 never was (the loop stops at the first refusal).
      expect(h.previewForConsent).toHaveBeenCalledTimes(1);
      expect(h.previewForConsent).toHaveBeenCalledWith('update_product_price', { product_id: 1 });
    });

    it('falls back to roles when the context has no permission list', async () => {
      const h = build({
        t: writeTool({ requiredPermissions: ['store:products:update'] }),
      });
      const res: any = await run(
        () => h.service.propose({ conversationId: 1, goal: 'g', steps: [{ tool: 't', arguments: {}, label: 'T' }] }),
        { permissions: [], roles: ['store:products:update'] },
      );
      expect(res.refused).toBeUndefined();
      expect(h.createMany).toHaveBeenCalledTimes(1);
    });

    it('lets a public tool through without permissions', async () => {
      const h = build({
        t: writeTool({ access: 'public', requiredPermissions: ['store:products:update'] }),
      });
      const res: any = await run(
        () => h.service.propose({ conversationId: 1, goal: 'g', steps: [{ tool: 't', arguments: {}, label: 'T' }] }),
        { permissions: ['other'] },
      );
      expect(res.refused).toBeUndefined();
    });

    it('refuses an irreversible step (registry flag, tool flag, plan reclassification)', async () => {
      const cases: Array<[string, ToolDef, boolean]> = [
        ['registry', writeTool({ __irreversible: true }), false],
        ['tool flag', writeTool({ irreversible: true }), false],
        ['plan domain', writeTool(), true],
      ];
      for (const [, tool, reconfirm] of cases) {
        const h = build({ t: tool });
        if (reconfirm) {
          (h.service as any).planApproval.classifySteps.mockReturnValue({
            reconfirm: [{ order: 1 }],
          });
        }
        const res: any = await run(() =>
          h.service.propose({ conversationId: 1, goal: 'g', steps: [{ tool: 't', arguments: {}, label: 'Anular' }] }),
        );
        expect(res).toMatchObject({ refused: true, reason: 'irreversible', step_order: 1 });
        expect(h.createMany).not.toHaveBeenCalled();
        expect(h.previewForConsent).not.toHaveBeenCalled();
      }
    });

    it('refuses read-only, no-confirmation, client-side tools and the proposer itself as not_a_write', async () => {
      const tools = {
        ro: writeTool({ readOnly: true }),
        noconf: writeTool({ requiresConfirmation: false }),
        nopreview: writeTool({ preview: undefined }),
        client: writeTool({ clientSide: true }),
        propose_write_batch: writeTool(),
      };
      for (const name of Object.keys(tools)) {
        const h = build(tools);
        const res: any = await run(() =>
          h.service.propose({ conversationId: 1, goal: 'g', steps: [{ tool: name, arguments: {}, label: 'L' }] }),
        );
        expect(res).toMatchObject({ refused: true, reason: 'not_a_write' });
        expect(h.createMany).not.toHaveBeenCalled();
      }
    });

    it('refuses an unknown tool and an empty step list', async () => {
      const h = build({});
      const unknown: any = await run(() =>
        h.service.propose({ conversationId: 1, goal: 'g', steps: [{ tool: 'nope', arguments: {}, label: 'L' }] }),
      );
      expect(unknown).toMatchObject({ refused: true, reason: 'unknown_tool', step_order: 1 });
      const empty: any = await run(() =>
        h.service.propose({ conversationId: 1, goal: 'g', steps: [] }),
      );
      expect(empty).toMatchObject({ refused: true, reason: 'empty' });
      expect(h.createMany).not.toHaveBeenCalled();
    });

    it('maps preview errors AI_AGENT_005 / AI_AGENT_004 to refusals and rethrows others', async () => {
      const tools = { t: writeTool() };
      const bad = (entry: any, msg: string) =>
        jest.fn().mockRejectedValue(new VendixHttpException(entry, msg));
      const step = [{ tool: 't', arguments: {}, label: 'L' }];

      let h = build(tools, { previewForConsent: bad(ErrorCodes.AI_AGENT_005, 'Sin propuesta') });
      let res: any = await run(() => h.service.propose({ conversationId: 1, goal: 'g', steps: step }));
      expect(res).toMatchObject({ refused: true, reason: 'preview_error' });
      expect(res.explanation).toContain('Sin propuesta');

      h = build(tools, { previewForConsent: bad(ErrorCodes.AI_AGENT_004, 'falta id') });
      res = await run(() => h.service.propose({ conversationId: 1, goal: 'g', steps: step }));
      expect(res).toMatchObject({ refused: true, reason: 'invalid_arguments' });
      expect(res.explanation).toContain('falta id');
      expect(h.createMany).not.toHaveBeenCalled();

      h = build(tools, { previewForConsent: jest.fn().mockRejectedValue(new Error('boom')) });
      await expect(
        run(() => h.service.propose({ conversationId: 1, goal: 'g', steps: step })),
      ).rejects.toThrow('boom');
      expect(h.createMany).not.toHaveBeenCalled();
    });

    it('refuses more than 500 affected records with too_many_records', async () => {
      const h = build({ t: writeTool() });
      const res: any = await run(() =>
        h.service.propose({
          conversationId: 1,
          goal: 'g',
          steps: [
            { tool: 't', arguments: { product_ids: Array.from({ length: 300 }, (_, i) => i) }, label: 'A' },
            { tool: 't', arguments: { ids: Array.from({ length: 201 }, (_, i) => i) }, label: 'B' },
          ],
        }),
      );
      expect(res).toMatchObject({ refused: true, reason: 'too_many_records' });
      expect(res.explanation).toContain('501');
      expect(h.createMany).not.toHaveBeenCalled();
    });

    it('accepts exactly 500 affected records', async () => {
      const h = build({ t: writeTool() });
      const res: any = await run(() =>
        h.service.propose({
          conversationId: 1,
          goal: 'g',
          steps: [{ tool: 't', arguments: { ids: Array.from({ length: 500 }, (_, i) => i) }, label: 'A' }],
        }),
      );
      expect(res.refused).toBeUndefined();
      expect(h.createMany.mock.calls[0][0].data[0].affected_records).toBe(500);
    });

    it('throws AUTH_PERM_001 without a full tenant/user context and persists nothing', async () => {
      const h = build({ t: writeTool() });
      const input = { conversationId: 1, goal: 'g', steps: [{ tool: 't', arguments: {}, label: 'L' }] };
      for (const over of [{ store_id: undefined }, { organization_id: undefined }, { user_id: undefined }]) {
        await expect(run(() => h.service.propose(input), over)).rejects.toMatchObject({
          errorCode: ErrorCodes.AUTH_PERM_001.code,
        });
      }
      await expect(h.service.propose(input)).rejects.toBeInstanceOf(VendixHttpException);
      expect(h.createMany).not.toHaveBeenCalled();
    });

    it('still proposes when the block cannot be created', async () => {
      const h = build({ t: writeTool() });
      h.blocks.create.mockRejectedValue(new Error('block down'));
      const res: any = await run(() =>
        h.service.propose({ conversationId: 1, goal: 'g', steps: [{ tool: 't', arguments: {}, label: 'L' }] }),
      );
      expect(h.createMany).toHaveBeenCalledTimes(1);
      expect(res.batches[0].block_id).toBeUndefined();
    });

    it('creates no block without a conversation', async () => {
      const h = build({ t: writeTool() });
      await run(() =>
        h.service.propose({ conversationId: null, goal: 'g', steps: [{ tool: 't', arguments: {}, label: 'L' }] }),
      );
      expect(h.blocks.create).not.toHaveBeenCalled();
    });
  });

  describe('helpers', () => {
    it('writeBatchArgsHash is key-order independent', () => {
      expect(writeBatchArgsHash('t', { a: 1, b: { c: 2, d: 3 } })).toBe(
        writeBatchArgsHash('t', { b: { d: 3, c: 2 }, a: 1 }),
      );
      expect(writeBatchArgsHash('t', { a: 1 })).not.toBe(writeBatchArgsHash('u', { a: 1 }));
    });
    it('estimateAffectedRecords takes the largest id array, minimum 1', () => {
      expect(estimateAffectedRecords({})).toBe(1);
      expect(estimateAffectedRecords({ product_ids: [1, 2, 3], ids: [1] })).toBe(3);
      expect(estimateAffectedRecords({ tags: [1, 2, 3, 4] })).toBe(1);
    });
  });

  describe('loadOwned', () => {
    const row = { id: 'b1', store_id: STORE, organization_id: ORG, user_id: USER, steps: [] };

    it('returns the row for its owner, querying by store and org', async () => {
      const h = build({});
      h.findFirst.mockResolvedValue(row);
      const out = await run(() => h.service.loadOwned('b1', USER));
      expect(out).toBe(row);
      expect(h.findFirst).toHaveBeenCalledWith({
        where: { id: 'b1', store_id: STORE, organization_id: ORG },
      });
    });

    it('403 for another user', async () => {
      const h = build({});
      h.findFirst.mockResolvedValue(row);
      await expect(run(() => h.service.loadOwned('b1', 99))).rejects.toMatchObject({
        errorCode: ErrorCodes.SYS_FORBIDDEN_001.code,
      });
      await expect(run(() => h.service.loadOwned('b1', undefined))).rejects.toMatchObject({
        errorCode: ErrorCodes.SYS_FORBIDDEN_001.code,
      });
    });

    it('404 when the batch is not in this store', async () => {
      const h = build({});
      h.findFirst.mockResolvedValue(null);
      await expect(run(() => h.service.loadOwned('b1', USER))).rejects.toMatchObject({
        errorCode: ErrorCodes.SYS_NOT_FOUND_001.code,
      });
    });

    it('throws STORE_CONTEXT_001 without store context', async () => {
      const h = build({});
      await expect(
        run(() => h.service.loadOwned('b1', USER), { store_id: undefined }),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.STORE_CONTEXT_001.code });
      expect(h.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('getView', () => {
    const step = (over: Record<string, unknown> = {}) => ({
      step_id: 's1',
      order: 1,
      tool: 't',
      arguments: {},
      label: 'L',
      args_hash: 'h',
      preview_hash: 'p',
      compensable: false,
      status: 'pending',
      ...over,
    });
    const baseRow = (over: Record<string, unknown> = {}) => ({
      id: 'b1',
      store_id: STORE,
      organization_id: ORG,
      user_id: USER,
      conversation_id: 9,
      goal: 'g',
      status: 'proposed',
      steps: [step(), step({ step_id: 's2', order: 2 })],
      step_count: 2,
      affected_records: 2,
      part_index: 1,
      part_total: 1,
      group_id: null,
      version: 1,
      approved_at: null,
      started_at: null,
      finished_at: null,
      summary: null,
      expires_at: new Date(Date.now() + 60_000),
      created_at: new Date(),
      updated_at: new Date(),
      ...over,
    });

    it('returns a live proposed batch untouched', async () => {
      const h = build({});
      h.findFirst.mockResolvedValue(baseRow());
      const view = await run(() => h.service.getView('b1', USER));
      expect(view.status).toBe('proposed');
      expect(view.steps.map((s) => s.status)).toEqual(['pending', 'pending']);
      expect(h.updateMany).not.toHaveBeenCalled();
    });

    it('expires a stale proposed batch conditionally, steps cancelled', async () => {
      const h = build({});
      h.findFirst.mockResolvedValue(baseRow({ expires_at: new Date(Date.now() - 1000) }));
      const view = await run(() => h.service.getView('b1', USER));
      expect(view.status).toBe('expired');
      expect(view.steps.map((s) => s.status)).toEqual(['cancelled', 'cancelled']);
      const call = h.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'b1', store_id: STORE, status: 'proposed' });
      expect(call.data.status).toBe('expired');
      expect(call.data.steps.map((s: any) => s.status)).toEqual(['cancelled', 'cancelled']);
    });

    it('reloads when a concurrent approval won the expiry race', async () => {
      const h = build({});
      h.findFirst
        .mockResolvedValueOnce(baseRow({ expires_at: new Date(Date.now() - 1000) }))
        .mockResolvedValueOnce(baseRow({ status: 'executing', started_at: new Date() }));
      h.updateMany.mockResolvedValue({ count: 0 });
      const view = await run(() => h.service.getView('b1', USER));
      expect(view.status).toBe('executing');
    });

    it('marks a stale executing batch unknown_effect: running→unknown, pending→skipped', async () => {
      const h = build({});
      const started = new Date(Date.now() - WRITE_BATCH_STALE_EXECUTING_MS - 5000);
      h.findFirst.mockResolvedValue(
        baseRow({
          status: 'executing',
          started_at: started,
          version: 4,
          steps: [
            step({ status: 'applied', compensable: true }),
            step({ step_id: 's2', order: 2, status: 'running' }),
            step({ step_id: 's3', order: 3, status: 'pending' }),
          ],
        }),
      );
      const view = await run(() => h.service.getView('b1', USER));
      expect(view.status).toBe('unknown_effect');
      expect(view.steps.map((s) => s.status)).toEqual(['applied', 'unknown', 'skipped']);
      expect(view.steps.some((s) => s.status === 'running' || s.status === 'pending')).toBe(false);
      expect(view.summary?.message).toBe(
        'El paso 2 quedó sin verificar; revisa antes de reintentar. El resto se omitió.',
      );
      expect(view.summary).toMatchObject({ applied: 1, unknown: 1, skipped: 1 });
      const call = h.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'b1', store_id: STORE, status: 'executing', version: 4 });
      expect(call.data.status).toBe('unknown_effect');
    });

    it('does not touch an executing batch that started recently', async () => {
      const h = build({});
      h.findFirst.mockResolvedValue(
        baseRow({
          status: 'executing',
          started_at: new Date(),
          steps: [step({ status: 'running' })],
        }),
      );
      const view = await run(() => h.service.getView('b1', USER));
      expect(view.status).toBe('executing');
      expect(h.updateMany).not.toHaveBeenCalled();
    });

    it('403 for another user and never mutates', async () => {
      const h = build({});
      h.findFirst.mockResolvedValue(baseRow({ expires_at: new Date(Date.now() - 1000) }));
      await expect(run(() => h.service.getView('b1', 99))).rejects.toMatchObject({
        errorCode: ErrorCodes.SYS_FORBIDDEN_001.code,
      });
      expect(h.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('toWriteBatchView', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const mk = (stepOver: Record<string, unknown>, rowOver: Record<string, unknown> = {}) =>
      ({
        id: 'b1',
        conversation_id: 1,
        goal: 'g',
        status: 'applied',
        steps: [
          {
            step_id: 's1',
            order: 1,
            tool: 't',
            arguments: { a: 1 },
            label: 'L',
            args_hash: 'secret-a',
            preview_hash: 'secret-p',
            compensable: true,
            status: 'applied',
            compensation_snapshot: { prev: 1 },
            compensation_output: 'raw',
            ...stepOver,
          },
        ],
        step_count: 1,
        affected_records: 1,
        part_index: 1,
        part_total: 1,
        group_id: null,
        approved_at: null,
        finished_at: new Date(now.getTime() - 60_000),
        summary: null,
        expires_at: now,
        created_at: now,
        ...rowOver,
      }) as any;

    it('strips server-only fields and offers undo only when everything lines up', () => {
      const view = toWriteBatchView(mk({}), now);
      const s = view.steps[0] as any;
      expect(s).not.toHaveProperty('compensation_snapshot');
      expect(s).not.toHaveProperty('compensation_output');
      expect(s).not.toHaveProperty('args_hash');
      expect(s).not.toHaveProperty('preview_hash');
      expect(s.arguments).toEqual({ a: 1 });
      expect(s.can_undo).toBe(true);
      expect(view.undo_until).toBe(
        new Date(now.getTime() - 60_000 + WRITE_BATCH_UNDO_WINDOW_MS).toISOString(),
      );
      expect(JSON.stringify(view)).not.toContain('secret-');
    });

    it.each([
      ['not applied', { status: 'failed' }, {}],
      ['not compensable', { compensable: false }, {}],
      ['no snapshot', { compensation_snapshot: undefined }, {}],
      ['null snapshot', { compensation_snapshot: null }, {}],
      ['window closed', {}, { finished_at: new Date(now.getTime() - WRITE_BATCH_UNDO_WINDOW_MS - 1) }],
      ['not finished', {}, { finished_at: null }],
    ])('can_undo is false when %s', (_n, stepOver, rowOver) => {
      const view = toWriteBatchView(mk(stepOver as any, rowOver as any), now);
      expect(view.steps[0].can_undo).toBe(false);
      expect(view.undo_until).toBeNull();
    });
  });
});
