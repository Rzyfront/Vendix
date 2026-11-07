import { VendixHttpException } from '@common/errors';
import { WorkflowInstancesService } from './workflow-instances.service';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
  seedWorkGroup,
} from '../../../../testing/workflows/workflow-test-kit';

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as VendixHttpException).errorCode;
  }
}

describe('WorkflowInstancesService', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let svc: WorkflowInstancesService;
  let A: number; // started by u4, waiting for a manager (role task)
  let B: number; // started by u5, already completed
  let C: number; // started by u6, still in the request form

  async function startAs(userId: number, amount: number | null) {
    kit.as({ user_id: userId, permissions: ['store:workflows:task'] });
    const s = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: `s-${userId}` });
    if (amount === null) return s.instance.id;
    const task = kit.db.table('workflow_tasks').find((t) => t.instance_id === s.instance.id && t.status === 'open')!;
    await kit.engine.completeTask({
      taskId: task.id,
      outcome: 'submit',
      values: { amount, reason: 'x' },
      expectedRowVersion: s.instance.row_version,
      idempotencyKey: `c-${userId}`,
    });
    return s.instance.id;
  }

  beforeEach(async () => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedWorkGroup(kit.db, 'board', [4, 5, 6]);
    seedDefinition(kit.db, purchaseDefinition());
    kit.db.insert('users', { id: 4, first_name: 'Ana', last_name: 'Ruiz' });
    kit.db.insert('users', { id: 2, first_name: 'Luis', last_name: 'Mora' });
    svc = new WorkflowInstancesService(
      kit.prisma,
      kit.assignment,
      kit.requirements,
      kit.dossiers,
    );
    A = await startAs(4, 5000);
    B = await startAs(5, 500);
    C = await startAs(6, null);
  });
  afterEach(() => jest.restoreAllMocks());

  const ids = async (input = {}) => (await svc.list(input)).data.map((r: any) => r.id).sort();

  it('P1.5: el detalle trae etiqueta y tipo de cada campo para mostrar los datos con que nació', async () => {
    kit.as({ user_id: 1, is_owner: true } as any);
    const d: any = await svc.get(A);
    expect(d.data_fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'amount', label: 'Monto', type: 'money' })]),
    );
  });

  describe('visibilidad (§5.5)', () => {
    it('owner y quien tiene manage ven todas', async () => {
      kit.as({ user_id: 1, is_owner: true, permissions: [] });
      expect(await ids()).toEqual([A, B, C]);
      kit.as({ user_id: 9, is_owner: false, permissions: ['store:workflows:manage'] });
      expect(await ids()).toEqual([A, B, C]);
    });

    it('con solo read: ve las que inició o donde su rol tiene la tarea abierta', async () => {
      kit.as({ user_id: 4, permissions: ['store:workflows:read'] });
      expect(await ids()).toEqual([A]);
      kit.as({ user_id: 5 });
      expect(await ids()).toEqual([B]);
      kit.as({ user_id: 6 });
      expect(await ids()).toEqual([C]);
      // u2 y u3 tienen el rol manager: A está en una etapa asignada a su rol
      kit.as({ user_id: 2 });
      expect(await ids()).toEqual([A]);
      kit.as({ user_id: 3 });
      expect(await ids()).toEqual([A]);
      // u1 solo tiene rol owner (sin bandera is_owner): no ve nada ajeno
      kit.as({ user_id: 1 });
      expect(await ids()).toEqual([]);
    });

    it('quien participó sigue viéndola; quien no, deja de verla al cerrarse la etapa', async () => {
      kit.as({ user_id: 2, permissions: ['store:workflows:task'] });
      const task = kit.db.table('workflow_tasks').find((t) => t.instance_id === A && t.status === 'open')!;
      const inst = kit.db.table('workflow_instances').find((i) => i.id === A)!;
      await kit.engine.completeTask({ taskId: task.id, outcome: 'approve', expectedRowVersion: inst.row_version, idempotencyKey: 'ap' });
      expect(await ids()).toEqual([A]);
      kit.as({ user_id: 3 });
      expect(await ids()).toEqual([]);
      expect(await codeOf(svc.get(A))).toBe('WORKFLOW_NOT_FOUND');
    });

    it('el detalle de una solicitud ajena responde como inexistente', async () => {
      kit.as({ user_id: 4, permissions: [] });
      expect(await codeOf(svc.get(B))).toBe('WORKFLOW_NOT_FOUND');
      expect((await svc.get(A)).id).toBe(A);
    });

    it('una solicitud de otra tienda no existe ni para el owner', async () => {
      kit.as({ user_id: 7, store_id: 2, is_owner: true, permissions: [] });
      expect(await ids()).toEqual([]);
      expect(await codeOf(svc.get(A))).toBe('WORKFLOW_NOT_FOUND');
    });
  });

  describe('list', () => {
    beforeEach(() => kit.as({ user_id: 1, is_owner: true, permissions: [] }));

    it('pagina ordenado por creación descendente', async () => {
      const p1 = await svc.list({ page: 1, limit: 2 });
      expect(p1).toMatchObject({ total: 3, page: 1, limit: 2 });
      expect(p1.data.map((r: any) => r.id)).toEqual([C, B]);
      expect((await svc.list({ page: 2, limit: 2 })).data.map((r: any) => r.id)).toEqual([A]);
      expect(p1.data[0]).toMatchObject({
        reference: 'FLU-000003', definition_name: 'Compra', version: 1,
        current_stage_key: 'request', current_stage_name: 'Solicitud', overdue: false,
      });
    });

    it('filtra por estado, etapa, definición, responsable, búsqueda y fechas', async () => {
      expect(await ids({ status: 'completed' })).toEqual([B]);
      expect(await ids({ stage_key: 'manager' })).toEqual([A]);
      expect(await ids({ definition_id: 999 })).toEqual([]);
      expect(await ids({ assignee_user_id: 6 })).toEqual([C]);
      expect(await ids({ search: 'flu-000002' })).toEqual([B]);
      expect(await ids({ from: new Date(Date.now() + 60_000) })).toEqual([]);
      expect(await ids({ to: new Date(Date.now() + 60_000) })).toEqual([A, B, C]);
    });

    it('overdue solo trae activas con vencimiento pasado', async () => {
      kit.db.table('workflow_instances').find((i) => i.id === C)!.stage_due_at = new Date(Date.now() - 1000);
      kit.db.table('workflow_instances').find((i) => i.id === B)!.stage_due_at = new Date(Date.now() - 1000);
      expect(await ids({ overdue: true })).toEqual([C]);
      expect((await svc.list({ overdue: true })).data[0].overdue).toBe(true);
    });
  });

  describe('get', () => {
    it('devuelve etapa, tareas con responsable, línea de tiempo, requisitos y resultados', async () => {
      kit.as({ user_id: 2, permissions: [] });
      const d = await svc.get(A);
      expect(d).toMatchObject({
        id: A, reference: 'FLU-000001', status: 'active', current_stage_key: 'manager',
        started_by: { type: 'user', id: 4, name: 'Ana Ruiz' },
        definition: { name: 'Compra', key: 'purchase', version: 1 },
        stage: { key: 'manager', name: 'Aprobación del gerente', type: 'approval' },
        pending_requirements: [],
        allowed_outcomes: ['approve', 'reject'],
      });
      expect(d.tasks).toHaveLength(1);
      expect(d.tasks[0]).toMatchObject({
        kind: 'approval', status: 'open',
        assignee: { type: 'role', name: 'manager' }, can_act: true,
      });
      expect(d.timeline.map((e: any) => e.seq)).toEqual([...d.timeline.keys()].map((i) => i + 1));
      expect(d.timeline[0]).toMatchObject({ type: 'started', actor_name: 'Ana Ruiz' });
      expect(d.data).toMatchObject({ amount: 5000 });
      expect(d.timeline.some((e: any) => typeof e.occurred_at !== 'undefined')).toBe(true);
    });

    it('can_act es falso para quien no es responsable y la tarea del iniciador lo nombra', async () => {
      kit.as({ user_id: 4, permissions: [] });
      expect((await svc.get(A)).tasks[0].can_act).toBe(false);
      kit.as({ user_id: 6, permissions: [] });
      const c = await svc.get(C);
      expect(c.stage).toMatchObject({ key: 'request', type: 'form' });
      expect(c.allowed_outcomes).toEqual(['submit']);
      expect(c.tasks[0]).toMatchObject({ assignee: { type: 'user', id: 6 }, can_act: true });
    });

    it('en una solicitud cerrada no hay tareas, requisitos ni resultados permitidos', async () => {
      kit.as({ user_id: 5, permissions: [] });
      const b = await svc.get(B);
      expect(b).toMatchObject({ status: 'completed', tasks: [], pending_requirements: [], allowed_outcomes: [] });
    });
  });
});
