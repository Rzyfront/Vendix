import { ErrorCodes, VendixHttpException } from '@common/errors';
import { buildAuditedWorkflowKit } from '../audit/workflow-audit.testkit';
import { purchaseDefinition, seedDefinition, seedPeople } from '../../../../testing/workflows/workflow-test-kit';

describe('Cancel and forced moves are audited (P7.2)', () => {
  let ctx: ReturnType<typeof buildAuditedWorkflowKit>;
  const instance = () => ctx.kit.db.table('workflow_instances')[0];

  async function start() {
    const started = await ctx.kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'a' });
    return started.instance;
  }

  beforeEach(() => {
    ctx = buildAuditedWorkflowKit();
    seedPeople(ctx.kit.db);
    seedDefinition(ctx.kit.db, purchaseDefinition());
  });
  afterEach(() => jest.restoreAllMocks());

  it('cancel writes decision.instance_cancelled with the reason', async () => {
    const created = await start();
    await ctx.kit.engine.cancel({ instanceId: created.id, reason: 'duplicada' });

    expect(ctx.rows()).toHaveLength(1);
    expect(ctx.rows()[0]).toMatchObject({
      action: 'decision.instance_cancelled',
      category: 'decision',
      actor_id: 1,
      target_type: 'instance',
      target_id: String(created.id),
      instance_id: created.id,
      definition_id: created.definition_id,
      summary: 'Canceló la solicitud FLU-000001',
    });
    expect(ctx.rows()[0].details).toEqual({
      reason: 'duplicada',
      stage_key: 'request',
      instance_reference: 'FLU-000001',
    });
    expect(instance().status).toBe('cancelled');
  });

  it('force transition writes decision.instance_forced with from, to and reason', async () => {
    const created = await start();
    await ctx.kit.engine.transition({ instanceId: created.id, to: 'manager', reason: 'corrección' });

    expect(ctx.rows()).toHaveLength(1);
    expect(ctx.rows()[0]).toMatchObject({
      action: 'decision.instance_forced',
      actor_id: 1,
      instance_id: created.id,
      summary: 'Movió la solicitud FLU-000001 de «Solicitud» a «Aprobación del gerente» a la fuerza',
    });
    expect(ctx.rows()[0].details).toEqual({
      from_stage_key: 'request',
      to_stage_key: 'manager',
      reason: 'corrección',
      instance_reference: 'FLU-000001',
    });
  });

  it('never logs an automatic transition as forced', async () => {
    await start();
    const task = ctx.kit.db.table('workflow_tasks')[0];
    // submit with a small amount moves the request to `done` by itself.
    await ctx.kit.engine.completeTask({
      taskId: task.id,
      outcome: 'submit',
      values: { amount: 10, reason: 'x' },
      expectedRowVersion: 0,
    });
    expect(instance().status).toBe('completed');
    expect(ctx.rows().map((r) => r.action)).toEqual(['decision.task_completed']);
  });

  it('rolls cancel and force back when the audit row cannot be written', async () => {
    const created = await start();
    jest.spyOn(ctx.audit, 'append').mockRejectedValue(new VendixHttpException(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE));

    await expect(ctx.kit.engine.cancel({ instanceId: created.id, reason: 'x' })).rejects.toMatchObject({
      errorCode: ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE.code,
    });
    await expect(
      ctx.kit.engine.transition({ instanceId: created.id, to: 'manager', reason: 'x' }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE.code });

    expect(instance()).toMatchObject({ status: 'active', current_stage_key: 'request', row_version: 0 });
    expect(ctx.rows()).toHaveLength(0);
  });

  it('writes nothing when the command is refused (closed request, foreign request)', async () => {
    const created = await start();
    await ctx.kit.engine.cancel({ instanceId: created.id, reason: 'x' });
    const before = ctx.rows().length;

    await expect(ctx.kit.engine.cancel({ instanceId: created.id, reason: 'otra vez' })).rejects.toMatchObject({
      errorCode: 'WORKFLOW_INSTANCE_CLOSED',
    });
    await expect(
      ctx.kit.engine.transition({ instanceId: created.id, to: 'done', reason: 'x' }),
    ).rejects.toMatchObject({ errorCode: 'WORKFLOW_INSTANCE_CLOSED' });

    ctx.kit.as({ store_id: 2, user_id: 7 });
    await expect(ctx.kit.engine.cancel({ instanceId: created.id, reason: 'x' })).rejects.toMatchObject({
      errorCode: 'WORKFLOW_NOT_FOUND',
    });
    expect(ctx.rows()).toHaveLength(before);
  });
});
