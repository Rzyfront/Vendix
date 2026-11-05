import { VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
  seedWorkGroup,
} from '../../../../testing/workflows/workflow-test-kit';

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException ? e.errorCode : `OTHER:${(e as Error).message}`;
  }
}

describe('WorkflowEngineService', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  const events = (instanceId: number) =>
    kit.db.table('workflow_instance_events').filter((e) => e.instance_id === instanceId);
  const tasks = (instanceId: number, status?: string) =>
    kit.db
      .table('workflow_tasks')
      .filter((t) => t.instance_id === instanceId && (!status || t.status === status));

  async function startPurchase(amount: number, key = `start-${amount}-${Math.random()}`) {
    const started = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: key });
    const task = tasks(started.instance.id, 'open')[0];
    return { started, task, instance: started.instance };
  }

  async function submit(taskId: number, amount: number, version: number, key?: string) {
    return kit.engine.completeTask({
      taskId,
      outcome: 'submit',
      values: { amount, reason: 'x' },
      expectedRowVersion: version,
      idempotencyKey: key,
    });
  }

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedWorkGroup(kit.db, 'board', [4, 5, 6]);
    seedDefinition(kit.db, purchaseDefinition());
  });
  const afterEachKit = () => jest.restoreAllMocks();
  afterEach(() => jest.restoreAllMocks());

  describe('start', () => {
    it('crea la solicitud en la etapa inicial con tarea para quien la inicia, referencia FLU- y evento started', async () => {
      const { started, task } = await startPurchase(0);
      expect(started.instance).toMatchObject({
        status: 'active',
        current_stage_key: 'request',
        reference: 'FLU-000001',
        stage_entry_seq: 1,
        row_version: 0,
        started_by_id: 1,
        store_id: 1,
      });
      expect(task).toMatchObject({ kind: 'form', assignee_user_id: 1, stage_key: 'request' });
      expect(events(started.instance.id).map((e) => [e.seq, e.type])).toEqual([[1, 'started']]);
    });

    it('la referencia es correlativa por tienda', async () => {
      await startPurchase(0);
      const second = await startPurchase(0);
      expect(second.instance.reference).toBe('FLU-000002');
      seedDefinition(kit.db, purchaseDefinition(), 2);
      kit.as({ store_id: 2, user_id: 7 });
      const other = await kit.engine.start({ definitionKey: 'purchase' });
      expect(other.instance.reference).toBe('FLU-000001');
    });

    it('rechaza flujos no activos', async () => {
      kit.db.table('workflow_definitions')[0].status = 'draft';
      expect(await codeOf(kit.engine.start({ definitionKey: 'purchase' }))).toBe('WORKFLOW_NOT_ACTIVE');
    });

    it('aplica start_roles (manager sí, cajero no)', async () => {
      kit.db.table('workflow_versions')[0].definition = purchaseDefinition({ start_roles: ['manager'] });
      kit.as({ user_id: 6 });
      expect(await codeOf(kit.engine.start({ definitionKey: 'purchase' }))).toBe('WORKFLOW_START_FORBIDDEN');
      kit.as({ user_id: 2 });
      const ok = await kit.engine.start({ definitionKey: 'purchase' });
      expect(ok.instance.status).toBe('active');
    });

    it('un reintento con la misma idempotencyKey devuelve la solicitud original sin duplicar', async () => {
      const a = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'k1' });
      const b = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'k1' });
      expect(b.replayed).toBe(true);
      expect(b.instance.id).toBe(a.instance.id);
      expect(kit.db.table('workflow_instances')).toHaveLength(1);
      expect(kit.db.table('workflow_instance_events')).toHaveLength(1);
    });
  });

  describe('completeTask', () => {
    it('rama condicional por monto: >10000 va a la junta, >1000 al gerente, el resto termina', async () => {
      const big = await startPurchase(0);
      const r1 = await submit(big.task.id, 50000, 0);
      expect(r1.to_stage_key).toBe('board');

      const mid = await startPurchase(0);
      const r2 = await submit(mid.task.id, 5000, 0);
      expect(r2.to_stage_key).toBe('manager');
      expect(tasks(mid.instance.id, 'open')[0]).toMatchObject({
        kind: 'approval',
        assignee_role_id: 2,
      });

      const small = await startPurchase(0);
      const r3 = await submit(small.task.id, 10, 0);
      expect(r3.to_stage_key).toBe('done');
    });

    it('la etapa end completa la solicitud y cierra sus tareas', async () => {
      const { task, instance } = await startPurchase(0);
      const r = await submit(task.id, 10, 0);
      expect(r.instance).toMatchObject({ status: 'completed', current_stage_key: 'done', row_version: 1 });
      expect(r.instance.completed_at).toBeInstanceOf(Date);
      expect(tasks(instance.id, 'open')).toHaveLength(0);
      expect(tasks(instance.id, 'done')).toHaveLength(1);
      expect(r.instance.data).toMatchObject({ amount: 10, reason: 'x' });
    });

    it('registra un único evento task_completed por avance con from/to', async () => {
      const { task, instance } = await startPurchase(0);
      await submit(task.id, 5000, 0, 'ev-1');
      const evs = events(instance.id);
      expect(evs.map((e) => e.type)).toEqual(['started', 'task_completed']);
      expect(evs[1]).toMatchObject({ seq: 2, from_stage_key: 'request', to_stage_key: 'manager', actor_id: 1 });
    });

    it('dos finalizaciones simultáneas de la misma tarea: una gana, la otra recibe STALE o TASK_CLOSED, un solo avance', async () => {
      const { task, instance } = await startPurchase(0);
      const results = await Promise.allSettled([
        submit(task.id, 5000, 0, 'a'),
        submit(task.id, 5000, 0, 'b'),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(['WORKFLOW_STALE', 'WORKFLOW_TASK_CLOSED']).toContain(failed[0].reason.errorCode);
      expect(events(instance.id).filter((e) => e.type === 'task_completed')).toHaveLength(1);
      expect(kit.db.table('workflow_instances')[0].row_version).toBe(1);
      expect(tasks(instance.id, 'open')).toHaveLength(1); // solo la del gerente
    });

    it('expectedRowVersion desfasado → WORKFLOW_STALE sin efectos', async () => {
      const { task, instance } = await startPurchase(0);
      expect(await codeOf(submit(task.id, 5000, 7))).toBe('WORKFLOW_STALE');
      expect(events(instance.id)).toHaveLength(1);
      expect(kit.db.table('workflow_instances')[0].current_stage_key).toBe('request');
    });

    it('reintento idempotente: misma clave dos veces → mismo resultado y un solo evento', async () => {
      const { task, instance } = await startPurchase(0);
      const first = await submit(task.id, 5000, 0, 'same');
      const again = await submit(task.id, 5000, 0, 'same');
      expect(again.replayed).toBe(true);
      expect(again.instance.id).toBe(first.instance.id);
      expect(again.to_stage_key).toBe(first.to_stage_key);
      expect(events(instance.id).filter((e) => e.type === 'task_completed')).toHaveLength(1);
      expect(tasks(instance.id)).toHaveLength(2);
    });

    it('carrera de idempotency_key: el P2002 del evento revierte la transacción y se devuelve el resultado original', async () => {
      const first = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'race' });
      const events = (kit.engine as any).events;
      const realReplay = events.replay.bind(events);
      // La verificación previa de la segunda petición no ve la clave (corrió en paralelo).
      jest.spyOn(events, 'replay').mockResolvedValueOnce(null).mockImplementation(realReplay);
      const second = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'race' });
      expect(second.replayed).toBe(true);
      expect(second.instance.id).toBe(first.instance.id);
      expect(kit.db.table('workflow_instances')).toHaveLength(1);
      expect(kit.db.table('workflow_tasks')).toHaveLength(1);
      expect(kit.db.table('workflow_instance_events')).toHaveLength(1);
    });

    it('resultado sin transición → 422 WORKFLOW_NO_TRANSITION', async () => {
      kit.db.table('workflow_versions')[0].definition = purchaseDefinition({
        stages: purchaseDefinition().stages.map((s) =>
          s.key === 'request'
            ? { ...s, transitions: [{ on: 'submit', to: 'done', when: { all: [{ field: 'amount', op: 'gt', value: 999999 }] } }] }
            : s,
        ),
      });
      const { task, instance } = await startPurchase(0);
      expect(await codeOf(submit(task.id, 5, 0))).toBe('WORKFLOW_NO_TRANSITION');
      expect(kit.db.table('workflow_instances')[0].row_version).toBe(0);
      expect(events(instance.id)).toHaveLength(1);
    });

    it('un resultado que la etapa no admite → WORKFLOW_OUTCOME_INVALID', async () => {
      const { task } = await startPurchase(0);
      expect(
        await codeOf(kit.engine.completeTask({ taskId: task.id, outcome: 'approve', expectedRowVersion: 0 })),
      ).toBe('WORKFLOW_OUTCOME_INVALID');
    });

    it('formulario inválido → 422 WORKFLOW_FORM_INVALID con los errores', async () => {
      const { task } = await startPurchase(0);
      const err: any = await kit.engine
        .completeTask({ taskId: task.id, outcome: 'submit', values: { reason: 'x' }, expectedRowVersion: 0 })
        .catch((e) => e);
      expect(err.errorCode).toBe('WORKFLOW_FORM_INVALID');
      expect(err.getResponse().details.errors.length).toBeGreaterThan(0);
    });

    it('rechazar sin comentario cuando la transición lo exige → WORKFLOW_COMMENT_REQUIRED', async () => {
      const { task } = await startPurchase(0);
      await submit(task.id, 5000, 0);
      kit.as({ user_id: 2 });
      const approval = kit.db.table('workflow_tasks').find((t) => t.stage_key === 'manager');
      expect(
        await codeOf(kit.engine.completeTask({ taskId: approval!.id, outcome: 'reject', expectedRowVersion: 1 })),
      ).toBe('WORKFLOW_COMMENT_REQUIRED');
      const ok = await kit.engine.completeTask({
        taskId: approval!.id,
        outcome: 'reject',
        comment: 'caro',
        expectedRowVersion: 1,
      });
      expect(ok.instance).toMatchObject({ status: 'rejected', current_stage_key: 'rejected' });
    });

    it('quién puede atender: un tercero no (403), el titular del rol sí', async () => {
      const { task } = await startPurchase(0);
      await submit(task.id, 5000, 0);
      const approval = kit.db.table('workflow_tasks').find((t) => t.stage_key === 'manager')!;
      kit.as({ user_id: 6 });
      expect(
        await codeOf(kit.engine.completeTask({ taskId: approval.id, outcome: 'approve', expectedRowVersion: 1 })),
      ).toBe('WORKFLOW_TASK_FORBIDDEN');
      kit.as({ user_id: 2 });
      const done = await kit.engine.completeTask({ taskId: approval.id, outcome: 'approve', expectedRowVersion: 1 });
      expect(done.instance.status).toBe('completed');
      expect(kit.db.table('workflow_tasks').find((t) => t.id === approval.id)).toMatchObject({
        status: 'done',
        completed_by_user_id: 2,
        outcome: 'approve',
      });
    });

    it('exige el permiso store:workflows:task cuando el contexto trae permisos', async () => {
      const { task } = await startPurchase(0);
      kit.as({ permissions: ['store:workflows:read'] });
      expect(await codeOf(submit(task.id, 5, 0))).toBe('WORKFLOW_TASK_FORBIDDEN');
      kit.as({ permissions: ['store:workflows:task'] });
      expect((await submit(task.id, 5, 0)).instance.status).toBe('completed');
    });

    it('una tarea ya atendida → WORKFLOW_TASK_CLOSED', async () => {
      const { task } = await startPurchase(0);
      await submit(task.id, 5, 0);
      expect(await codeOf(submit(task.id, 5, 1))).toBe('WORKFLOW_TASK_CLOSED');
    });
  });

  describe('claim', () => {
    it('una tarea de rol se toma; la tomada solo la completa quien la tomó', async () => {
      const { task } = await startPurchase(0);
      await submit(task.id, 5000, 0);
      const approval = kit.db.table('workflow_tasks').find((t) => t.stage_key === 'manager')!;
      kit.as({ user_id: 2 });
      const claimed = await kit.engine.claimTask(approval.id);
      expect(claimed).toMatchObject({ status: 'claimed', assignee_user_id: 2 });
      kit.as({ user_id: 3 }); // otro gerente
      expect(await codeOf(kit.engine.claimTask(approval.id))).toBe('WORKFLOW_TASK_CLOSED');
      expect(
        await codeOf(kit.engine.completeTask({ taskId: approval.id, outcome: 'approve', expectedRowVersion: 1 })),
      ).toBe('WORKFLOW_TASK_FORBIDDEN');
      kit.as({ user_id: 2 });
      expect(
        (await kit.engine.completeTask({ taskId: approval.id, outcome: 'approve', expectedRowVersion: 1 })).instance.status,
      ).toBe('completed');
    });

    it('un usuario sin rol no puede tomarla', async () => {
      const { task } = await startPurchase(0);
      await submit(task.id, 5000, 0);
      const approval = kit.db.table('workflow_tasks').find((t) => t.stage_key === 'manager')!;
      kit.as({ user_id: 6 });
      expect(await codeOf(kit.engine.claimTask(approval.id))).toBe('WORKFLOW_TASK_FORBIDDEN');
    });
  });

  describe('quórum 2 de 3', () => {
    async function toBoard() {
      const { task, instance } = await startPurchase(0);
      await submit(task.id, 50000, 0);
      const board = kit.db.table('workflow_tasks').find((t) => t.stage_key === 'board')!;
      return { board, instance };
    }
    const approve = (taskId: number, key?: string) =>
      kit.engine.completeTask({ taskId, outcome: 'approve', expectedRowVersion: 0, idempotencyKey: key });

    it('la primera aprobación registra el voto y no avanza; la segunda distinta avanza', async () => {
      const { board, instance } = await toBoard();
      expect(board).toMatchObject({ assignee_group_id: 1, assignee_user_id: null });
      kit.as({ user_id: 4 });
      const first = await approve(board.id, 'v1');
      expect(first.advanced).toBe(false);
      expect(first.instance.current_stage_key).toBe('board');
      expect(kit.db.table('workflow_tasks').find((t) => t.id === board.id)!.status).toBe('open');
      expect(events(instance.id).map((e) => e.type)).toContain('vote');

      kit.as({ user_id: 5 });
      const second = await approve(board.id, 'v2');
      expect(second.advanced).toBe(true);
      expect(second.instance).toMatchObject({ status: 'completed', current_stage_key: 'done' });
      expect(kit.db.table('workflow_task_votes')).toHaveLength(2);
    });

    it('la misma persona no vota dos veces', async () => {
      const { board } = await toBoard();
      kit.as({ user_id: 4 });
      await approve(board.id);
      expect(await codeOf(approve(board.id))).toBe('WORKFLOW_ALREADY_VOTED');
    });

    it('un rechazo de cualquiera decide el rechazo', async () => {
      const { board } = await toBoard();
      kit.as({ user_id: 6 });
      const r = await kit.engine.completeTask({ taskId: board.id, outcome: 'reject', expectedRowVersion: 1 });
      expect(r.instance).toMatchObject({ status: 'rejected', current_stage_key: 'rejected' });
    });

    it('un miembro ajeno al grupo no puede votar y una tarea con quórum no se toma', async () => {
      const { board } = await toBoard();
      kit.as({ user_id: 2 });
      expect(await codeOf(approve(board.id))).toBe('WORKFLOW_TASK_FORBIDDEN');
      kit.as({ user_id: 4 });
      expect(await codeOf(kit.engine.claimTask(board.id))).toBe('WORKFLOW_CLAIM_NOT_ALLOWED');
    });

    it('dos aprobaciones simultáneas: se serializan sobre la instancia y avanzan una sola vez', async () => {
      const { board, instance } = await toBoard();
      const settled = await Promise.allSettled([
        kit.runAs({ user_id: 4 }, () => approve(board.id, 'c1')),
        kit.runAs({ user_id: 5 }, () => approve(board.id, 'c2')),
      ]);
      expect(settled.every((s) => s.status === 'fulfilled')).toBe(true);
      const results = settled.map((s) => (s as PromiseFulfilledResult<any>).value);
      expect(results.filter((r) => r.advanced)).toHaveLength(1);
      expect(
        events(instance.id).filter((e) => e.type === 'task_completed' && e.from_stage_key === 'board'),
      ).toHaveLength(1);
      expect(kit.db.table('workflow_task_votes')).toHaveLength(2);
      expect(kit.db.table('workflow_instances')[0]).toMatchObject({ status: 'completed' });
    });
  });

  describe('requisitos', () => {
    const withRequirements = (extra: any) =>
      purchaseDefinition({
        stages: purchaseDefinition().stages.map((s) =>
          s.key === 'manager' ? { ...s, ...extra } : s,
        ),
      });

    async function toManager() {
      const { task } = await startPurchase(0);
      await submit(task.id, 5000, 0);
      return kit.db.table('workflow_tasks').find((t) => t.stage_key === 'manager')!;
    }

    it('requisito pendiente → 409 con la lista legible y sin avanzar', async () => {
      kit.db.table('workflow_versions')[0].definition = withRequirements({
        requirements: [
          { kind: 'file_field', key: 'inv', label: 'Factura', field: 'invoice' },
          { kind: 'upload', key: 'rut', label: 'RUT del proveedor' },
        ],
      });
      const approval = await toManager();
      kit.as({ user_id: 2 });
      const err: any = await kit.engine
        .completeTask({ taskId: approval.id, outcome: 'approve', expectedRowVersion: 1 })
        .catch((e) => e);
      expect(err.errorCode).toBe('WORKFLOW_REQUIREMENT_PENDING');
      expect(err.getResponse().message).toBe('Falta: Factura, RUT del proveedor');
      expect(err.getResponse().details.pending).toEqual([
        { key: 'inv', label: 'Factura' },
        { key: 'rut', label: 'RUT del proveedor' },
      ]);
      expect(kit.db.table('workflow_instances')[0].current_stage_key).toBe('manager');
    });

    it('reject nunca queda bloqueado por requisitos', async () => {
      kit.db.table('workflow_versions')[0].definition = withRequirements({
        requirements: [{ kind: 'upload', key: 'rut', label: 'RUT' }],
      });
      const approval = await toManager();
      kit.as({ user_id: 2 });
      const r = await kit.engine.completeTask({
        taskId: approval.id,
        outcome: 'reject',
        comment: 'no',
        expectedRowVersion: 1,
      });
      expect(r.instance.status).toBe('rejected');
    });

    it('file_field se cumple cuando el campo de la solicitud tiene valor', async () => {
      kit.db.table('workflow_versions')[0].definition = withRequirements({
        requirements: [{ kind: 'file_field', key: 'inv', label: 'Factura', field: 'invoice' }],
      });
      const approval = await toManager();
      kit.db.table('workflow_instances')[0].data.invoice = 'file-1';
      kit.as({ user_id: 2 });
      const r = await kit.engine.completeTask({ taskId: approval.id, outcome: 'approve', expectedRowVersion: 1 });
      expect(r.instance.status).toBe('completed');
    });
  });

  describe('administración', () => {
    it('transition forzada: evento forced, tareas cerradas y nueva tarea', async () => {
      const { instance } = await startPurchase(0);
      kit.as({ user_id: 1 });
      const r = await kit.engine.transition({ instanceId: instance.id, to: 'manager', reason: 'corrección' });
      expect(r.instance.current_stage_key).toBe('manager');
      expect(events(instance.id).map((e) => e.type)).toEqual(['started', 'forced']);
      expect(events(instance.id)[1].payload).toEqual({ reason: 'corrección' });
      expect(tasks(instance.id, 'cancelled')).toHaveLength(1);
      expect(tasks(instance.id, 'open')[0].stage_key).toBe('manager');
      expect(r.instance.stage_entry_seq).toBe(2);
    });

    it('transition a una etapa inexistente → WORKFLOW_STAGE_NOT_FOUND', async () => {
      const { instance } = await startPurchase(0);
      expect(await codeOf(kit.engine.transition({ instanceId: instance.id, to: 'nope', reason: 'x' }))).toBe(
        'WORKFLOW_STAGE_NOT_FOUND',
      );
    });

    it('cancel cierra la solicitud, sus tareas y deja el motivo', async () => {
      const { instance } = await startPurchase(0);
      const r = await kit.engine.cancel({ instanceId: instance.id, reason: 'duplicada' });
      expect(r).toMatchObject({ status: 'cancelled', cancel_reason: 'duplicada' });
      expect(tasks(instance.id, 'open')).toHaveLength(0);
      expect(events(instance.id).map((e) => e.type)).toEqual(['started', 'cancelled']);
      expect(await codeOf(kit.engine.cancel({ instanceId: instance.id, reason: 'otra vez' }))).toBe(
        'WORKFLOW_INSTANCE_CLOSED',
      );
    });
  });

  describe('etapa automática y on_enter / on_exit', () => {
    const autoDefinition = (): WorkflowDefinitionV1 =>
      ({
        schema: 'vendix.workflow/v1',
        key: 'auto',
        name: 'Auto',
        fields: [{ key: 'status_note', type: 'text', label: 'Nota' }],
        stages: [
          {
            key: 'a',
            name: 'A',
            type: 'form',
            start: true,
            assignee: { kind: 'initiator' },
            form: { fields: [] },
            on_exit: [{ action: 'set_field', field: 'status_note', value: 'salió' }],
            transitions: [{ on: 'submit', to: 'auto' }],
          },
          {
            key: 'auto',
            name: 'Automática',
            type: 'automatic',
            on_enter: [{ action: 'notify', to: { kind: 'initiator' }, message: 'entró' }],
            transitions: [{ on: 'auto', to: 'end' }],
          },
          { key: 'end', name: 'Fin', type: 'end', outcome: 'completed' },
        ],
      }) as WorkflowDefinitionV1;

    it('entrar a una automática encola advance (no encadena); tick la avanza; set_field y notify se aplican', async () => {
      seedDefinition(kit.db, autoDefinition());
      const started = await kit.engine.start({ definitionKey: 'auto' });
      const task = tasks(started.instance.id, 'open')[0];
      const r = await kit.engine.completeTask({ taskId: task.id, outcome: 'submit', expectedRowVersion: 0 });
      expect(r.instance.current_stage_key).toBe('auto');
      expect(r.instance.data).toMatchObject({ status_note: 'salió' });
      const outbox = kit.db.table('workflow_outbox');
      expect(outbox.filter((o) => o.kind === 'advance')).toHaveLength(1);
      expect(outbox.filter((o) => o.kind === 'notify' && o.payload.message === 'entró')).toHaveLength(1);

      const adv = outbox.find((o) => o.kind === 'advance')!;
      const t = await kit.engine.tick(started.instance.id, { expectStageEntrySeq: adv.payload.stage_entry_seq });
      expect(t.action).toBe('advanced');
      expect(kit.db.table('workflow_instances').find((i) => i.id === started.instance.id)).toMatchObject({
        status: 'completed',
        current_stage_key: 'end',
      });
      // Un tick repetido o con entrada vieja no hace nada.
      expect((await kit.engine.tick(started.instance.id)).action).toBe('noop');
    });
  });

  describe('aislamiento por tienda', () => {
    it('aunque el tx no tuviera scope, los predicados explícitos de store_id aíslan las tiendas', async () => {
      afterEachKit();
      kit = buildWorkflowKit({ unscopedTx: true });
      seedPeople(kit.db);
      seedWorkGroup(kit.db, 'board', [4, 5, 6]);
      seedDefinition(kit.db, purchaseDefinition());
      seedDefinition(kit.db, purchaseDefinition(), 2);
      kit.as({ store_id: 2, user_id: 7 });
      const b = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'kb' });
      const taskB = kit.db.table('workflow_tasks').find((t) => t.instance_id === b.instance.id)!;
      kit.as({ store_id: 1, user_id: 1 });
      expect(await codeOf(submit(taskB.id, 1, 0))).toBe('WORKFLOW_TASK_NOT_FOUND');
      expect(await codeOf(kit.engine.claimTask(taskB.id))).toBe('WORKFLOW_TASK_NOT_FOUND');
      expect(await codeOf(kit.engine.cancel({ instanceId: b.instance.id, reason: 'x' }))).toBe('WORKFLOW_NOT_FOUND');
      expect(await codeOf(kit.engine.transition({ instanceId: b.instance.id, to: 'done', reason: 'x' }))).toBe(
        'WORKFLOW_NOT_FOUND',
      );
      expect((await kit.engine.tick(b.instance.id)).action).toBe('noop');
      expect(kit.db.table('workflow_instances').find((i) => i.id === b.instance.id)).toMatchObject({
        status: 'active',
        row_version: 0,
      });
      // la misma clave de idempotencia de la tienda B no se reproduce en la A
      const mine = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'kb' });
      expect(mine.replayed).toBe(false);
      expect(mine.instance.id).not.toBe(b.instance.id);
    });

    it('una tarea e instancia de la tienda B no se encuentran desde la tienda A', async () => {
      seedDefinition(kit.db, purchaseDefinition(), 2);
      kit.as({ store_id: 2, user_id: 7 });
      const started = await kit.engine.start({ definitionKey: 'purchase' });
      const taskB = kit.db.table('workflow_tasks').find((t) => t.instance_id === started.instance.id)!;

      kit.as({ store_id: 1, user_id: 1 });
      expect(await codeOf(submit(taskB.id, 1, 0))).toBe('WORKFLOW_TASK_NOT_FOUND');
      expect(await codeOf(kit.engine.claimTask(taskB.id))).toBe('WORKFLOW_TASK_NOT_FOUND');
      expect(await codeOf(kit.engine.cancel({ instanceId: started.instance.id, reason: 'x' }))).toBe(
        'WORKFLOW_NOT_FOUND',
      );
      expect(
        await codeOf(kit.engine.transition({ instanceId: started.instance.id, to: 'done', reason: 'x' })),
      ).toBe('WORKFLOW_NOT_FOUND');
      expect((await kit.engine.tick(started.instance.id)).action).toBe('noop');
      // y la misma clave de idempotencia en otra tienda no colisiona
      const mine = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'k' });
      kit.as({ store_id: 2, user_id: 7 });
      const theirs = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'k' });
      expect(theirs.instance.id).not.toBe(mine.instance.id);
      expect(theirs.replayed).toBe(false);
    });
  });
});
