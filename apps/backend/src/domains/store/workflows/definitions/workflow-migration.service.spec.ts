import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowAuditService } from '../audit/workflow-audit.service';
import { WorkflowMigrationService } from './workflow-migration.service';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
  seedWorkGroup,
} from '../../../../testing/workflows/workflow-test-kit';

async function fail(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e as VendixHttpException;
  }
}

/** A live request sits in stage `manager` of v1; v2 is published with the same stages. */
describe('WorkflowMigrationService permissions and audit (P7.2, P7.3)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let svc: WorkflowMigrationService;
  let defId: number;
  let plan: { from_version_id: number; stage_map: Record<string, string> };
  let instanceId: number;

  const as = (user_id: number, extra: Parameters<typeof kit.as>[0] = {}) =>
    kit.as({ user_id, is_owner: false, is_super_admin: false, permissions: ['store:workflows:design'], ...extra });
  const flow = () => kit.db.table('workflow_definitions').find((d) => d.id === defId)!;
  // Only the definition rows: the setup's own decisions are audited too.
  const audit = () => kit.db.table('workflow_audit_log').filter((r) => r.category === 'definition');

  beforeEach(async () => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedWorkGroup(kit.db, 'board', [4, 5]);
    const seeded = seedDefinition(kit.db, purchaseDefinition());
    defId = seeded.definitionId;
    as(6, { permissions: ['store:workflows:task'] });
    const s = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 's' });
    const form = kit.db.table('workflow_tasks').find((t) => t.instance_id === s.instance.id && t.status === 'open')!;
    await kit.engine.completeTask({
      taskId: form.id, outcome: 'submit', values: { amount: 5000 },
      expectedRowVersion: s.instance.row_version, idempotencyKey: 'f',
    });
    instanceId = s.instance.id;
    const v2 = kit.db.insert('workflow_versions', {
      store_id: 1,
      definition_id: defId,
      version: 2,
      schema_version: 'vendix.workflow/v1',
      definition: purchaseDefinition(),
      definition_hash: 'y'.repeat(64),
      published_by_user_id: 1,
    });
    flow().published_version_id = v2.id;
    plan = { from_version_id: seeded.versionId, stage_map: { manager: 'manager' } };
    svc = new WorkflowMigrationService(kit.prisma, kit.stages, kit.events);
  });
  afterEach(() => jest.restoreAllMocks());

  it('audits the intent before moving and the outcome after, with the counts and the stage map', async () => {
    as(2);
    expect(await svc.migrate(defId, plan)).toEqual({ migrated: 1, failed: [] });
    expect(audit()).toHaveLength(2);
    expect(audit()[0]).toMatchObject({
      action: 'definition.instances_migrated',
      category: 'definition',
      definition_id: defId,
      actor_id: 2,
      summary: 'Inició la migración de 1 solicitud de «Compra» de v1 a v2',
    });
    expect(audit()[0].details).toMatchObject({ phase: 'started', planned: 1, stage_map: { manager: 'manager' } });
    expect(audit()[1]).toMatchObject({
      action: 'definition.instances_migrated',
      actor_id: 2,
      summary: 'Migró 1 solicitud de «Compra» de v1 a v2',
    });
    expect(audit()[1].details).toMatchObject({
      phase: 'finished',
      migrated: 1,
      failed: 0,
      stage_map: { manager: 'manager' },
    });
  });

  it('when the intent cannot be audited, nothing moves and the answer says so', async () => {
    as(2);
    jest
      .spyOn(WorkflowAuditService.prototype, 'recordNow')
      .mockRejectedValueOnce(new VendixHttpException(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE));
    expect((await fail(svc.migrate(defId, plan)))?.errorCode).toBe('WORKFLOW_AUDIT_UNAVAILABLE');
    expect(kit.db.table('workflow_instances').find((i) => i.id === instanceId)!.version_id).toBe(plan.from_version_id);
  });

  it('when only the outcome cannot be audited, the moved requests are still reported as moved', async () => {
    as(2);
    const original = WorkflowAuditService.prototype.recordNow;
    jest
      .spyOn(WorkflowAuditService.prototype, 'recordNow')
      .mockImplementationOnce(function (this: WorkflowAuditService, input) {
        return original.call(this, input);
      })
      .mockRejectedValueOnce(new VendixHttpException(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE));
    expect(await svc.migrate(defId, plan)).toEqual({ migrated: 1, failed: [] });
    expect(kit.db.table('workflow_instances').find((i) => i.id === instanceId)!.version_id).not.toBe(
      plan.from_version_id,
    );
    expect(audit()).toHaveLength(1);
    expect(audit()[0].details).toMatchObject({ phase: 'started', planned: 1 });
  });

  it('a preview changes nothing and leaves no audit row', async () => {
    as(2);
    expect((await svc.preview(defId, plan)).total).toBe(1);
    expect(audit()).toHaveLength(0);
  });

  it.each([
    ['preview', () => svc.preview(defId, plan)],
    ['migrate', () => svc.migrate(defId, plan)],
  ])('%s by someone outside `design` is WORKFLOW_DESIGN_FORBIDDEN and moves nothing', async (_n, run) => {
    flow().access = { design: { roles: ['manager'], user_ids: [] } };
    as(6);
    const err = await fail(run());
    expect(err?.errorCode).toBe('WORKFLOW_DESIGN_FORBIDDEN');
    expect(audit()).toHaveLength(0);
    expect(kit.db.table('workflow_instances').find((i) => i.id === instanceId)!.version_id).toBe(plan.from_version_id);
  });

  it('a member of `design` migrates', async () => {
    flow().access = { design: { roles: ['manager'], user_ids: [] } };
    as(3);
    expect((await svc.migrate(defId, plan)).migrated).toBe(1);
  });

  it('a flow the caller cannot see is 404', async () => {
    flow().access = { view: { roles: ['manager'], user_ids: [] } };
    as(6);
    expect((await fail(svc.migrate(defId, plan)))?.errorCode).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
  });
});
