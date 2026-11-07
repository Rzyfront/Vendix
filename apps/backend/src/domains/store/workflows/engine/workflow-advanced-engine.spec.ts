import { VendixHttpException } from '@common/errors';
import {
  WORKFLOW_SCHEMA_V1,
  WorkflowDefinitionV1,
  WorkflowStageDef,
} from '@common/workflows/contract';
import {
  buildWorkflowKit,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { WorkflowMigrationService } from '../definitions/workflow-migration.service';
import { WorkflowScheduleCron } from './workflow-schedule.cron';

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException ? e.errorCode : `OTHER:${(e as Error).message}`;
  }
}
async function messageOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}

const user = (user_id: number) => ({ kind: 'user' as const, user_id });

/** form (user 1) → <middle> → end `fin` / end `rechazo` / end `error`. */
function flow(
  key: string,
  middle: WorkflowStageDef[],
  extra: Partial<WorkflowDefinitionV1> = {},
): WorkflowDefinitionV1 {
  return {
    schema: WORKFLOW_SCHEMA_V1,
    key,
    name: `Flujo ${key}`,
    fields: [
      { key: 'monto', type: 'money', label: 'Monto' },
      { key: 'nit', type: 'text', label: 'NIT' },
      { key: 'nombre', type: 'text', label: 'Nombre' },
      { key: 'paso', type: 'text', label: 'Paso' },
      { key: 'vueltas', type: 'number', label: 'Vueltas' },
      { key: 'total_iva', type: 'money', label: 'Total con IVA', compute: 'round(monto * 1.19, 2)' },
    ],
    stages: [
      {
        key: 'inicio',
        name: 'Inicio',
        type: 'form',
        start: true,
        assignee: user(1),
        form: { fields: ['monto', 'nombre'] },
        transitions: [{ to: middle[0]?.key ?? 'fin', on: 'submit' }],
      },
      ...middle,
      { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
      { key: 'rechazo', name: 'Rechazo', type: 'end', outcome: 'rejected' },
      { key: 'error', name: 'Error', type: 'end', outcome: 'rejected' },
    ],
    ...extra,
  };
}

describe('Advanced engine (flujos-adm P2)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  const instance = (id: number) => kit.db.table('workflow_instances').find((i) => i.id === id)!;
  const events = (id: number) =>
    kit.db.table('workflow_instance_events').filter((e) => e.instance_id === id);
  const openTasks = (id: number) =>
    kit.db
      .table('workflow_tasks')
      .filter((t) => t.instance_id === id && ['open', 'claimed'].includes(t.status));

  /** Runs the engine's own outbox kinds in order (the dispatcher's job). */
  async function drain() {
    for (let i = 0; i < 50; i++) {
      const row = kit.db
        .table('workflow_outbox')
        .find(
          (r) =>
            r.status === 'pending' &&
            ['advance', 'subflow_start', 'subflow_closed'].includes(r.kind),
        );
      if (!row) return;
      row.status = 'done';
      const p = row.payload;
      if (row.kind === 'advance') {
        await kit.engine.tick(Number(p.instance_id), { expectStageEntrySeq: p.stage_entry_seq });
      } else if (row.kind === 'subflow_start') {
        await kit.engine.startSubflow({
          parentId: p.parent_id,
          stageKey: p.stage_key,
          entrySeq: p.stage_entry_seq,
          index: p.index,
        });
      } else {
        await kit.engine.subflowClosed({
          parentId: p.parent_id,
          childId: p.child_id,
          entrySeq: p.stage_entry_seq ?? null,
        });
      }
    }
  }

  async function startAndSubmit(key: string, values: Record<string, unknown> = { monto: 100 }) {
    kit.as({ user_id: 1 });
    const started = await kit.engine.start({ definitionKey: key });
    const task = openTasks(started.instance.id)[0];
    const done = await kit.engine.completeTask({
      taskId: task.id,
      outcome: 'submit',
      values,
      expectedRowVersion: started.instance.row_version,
    });
    await drain();
    return { id: started.instance.id, done };
  }

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('P2.1 parallel with join', () => {
    const parallel = (join: 'all' | 'any' | 'n_of_m', required?: number): WorkflowStageDef => ({
      key: 'alistamiento',
      name: 'Alistamiento',
      type: 'parallel',
      parallel: {
        branches: [
          { key: 'ti', name: 'TI', assignee: user(2) },
          { key: 'nomina', name: 'Nómina', assignee: user(3), form: { fields: ['nit'] } },
          { key: 'dotacion', name: 'Dotación', assignee: user(4) },
        ],
        join,
        ...(required ? { required } : {}),
      },
      transitions: [{ to: 'fin', on: 'joined' }],
    });
    const branchTask = (id: number, branch: string) =>
      openTasks(id).find((t) => t.branch_key === branch)!;
    const submitBranch = (id: number, branch: string, userId: number, values = {}) => {
      kit.as({ user_id: userId });
      return kit.engine.completeTask({
        taskId: branchTask(id, branch).id,
        outcome: 'submit',
        values,
        expectedRowVersion: 0,
      });
    };

    it('"all": the three branches are open at once and the join waits for the last one', async () => {
      seedDefinition(kit.db, flow('ingreso', [parallel('all')]));
      const { id } = await startAndSubmit('ingreso');
      expect(openTasks(id).map((t) => [t.branch_key, t.assignee_user_id, t.kind])).toEqual([
        ['ti', 2, 'form'],
        ['nomina', 3, 'form'],
        ['dotacion', 4, 'form'],
      ]);
      await submitBranch(id, 'ti', 2);
      const second = await submitBranch(id, 'nomina', 3, { nit: '900' });
      expect(second.advanced).toBe(false);
      expect(instance(id).current_stage_key).toBe('alistamiento');
      expect(instance(id).data.nit).toBe('900');
      const last = await submitBranch(id, 'dotacion', 4);
      expect(last.advanced).toBe(true);
      expect(instance(id)).toMatchObject({ current_stage_key: 'fin', status: 'completed' });
      expect(events(id).filter((e) => e.type === 'branch_completed').map((e) => e.payload.done)).toEqual([1, 2, 3]);
      expect(events(id).some((e) => e.type === 'joined')).toBe(true);
    });

    it('"any": the first branch joins and the other tasks are cancelled', async () => {
      seedDefinition(kit.db, flow('ingreso', [parallel('any')]));
      const { id } = await startAndSubmit('ingreso');
      await submitBranch(id, 'dotacion', 4);
      expect(instance(id).current_stage_key).toBe('fin');
      expect(
        kit.db.table('workflow_tasks').filter((t) => t.instance_id === id && t.branch_key && t.status === 'cancelled'),
      ).toHaveLength(2);
    });

    it('"n_of_m" (2 of 3) joins on the second branch', async () => {
      seedDefinition(kit.db, flow('ingreso', [parallel('n_of_m', 2)]));
      const { id } = await startAndSubmit('ingreso');
      expect((await submitBranch(id, 'ti', 2)).advanced).toBe(false);
      expect((await submitBranch(id, 'nomina', 3, { nit: '1' })).advanced).toBe(true);
    });

    it('only the branch assignee may submit it, and a branch submits once', async () => {
      seedDefinition(kit.db, flow('ingreso', [parallel('all')]));
      const { id } = await startAndSubmit('ingreso');
      expect(await codeOf(submitBranch(id, 'ti', 3))).toBe('WORKFLOW_TASK_FORBIDDEN');
      const task = branchTask(id, 'ti');
      await submitBranch(id, 'ti', 2);
      kit.as({ user_id: 2 });
      expect(
        await codeOf(
          kit.engine.completeTask({ taskId: task.id, outcome: 'submit', values: {}, expectedRowVersion: 0 }),
        ),
      ).toBe('WORKFLOW_TASK_CLOSED');
    });

    it('two branches finishing at the same time join exactly once', async () => {
      seedDefinition(kit.db, flow('ingreso', [parallel('n_of_m', 2)]));
      const { id } = await startAndSubmit('ingreso');
      const a = branchTask(id, 'ti');
      const b = branchTask(id, 'dotacion');
      const results = await Promise.allSettled([
        kit.runAs({ user_id: 2 }, () =>
          kit.engine.completeTask({ taskId: a.id, outcome: 'submit', values: {}, expectedRowVersion: 0 }),
        ),
        kit.runAs({ user_id: 4 }, () =>
          kit.engine.completeTask({ taskId: b.id, outcome: 'submit', values: {}, expectedRowVersion: 0 }),
        ),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      expect(events(id).filter((e) => e.type === 'joined')).toHaveLength(1);
      expect(instance(id).current_stage_key).toBe('fin');
    });
  });

  describe('P2.2 subflows', () => {
    const child = flow('alta-proveedor', [], {
      stages: [
        {
          key: 'datos',
          name: 'Datos',
          type: 'form',
          start: true,
          assignee: user(5),
          form: { fields: ['nit'] },
          transitions: [{ to: 'listo', on: 'submit' }],
        },
        { key: 'listo', name: 'Listo', type: 'end', outcome: 'completed' },
      ],
    } as Partial<WorkflowDefinitionV1>);
    const parent = (wait = true) =>
      flow('compra', [
        {
          key: 'alta',
          name: 'Alta de proveedor',
          type: 'subflow',
          subflow: {
            flows: [{ flow_key: 'alta-proveedor', map: { nombre: '{{fields.nombre}} ({{instance.reference}})' } }],
            wait,
            ...(wait ? { output: { nit: 'alta-proveedor.nit' } } : {}),
          },
          transitions: [
            { to: 'fin', on: 'completed' },
            ...(wait ? [{ to: 'rechazo', on: 'rejected' as const }] : []),
          ],
        },
      ]);

    it('starts the child with mapped values, waits, and returns the NIT to the parent', async () => {
      seedDefinition(kit.db, child);
      seedDefinition(kit.db, parent());
      const { id } = await startAndSubmit('compra', { monto: 10, nombre: 'Acme' });
      const kid = kit.db.table('workflow_instances').find((i) => i.parent_instance_id === id)!;
      expect(kid).toMatchObject({ parent_stage_key: 'alta', started_by_id: 1 });
      expect(kid.data.nombre).toBe(`Acme (${instance(id).reference})`);
      expect(events(id).find((e) => e.type === 'subflow_started')?.payload).toMatchObject({
        child_reference: kid.reference,
        flow_key: 'alta-proveedor',
      });
      expect(instance(id).current_stage_key).toBe('alta');

      kit.as({ user_id: 5 });
      await kit.engine.completeTask({
        taskId: openTasks(kid.id)[0].id,
        outcome: 'submit',
        values: { nit: '900123' },
        expectedRowVersion: kid.row_version,
      });
      await drain();
      expect(instance(kid.id).status).toBe('completed');
      expect(instance(id)).toMatchObject({ current_stage_key: 'fin', status: 'completed' });
      expect(instance(id).data.nit).toBe('900123');
      expect(events(id).find((e) => e.type === 'subflow_closed')?.payload.outcome).toBe('completed');
    });

    it('a rejected child sends the parent through "rejected"', async () => {
      seedDefinition(kit.db, child);
      seedDefinition(kit.db, parent());
      const { id } = await startAndSubmit('compra', { monto: 10, nombre: 'Acme' });
      const kid = kit.db.table('workflow_instances').find((i) => i.parent_instance_id === id)!;
      kit.as({ user_id: 1, is_owner: true });
      await kit.engine.cancel({ instanceId: kid.id, reason: 'no aplica' });
      await drain();
      expect(instance(id).current_stage_key).toBe('rechazo');
    });

    it('a child flow that is switched off cannot start: the parent records why and goes "rejected"', async () => {
      seedDefinition(kit.db, child);
      kit.db.table('workflow_definitions')[0].is_enabled = false;
      seedDefinition(kit.db, parent());
      const { id } = await startAndSubmit('compra', { monto: 10, nombre: 'Acme' });
      expect(events(id).find((e) => e.type === 'subflow_failed')?.payload.error).toContain('apagado');
      expect(instance(id).current_stage_key).toBe('rechazo');
    });

    it('a subflow that does not wait moves on at once', async () => {
      seedDefinition(kit.db, child);
      seedDefinition(kit.db, parent(false));
      const { id } = await startAndSubmit('compra', { monto: 10, nombre: 'Acme' });
      expect(instance(id).current_stage_key).toBe('fin');
      expect(kit.db.table('workflow_instances').some((i) => i.parent_instance_id === id)).toBe(true);
    });
  });

  describe('P2.3 waits', () => {
    it('sets the resume instant, does nothing before it and resumes by itself after', async () => {
      seedDefinition(
        kit.db,
        flow('espera', [
          {
            key: 'espera',
            name: 'Espera',
            type: 'wait',
            wait: { kind: 'duration', days: 3 },
            transitions: [{ to: 'fin', on: 'elapsed' }],
          },
        ]),
      );
      const before = Date.now();
      const { id } = await startAndSubmit('espera');
      const due = instance(id).stage_due_at as Date;
      expect(due.getTime() - before).toBeGreaterThanOrEqual(3 * 86_400_000 - 1000);
      expect(events(id).find((e) => e.type === 'waiting')?.payload.until).toBe(due.toISOString());
      expect((await kit.engine.tick(id, { now: new Date(due.getTime() - 60_000) })).action).toBe('noop');
      expect((await kit.engine.tick(id, { now: new Date(due.getTime() + 1000) })).action).toBe('advanced');
      expect(instance(id).current_stage_key).toBe('fin');
    });
  });

  describe('P2.4 loops', () => {
    it('laps while the condition holds and stops at the hard limit', async () => {
      seedDefinition(
        kit.db,
        flow('bucle', [
          {
            key: 'vuelta',
            name: 'Vuelta',
            type: 'loop',
            loop: { while: { all: [{ field: 'monto', op: 'gt', value: 0 }] }, max_iterations: 3 },
            transitions: [
              { to: 'paso', on: 'continue' },
              { to: 'fin', on: 'done' },
            ],
          },
          {
            key: 'paso',
            name: 'Paso',
            type: 'automatic',
            on_enter: [{ action: 'set_field', field: 'paso', value: 'x' }],
            transitions: [{ to: 'vuelta', on: 'auto' }],
          },
        ]),
      );
      const { id } = await startAndSubmit('bucle', { monto: 5 });
      expect(instance(id).status).toBe('completed');
      expect(events(id).filter((e) => e.type === 'loop_iteration').map((e) => e.payload.iteration)).toEqual([1, 2, 3]);
      expect(events(id).find((e) => e.type === 'loop_done')?.payload).toMatchObject({
        iterations: 3,
        limit_reached: true,
      });
      expect(instance(id).runtime.loops.vuelta).toBe(0);
    });
  });

  describe('P2.5 guards', () => {
    const approval = (guard: Record<string, unknown>): WorkflowStageDef => ({
      key: 'aprobacion',
      name: 'Aprobación',
      type: 'approval',
      assignee: user(2),
      guards: [
        { when: { all: [{ field: 'monto', op: 'gt', value: 5000000 }] }, message: 'Excede el presupuesto', ...guard },
      ],
      transitions: [
        { to: 'fin', on: 'approve' },
        { to: 'rechazo', on: 'reject' },
      ],
    });

    it('blocks with its message and leaves the task open', async () => {
      seedDefinition(kit.db, flow('guarda', [approval({})]));
      const { id } = await startAndSubmit('guarda', { monto: 6000000 });
      kit.as({ user_id: 2 });
      const task = openTasks(id)[0];
      const p = kit.engine.completeTask({
        taskId: task.id,
        outcome: 'approve',
        expectedRowVersion: instance(id).row_version,
      });
      expect(await messageOf(p)).toBe('Excede el presupuesto');
      expect(openTasks(id)).toHaveLength(1);
      // Rejecting is never held by a guard.
      await kit.engine.completeTask({ taskId: task.id, outcome: 'reject', expectedRowVersion: instance(id).row_version });
      expect(instance(id).current_stage_key).toBe('rechazo');
    });

    it('redirects to another stage and says so in the timeline', async () => {
      seedDefinition(kit.db, flow('guarda', [approval({ redirect_to: 'error' })]));
      const { id } = await startAndSubmit('guarda', { monto: 6000000 });
      kit.as({ user_id: 2 });
      await kit.engine.completeTask({
        taskId: openTasks(id)[0].id,
        outcome: 'approve',
        expectedRowVersion: instance(id).row_version,
      });
      expect(instance(id).current_stage_key).toBe('error');
      expect(events(id).find((e) => e.type === 'guard_redirected')?.payload.message).toBe('Excede el presupuesto');
    });

    it('a blocking guard on an automatic stage stays put and records the reason once', async () => {
      seedDefinition(
        kit.db,
        flow('guarda', [
          {
            key: 'auto',
            name: 'Auto',
            type: 'automatic',
            guards: [{ when: { all: [{ field: 'monto', op: 'gt', value: 10 }] }, message: 'Monto alto' }],
            transitions: [{ to: 'fin', on: 'auto' }],
          },
        ]),
      );
      const { id } = await startAndSubmit('guarda', { monto: 50 });
      expect(instance(id).current_stage_key).toBe('auto');
      await kit.engine.tick(id);
      expect(events(id).filter((e) => e.type === 'guard_blocked')).toHaveLength(1);
    });
  });

  describe('P2.6 hook points — every declared point runs (R2)', () => {
    const hooked = (point: 'on_enter' | 'on_submit' | 'on_complete' | 'on_exit') =>
      flow('hooks', [
        {
          key: 'revision',
          name: 'Revisión',
          type: 'approval',
          assignee: user(2),
          [point]: [{ action: 'set_field', field: 'paso', value: point }],
          transitions: [
            { to: 'fin', on: 'approve' },
            { to: 'rechazo', on: 'reject' },
          ],
        } as WorkflowStageDef,
      ]);
    async function run(point: 'on_enter' | 'on_submit' | 'on_complete' | 'on_exit', outcome = 'approve') {
      seedDefinition(kit.db, hooked(point));
      const { id } = await startAndSubmit('hooks');
      const afterEnter = instance(id).data.paso;
      kit.as({ user_id: 2 });
      await kit.engine.completeTask({
        taskId: openTasks(id)[0].id,
        outcome,
        expectedRowVersion: instance(id).row_version,
      });
      return { afterEnter, final: instance(id).data.paso };
    }

    it('on_enter runs when the request enters the stage', async () => {
      expect((await run('on_enter')).afterEnter).toBe('on_enter');
    });
    it('on_submit runs when a person submits (approve)', async () => {
      expect(await run('on_submit')).toEqual({ afterEnter: undefined, final: 'on_submit' });
    });
    it('on_submit does not run on reject', async () => {
      expect((await run('on_submit', 'reject')).final).toBeUndefined();
    });
    it('on_complete runs whatever the outcome', async () => {
      expect((await run('on_complete', 'reject')).final).toBe('on_complete');
    });
    it('on_exit runs when the request leaves the stage', async () => {
      expect((await run('on_exit')).final).toBe('on_exit');
    });
    it('they run in order on_submit → on_complete → on_exit (the last write wins)', async () => {
      const def = hooked('on_submit');
      const stage = def.stages[1];
      stage.on_complete = [{ action: 'set_field', field: 'paso', value: 'on_complete' }];
      stage.on_exit = [{ action: 'set_field', field: 'paso', value: 'on_exit' }];
      seedDefinition(kit.db, def);
      const { id } = await startAndSubmit('hooks');
      kit.as({ user_id: 2 });
      await kit.engine.completeTask({
        taskId: openTasks(id)[0].id,
        outcome: 'approve',
        expectedRowVersion: instance(id).row_version,
      });
      expect(instance(id).data.paso).toBe('on_exit');
    });
  });

  describe('P2.7 error policy and dead-letter', () => {
    const withAction = (on_error: Record<string, unknown>) =>
      flow('accion', [
        {
          key: 'espera',
          name: 'Revisión',
          type: 'approval',
          assignee: user(2),
          on_enter: [
            { action: 'vendix.crm_task.create', map: { title: 'x' }, on_error } as never,
          ],
          transitions: [
            { to: 'fin', on: 'approve' },
            { to: 'rechazo', on: 'reject' },
          ],
        },
      ]);
    const actionRow = (id: number) =>
      kit.db.table('workflow_outbox').find((r) => r.kind === 'action' && r.instance_id === id)!;

    it('the outbox row carries the retries asked for and the policy', async () => {
      seedDefinition(kit.db, withAction({ retries: 2, then: 'route', route_to: 'error' }));
      const { id } = await startAndSubmit('accion');
      expect(actionRow(id).payload).toMatchObject({
        max_attempts: 3,
        on_error: { retries: 2, then: 'route', route_to: 'error' },
      });
    });

    it('"route": alerts the owner and moves the request to the error stage', async () => {
      seedDefinition(kit.db, withAction({ then: 'route', route_to: 'error' }));
      const { id } = await startAndSubmit('accion');
      const row = actionRow(id);
      await kit.engine.onActionDead({ id: row.id, instance_id: id, payload: row.payload }, 'Sin permiso');
      expect(instance(id).current_stage_key).toBe('error');
      expect(events(id).find((e) => e.type === 'error_routed')?.payload).toMatchObject({ to: 'error' });
      const alert = kit.db
        .table('workflow_outbox')
        .find((r) => r.kind === 'notify' && Array.isArray(r.payload.user_ids));
      expect(alert?.payload.user_ids).toEqual([1]);
      expect(alert?.payload.message).toContain('Acción fallida');
    });

    it('"fail" ends the request as failed; "continue" only alerts', async () => {
      seedDefinition(kit.db, withAction({ then: 'fail' }));
      const failed = await startAndSubmit('accion');
      const row = actionRow(failed.id);
      await kit.engine.onActionDead({ id: row.id, instance_id: failed.id, payload: row.payload }, 'x');
      expect(instance(failed.id).status).toBe('failed');

      kit.db.table('workflow_versions')[0].definition = withAction({ then: 'continue' });
      const kept = await startAndSubmit('accion');
      const row2 = actionRow(kept.id);
      await kit.engine.onActionDead({ id: row2.id, instance_id: kept.id, payload: row2.payload }, 'x');
      expect(instance(kept.id)).toMatchObject({ status: 'active', current_stage_key: 'espera' });
    });

    it('a dead action can be retried by hand once; anything else is refused', async () => {
      seedDefinition(kit.db, withAction({}));
      const { id } = await startAndSubmit('accion');
      const row = actionRow(id);
      Object.assign(row, { status: 'dead', attempts: 6, last_error: 'boom' });
      row.payload = { ...row.payload, effect_started_at: 'x' };
      kit.as({ user_id: 1, is_owner: true, permissions: ['store:workflows:manage'] });
      expect(await kit.instances.retryFailedAction(id, row.id)).toEqual({ retried: true });
      expect(row).toMatchObject({ status: 'pending', attempts: 0, last_error: null });
      expect(row.payload.effect_started_at).toBeUndefined();
      expect(events(id).some((e) => e.type === 'action_retried')).toBe(true);
      expect(await codeOf(kit.instances.retryFailedAction(id, row.id))).toBe(
        'WORKFLOW_ACTION_NOT_RETRYABLE',
      );
    });

    it('the request detail lists its dead actions', async () => {
      seedDefinition(kit.db, withAction({}));
      const { id } = await startAndSubmit('accion');
      Object.assign(actionRow(id), { status: 'dead', last_error: 'Sin permiso' });
      kit.as({ user_id: 1, is_owner: true });
      const detail = await kit.instances.get(id);
      expect(detail.failed_actions).toEqual([
        expect.objectContaining({ action: 'vendix.crm_task.create', error: 'Sin permiso' }),
      ]);
    });
  });

  describe('P2.8 migrating live requests between versions', () => {
    it('previews per stage and moves them to v2 keeping the history', async () => {
      const v1 = flow('mig', [
        {
          key: 'revision',
          name: 'Revisión',
          type: 'approval',
          assignee: user(2),
          transitions: [
            { to: 'fin', on: 'approve' },
            { to: 'rechazo', on: 'reject' },
          ],
        },
      ]);
      const { definitionId, versionId } = seedDefinition(kit.db, v1);
      const { id } = await startAndSubmit('mig');
      const historyBefore = events(id).length;
      const v2 = flow('mig', [
        {
          key: 'aprobacion',
          name: 'Aprobación',
          type: 'approval',
          assignee: user(3),
          transitions: [
            { to: 'fin', on: 'approve' },
            { to: 'rechazo', on: 'reject' },
          ],
        },
      ]);
      const v2row = kit.db.insert('workflow_versions', {
        store_id: 1,
        definition_id: definitionId,
        version: 2,
        schema_version: WORKFLOW_SCHEMA_V1,
        definition: v2,
        definition_hash: 'y'.repeat(64),
        published_by_user_id: 1,
      });
      kit.db.table('workflow_definitions')[0].published_version_id = v2row.id;
      const svc = new WorkflowMigrationService(kit.prisma, kit.stages, kit.events);
      kit.as({ user_id: 1, is_owner: true });

      const blocked = await svc.preview(definitionId, { from_version_id: versionId });
      expect(blocked.ready).toBe(false);
      expect(blocked.stages[0]).toMatchObject({ from_stage_key: 'revision', count: 1, ok: false });

      const plan = { from_version_id: versionId, stage_map: { revision: 'aprobacion' } };
      const preview = await svc.preview(definitionId, plan);
      expect(preview).toMatchObject({
        total: 1,
        ready: true,
        from_version: { version: 1 },
        to_version: { version: 2 },
      });
      expect(await svc.migrate(definitionId, plan)).toEqual({ migrated: 1, failed: [] });
      expect(instance(id)).toMatchObject({ version_id: v2row.id, current_stage_key: 'aprobacion' });
      expect(events(id)).toHaveLength(historyBefore + 1);
      expect(events(id).at(-1)?.payload).toMatchObject({ from_version: 1, to_version: 2 });
      expect(openTasks(id).map((t) => t.assignee_user_id)).toEqual([3]);
    });
  });

  describe('P2.9 calculated fields', () => {
    it('"Total con IVA" is computed by the server and a sent value is ignored', async () => {
      const def = flow('iva', []);
      def.stages[0].form = { fields: ['monto', 'total_iva'] };
      seedDefinition(kit.db, def);
      const { id } = await startAndSubmit('iva', { monto: 1000, total_iva: 1 });
      expect(instance(id).data).toMatchObject({ monto: 1000, total_iva: 1190 });
    });
  });

  describe('P2.10 schedule trigger', () => {
    const scheduled = () => {
      const def = flow('caja', [], { triggers: [{ kind: 'schedule', cron: '0 8 * * 1' }] });
      def.stages[0].assignee = user(2);
      return def;
    };

    it('one fire starts one request, even if replayed', async () => {
      seedDefinition(kit.db, scheduled());
      const fire = { definitionId: 1, cron: '0 8 * * 1', fireAt: '2026-11-09T13:00' };
      const a = await kit.engine.startScheduled(fire);
      const b = await kit.engine.startScheduled(fire);
      expect(a?.instance.id).toBe(b?.instance.id);
      expect(b?.replayed).toBe(true);
      expect(kit.db.table('workflow_instances')).toHaveLength(1);
      expect(events(a!.instance.id)[0].payload).toMatchObject({ via: 'schedule' });
    });

    it('the cron starts Monday 08:00 in the store time zone and not at other minutes', async () => {
      const engine = { startScheduled: jest.fn(async () => ({ replayed: false })) };
      const prisma = {
        $queryRaw: jest.fn(async () => [
          { id: 9, store_id: 1, organization_id: 1, timezone: 'America/Bogota', triggers: [{ kind: 'schedule', cron: '0 8 * * 1' }] },
        ]),
        withoutScope: () => kit.prisma.withoutScope(),
      };
      const cron = new WorkflowScheduleCron(prisma as never, engine as never);
      // 2026-11-09 is a Monday; 08:02 Bogotá = 13:02 UTC (inside the 5-minute look-back).
      expect(await cron.runOnce(new Date('2026-11-09T13:02:30Z'))).toBe(1);
      expect(engine.startScheduled).toHaveBeenCalledWith({
        definitionId: 9,
        cron: '0 8 * * 1',
        fireAt: '2026-11-09T13:00',
      });
      engine.startScheduled.mockClear();
      expect(await cron.runOnce(new Date('2026-11-09T15:00:00Z'))).toBe(0);
      expect(engine.startScheduled).not.toHaveBeenCalled();
      // Published (or switched on) at 08:01: the 08:00 fire inside the look-back is skipped.
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: 9, store_id: 1, organization_id: 1, timezone: 'America/Bogota', since: new Date('2026-11-09T13:01:10Z'), triggers: [{ kind: 'schedule', cron: '0 8 * * 1' }] },
      ] as never);
      expect(await cron.runOnce(new Date('2026-11-09T13:02:30Z'))).toBe(0);
    });
  });

  describe('P2.11 on/off switch', () => {
    it('a switched-off flow starts nothing new, but live requests keep moving', async () => {
      seedDefinition(
        kit.db,
        flow('switch', [
          {
            key: 'revision',
            name: 'Revisión',
            type: 'approval',
            assignee: user(2),
            transitions: [
              { to: 'fin', on: 'approve' },
              { to: 'rechazo', on: 'reject' },
            ],
          },
        ]),
      );
      const { id } = await startAndSubmit('switch');
      kit.db.table('workflow_definitions')[0].is_enabled = false;
      kit.as({ user_id: 1 });
      expect(await codeOf(kit.engine.start({ definitionKey: 'switch' }))).toBe('WORKFLOW_DISABLED');
      expect(await kit.engine.startScheduled({ definitionId: 1, cron: '* * * * *', fireAt: 'x' })).toBeNull();
      kit.as({ user_id: 2 });
      await kit.engine.completeTask({
        taskId: openTasks(id)[0].id,
        outcome: 'approve',
        expectedRowVersion: instance(id).row_version,
      });
      expect(instance(id).status).toBe('completed');
    });
  });
});
