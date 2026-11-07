import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
  seedWorkGroup,
} from '../../../../testing/workflows/workflow-test-kit';

describe('WorkflowInboxService', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let inst: Record<string, number>;

  /** Starts as `userId`, submits the form with `amount` and returns the instance id. */
  async function request(userId: number, amount: number | null, key: string) {
    kit.as({ user_id: userId, permissions: ['store:workflows:task'] });
    const s = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: `s-${key}` });
    if (amount === null) return s.instance.id;
    const task = kit.db.table('workflow_tasks').find((t) => t.instance_id === s.instance.id && t.status === 'open')!;
    await kit.engine.completeTask({
      taskId: task.id,
      outcome: 'submit',
      values: { amount },
      expectedRowVersion: s.instance.row_version,
      idempotencyKey: `c-${key}`,
    });
    return s.instance.id;
  }

  const inbox = async (userId: number, q: Record<string, any> = {}, extra: Record<string, any> = {}) => {
    kit.as({ user_id: userId, permissions: ['store:workflows:task'], ...extra });
    return kit.inbox.list(q);
  };
  const taskIds = (r: { data: any[] }) => r.data.map((d) => d.instance.id);

  beforeEach(async () => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedWorkGroup(kit.db, 'board', [4, 5]);
    seedDefinition(kit.db, purchaseDefinition());
    kit.db.insert('users', { id: 4, first_name: 'Ana', last_name: 'Ruiz' });
    kit.db.insert('workflow_definitions', { id: 99, store_id: 2, organization_id: 1, key: 'x', name: 'X', status: 'active', created_by_user_id: 7 });
    inst = {
      form: await request(6, null, 'form'), // u6's own form task
      manager: await request(6, 5000, 'mgr'), // role manager (u2, u3)
      board: await request(6, 50000, 'board'), // group board (u4, u5), quorum
    };
  });
  afterEach(() => jest.restoreAllMocks());

  it('tarea asignada al usuario: aparece solo para él, con el contrato de fila', async () => {
    const r = await inbox(6);
    expect(taskIds(r)).toEqual([inst.form]);
    expect(r).toMatchObject({ total: 1, page: 1, limit: 20 });
    const row = r.data[0];
    expect(row).toMatchObject({
      kind: 'form',
      status: 'open',
      due_at: null,
      overdue: false,
      stage_key: 'request',
      stage_name: 'Solicitud',
      instance: { id: inst.form, reference: 'FLU-000001', title: 'Compra', row_version: 0 },
      definition: { name: 'Compra' },
      assignee: { type: 'user', id: 6 },
    });
    expect(typeof row.task_id).toBe('number');
    expect(Array.isArray(row.quick_outcomes)).toBe(true);
    expect(taskIds(await inbox(5)).includes(inst.form)).toBe(false);
  });

  it('sin reclamar por rol: lo ven quienes tienen el rol y nadie más', async () => {
    expect(taskIds(await inbox(2))).toEqual([inst.manager]);
    expect(taskIds(await inbox(3))).toEqual([inst.manager]);
    expect(taskIds(await inbox(1))).toEqual([]);
    expect((await inbox(2)).data[0].assignee).toMatchObject({ type: 'role', name: 'manager' });
  });

  it('sin reclamar por grupo: lo ven los miembros', async () => {
    expect(taskIds(await inbox(4))).toEqual([inst.board]);
    expect(taskIds(await inbox(5))).toEqual([inst.board]);
    expect((await inbox(4)).data[0].assignee).toMatchObject({ type: 'group', name: 'board' });
  });

  it('una tarea reclamada solo la ve quien la reclamó (status=claimed)', async () => {
    const t = kit.db.table('workflow_tasks').find((x) => x.instance_id === inst.manager && x.status === 'open')!;
    kit.as({ user_id: 2, permissions: ['store:workflows:task'] });
    await kit.engine.claimTask(t.id);
    expect(taskIds(await inbox(2))).toEqual([inst.manager]);
    expect((await inbox(2)).data[0]).toMatchObject({ status: 'claimed', assignee: { type: 'user', id: 2 } });
    expect(taskIds(await inbox(3))).toEqual([]);
    expect(taskIds(await inbox(2, { status: 'claimed' }))).toEqual([inst.manager]);
    expect(taskIds(await inbox(2, { status: 'open' }))).toEqual([]);
  });

  it('no mezcla tiendas ni instancias cerradas', async () => {
    kit.db.insert('workflow_instances', {
      id: 500, store_id: 2, organization_id: 1, definition_id: 99, version_id: 1, reference: 'FLU-000001',
      title: 'Otra', current_stage_key: 'a', started_by_type: 'user', started_by_id: 7,
    });
    kit.db.insert('workflow_tasks', {
      store_id: 2, organization_id: 1, instance_id: 500, stage_key: 'a', stage_entry_seq: 1,
      kind: 'form', status: 'open', assignee_user_id: 7,
    });
    expect(taskIds(await inbox(6))).toEqual([inst.form]);
    kit.as({ user_id: 7, store_id: 2, permissions: [] });
    expect(taskIds(await kit.inbox.list())).toEqual([500]);
    // closing the request cancels its task: it leaves the inbox
    kit.as({ user_id: 1, store_id: 1, is_owner: true, permissions: [] });
    await kit.engine.cancel({ instanceId: inst.form, reason: 'x' });
    expect(taskIds(await inbox(6))).toEqual([]);
  });

  it('orden: vencimiento ascendente con nulos al final; overdue y definition_id filtran', async () => {
    const tasks = kit.db.table('workflow_tasks');
    const mine = (i: number) => tasks.find((t) => t.instance_id === i)!;
    // u6 gets two tasks by hand to compare ordering
    const extra = await request(6, null, 'extra');
    mine(inst.form).due_at = new Date(Date.now() + 3_600_000);
    mine(extra).due_at = new Date(Date.now() - 3_600_000);
    const r = await inbox(6);
    expect(taskIds(r)).toEqual([extra, inst.form]);
    expect(r.data[0].overdue).toBe(true);
    expect(r.data[1].overdue).toBe(false);
    mine(inst.form).due_at = null;
    expect(taskIds(await inbox(6))).toEqual([extra, inst.form]);
    expect(taskIds(await inbox(6, { overdue: true }))).toEqual([extra]);
    expect(taskIds(await inbox(6, { definition_id: 1 }))).toEqual([extra, inst.form]);
    expect(taskIds(await inbox(6, { definition_id: 99 }))).toEqual([]);
    const page2 = await inbox(6, { page: 2, limit: 1 });
    expect(taskIds(page2)).toEqual([inst.form]);
    expect(page2.total).toBe(2);
  });

  describe('quick_outcomes', () => {
    it('etapa con campo obligatorio: solo las decisiones sin valores', async () => {
      // 'request' form has required `amount`: submit needs values
      expect((await inbox(6)).data[0].quick_outcomes).toEqual([]);
    });

    it('aprobación sin formulario: aprobar rápido; rechazar exige comentario → no es rápido', async () => {
      expect((await inbox(2)).data[0].quick_outcomes).toEqual(['approve']);
    });

    it('P5.5: reject que exige comentario va en comment_outcomes; expone stage_type y has_form', async () => {
      const task = (await inbox(2)).data[0];
      expect(task.comment_outcomes).toEqual(['reject']);
      expect(task.stage_type).toBe('approval');
      expect(task.has_form).toBe(false);
      const form = (await inbox(6)).data[0];
      expect(form.has_form).toBe(true);
      expect(form.comment_outcomes).toEqual([]);
    });

    it('requisito bloqueante en la etapa: approve deja de ser rápido', async () => {
      const def = purchaseDefinition();
      (def.stages.find((s) => s.key === 'manager') as any).requirements = [
        { kind: 'upload', key: 'doc', label: 'Documento' },
      ];
      kit.db.table('workflow_versions')[0].definition = def;
      expect((await inbox(2)).data[0].quick_outcomes).toEqual([]);
    });

    it('si ninguna transición del resultado pide comentario, ambos son rápidos', async () => {
      const def = purchaseDefinition();
      (def.stages.find((s) => s.key === 'manager') as any).transitions[1].require_comment = false;
      kit.db.table('workflow_versions')[0].definition = def;
      expect((await inbox(2)).data[0].quick_outcomes).toEqual(['approve', 'reject']);
    });
  });
});
