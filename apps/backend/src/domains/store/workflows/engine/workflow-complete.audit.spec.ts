import { ErrorCodes, VendixHttpException } from '@common/errors';
import { buildAuditedWorkflowKit } from '../audit/workflow-audit.testkit';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
  seedWorkGroup,
} from '../../../../testing/workflows/workflow-test-kit';

describe('Decisions are audited in the decision transaction (P7.2)', () => {
  let ctx: ReturnType<typeof buildAuditedWorkflowKit>;

  const tasks = (status: string) => ctx.kit.db.table('workflow_tasks').filter((t) => t.status === status);
  const instance = () => ctx.kit.db.table('workflow_instances')[0];

  async function startAt(amount: number) {
    const started = await ctx.kit.engine.start({ definitionKey: 'purchase', idempotencyKey: `s-${amount}` });
    const first = tasks('open')[0];
    await ctx.kit.engine.completeTask({
      taskId: first.id,
      outcome: 'submit',
      values: { amount, reason: 'x' },
      expectedRowVersion: 0,
    });
    return started.instance;
  }

  beforeEach(() => {
    ctx = buildAuditedWorkflowKit();
    seedPeople(ctx.kit.db);
    seedWorkGroup(ctx.kit.db, 'board', [4, 5, 6]);
    seedDefinition(ctx.kit.db, purchaseDefinition());
  });
  afterEach(() => jest.restoreAllMocks());

  it('writes decision.task_completed with outcome, stage, task and request reference', async () => {
    await startAt(5000);
    const manager = tasks('open')[0];
    ctx.kit.as({ user_id: 2 });

    await ctx.kit.engine.completeTask({
      taskId: manager.id,
      outcome: 'approve',
      comment: 'Todo en orden',
      expectedRowVersion: instance().row_version,
    });

    const decision = ctx.rows().filter((r) => r.action === 'decision.task_completed');
    expect(decision).toHaveLength(2);
    expect(decision[1]).toMatchObject({
      store_id: 1,
      category: 'decision',
      actor_type: 'user',
      actor_id: 2,
      target_type: 'task',
      target_id: String(manager.id),
      instance_id: instance().id,
      definition_id: instance().definition_id,
      summary: 'Aprobó en la etapa «Aprobación del gerente» de la solicitud FLU-000001',
    });
    expect(decision[1].details).toEqual({
      outcome: 'approve',
      stage_key: 'manager',
      stage_name: 'Aprobación del gerente',
      task_id: manager.id,
      instance_reference: 'FLU-000001',
      has_comment: true,
      to_stage_key: 'done',
    });
    expect(JSON.stringify(decision[1].details)).not.toContain('Todo en orden');
    await expect(ctx.audit.verify()).resolves.toMatchObject({ valid: true });
  });

  it('writes decision.task_voted for a vote that does not close the stage, then task_completed on the last', async () => {
    await startAt(50000);
    const board = tasks('open')[0];
    ctx.kit.as({ user_id: 4 });
    await ctx.kit.engine.completeTask({ taskId: board.id, outcome: 'approve', expectedRowVersion: 0, idempotencyKey: 'v1' });
    expect(ctx.rows().map((r) => r.action)).toEqual(['decision.task_completed', 'decision.task_voted']);
    expect(ctx.rows()[1]).toMatchObject({ actor_id: 4, summary: 'Votó a favor en la etapa «Junta» de la solicitud FLU-000001' });
    expect(ctx.rows()[1].details).toMatchObject({ approvals: 1, required: 2, has_comment: false });

    ctx.kit.as({ user_id: 5 });
    await ctx.kit.engine.completeTask({ taskId: board.id, outcome: 'approve', expectedRowVersion: 0, idempotencyKey: 'v2' });
    expect(ctx.rows().map((r) => r.action)).toEqual([
      'decision.task_completed',
      'decision.task_voted',
      'decision.task_completed',
    ]);
    expect(ctx.rows()[2]).toMatchObject({ actor_id: 5 });
    expect(ctx.rows()[2].details).toMatchObject({ outcome: 'approve', quorum_required: 2 });
  });

  it('rolls the decision back when its audit row cannot be written (nothing is decided unaudited)', async () => {
    await startAt(5000);
    const manager = tasks('open')[0];
    const before = ctx.rows().length;
    ctx.kit.as({ user_id: 2 });
    jest.spyOn(ctx.audit, 'append').mockRejectedValue(new VendixHttpException(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE));

    await expect(
      ctx.kit.engine.completeTask({ taskId: manager.id, outcome: 'approve', expectedRowVersion: instance().row_version }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE.code });

    expect(instance()).toMatchObject({ status: 'active', current_stage_key: 'manager' });
    expect(tasks('open').map((t) => t.id)).toEqual([manager.id]);
    expect(ctx.rows()).toHaveLength(before);
  });

  it('writes nothing for a decision that is refused or replayed', async () => {
    await startAt(5000);
    const manager = tasks('open')[0];
    const before = ctx.rows().length;
    ctx.kit.as({ user_id: 2 });

    await expect(
      ctx.kit.engine.completeTask({ taskId: manager.id, outcome: 'approve', expectedRowVersion: 99 }),
    ).rejects.toMatchObject({ errorCode: 'WORKFLOW_STALE' });
    expect(ctx.rows()).toHaveLength(before);

    const input = { taskId: manager.id, outcome: 'approve', expectedRowVersion: instance().row_version, idempotencyKey: 'once' };
    await ctx.kit.engine.completeTask(input);
    await ctx.kit.engine.completeTask(input);
    expect(ctx.rows().filter((r) => r.target_id === String(manager.id))).toHaveLength(1);
  });

  it('audits decisions through the shared kit too: the audit trail is required, never optional', async () => {
    const plain = buildWorkflowKit();
    seedPeople(plain.db);
    seedDefinition(plain.db, purchaseDefinition());
    await plain.engine.start({ definitionKey: 'purchase', idempotencyKey: 'plain' });
    const task = plain.db.table('workflow_tasks')[0];
    const done = await plain.engine.completeTask({
      taskId: task.id,
      outcome: 'submit',
      values: { amount: 0, reason: 'x' },
      expectedRowVersion: 0,
    });
    expect(done.instance.status).toBe('completed');
    expect(plain.db.table('workflow_audit_log').map((r) => r.action)).toContain('decision.task_completed');
  });
});
