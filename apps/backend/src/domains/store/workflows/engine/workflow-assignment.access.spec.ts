import { VendixHttpException } from '@common/errors';
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

/** Stage `manager` (approval, role `manager`): u2 and u3 hold the role. */
describe('stage act permissions (P7.3)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let defId: number;
  let task: any;
  let instance: any;

  const as = (user_id: number, extra: Parameters<typeof kit.as>[0] = {}) =>
    kit.as({ user_id, is_owner: false, is_super_admin: false, permissions: ['store:workflows:task'], ...extra });
  const restrict = (access: unknown) =>
    Object.assign(kit.db.table('workflow_definitions').find((d) => d.id === defId)!, { access });
  const approve = () =>
    kit.engine.completeTask({
      taskId: task.id,
      outcome: 'approve',
      expectedRowVersion: kit.db.table('workflow_instances').find((i) => i.id === instance.id)!.row_version,
      idempotencyKey: `a-${Math.random()}`,
    });
  const canAct = (userId: number) =>
    kit.assignment.canAct(kit.prisma, task, userId, 1, 1);

  beforeEach(async () => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedWorkGroup(kit.db, 'board', [4, 5]);
    for (const [id, first] of [[2, 'Ana'], [3, 'Beto']] as const) {
      kit.db.insert('users', { id, first_name: first, last_name: 'Pérez' });
    }
    defId = seedDefinition(kit.db, purchaseDefinition()).definitionId;
    as(6);
    const s = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 's1' });
    const form = kit.db.table('workflow_tasks').find((t) => t.instance_id === s.instance.id && t.status === 'open')!;
    await kit.engine.completeTask({
      taskId: form.id, outcome: 'submit', values: { amount: 5000 },
      expectedRowVersion: s.instance.row_version, idempotencyKey: 'f1',
    });
    instance = s.instance;
    task = kit.db.table('workflow_tasks').find((t) => t.instance_id === s.instance.id && t.stage_key === 'manager' && t.status === 'open')!;
  });
  afterEach(() => jest.restoreAllMocks());

  it('without access the role holders act as before', async () => {
    as(2);
    expect(await canAct(2)).toBe(true);
    expect(await canAct(6)).toBe(false);
    await expect(approve()).resolves.toBeDefined();
  });

  it('a stage `act` list stops the other holders of the role, naming who can decide', async () => {
    restrict({ stages: { manager: { act: { roles: [], user_ids: [3] } } } });
    as(2);
    const err = await fail(approve());
    expect(err?.errorCode).toBe('WORKFLOW_STAGE_ACT_FORBIDDEN');
    expect(err?.getStatus()).toBe(403);
    expect(err?.message).toBe('Esta etapa solo la pueden decidir: Beto Pérez');
    expect(kit.db.table('workflow_tasks').find((t) => t.id === task.id)!.status).toBe('open');
  });

  it('the person in `act` completes it', async () => {
    restrict({ stages: { manager: { act: { roles: [], user_ids: [3] } } } });
    as(3);
    await expect(approve()).resolves.toBeDefined();
    expect(kit.db.table('workflow_tasks').find((t) => t.id === task.id)!.status).toBe('done');
  });

  it('a role in `act` lets its holders in and the message lists roles before people', async () => {
    restrict({ stages: { manager: { act: { roles: ['owner'], user_ids: [3] } } } });
    as(2);
    expect((await fail(approve()))?.message).toBe('Esta etapa solo la pueden decidir: owner, Beto Pérez');
    restrict({ stages: { manager: { act: { roles: ['manager'], user_ids: [] } } } });
    expect(await canAct(2)).toBe(true);
  });

  it('claiming a restricted task gives the same refusal', async () => {
    restrict({ stages: { manager: { act: { roles: [], user_ids: [3] } } } });
    as(2);
    expect((await fail(kit.engine.claimTask(task.id)))?.errorCode).toBe('WORKFLOW_STAGE_ACT_FORBIDDEN');
  });

  it('a restriction on another stage does not affect this one', async () => {
    restrict({ stages: { board: { act: { roles: [], user_ids: [3] } } } });
    as(2);
    expect(await canAct(2)).toBe(true);
  });

  it.each([
    ['owner', { is_owner: true }],
    ['superadmin', { is_super_admin: true }],
    ['holder of manage', { permissions: ['store:workflows:task', 'store:workflows:manage'] }],
  ])('%s passes the stage restriction', async (_n, extra) => {
    restrict({ stages: { manager: { act: { roles: [], user_ids: [3] } } } });
    as(2, extra as any);
    expect(await canAct(2)).toBe(true);
  });

  it('someone who is not assigned keeps getting false, not the stage message', async () => {
    restrict({ stages: { manager: { act: { roles: [], user_ids: [3] } } } });
    as(6);
    expect(await canAct(6)).toBe(false);
  });

  it('canActQuietly reports the same decision without throwing', async () => {
    restrict({ stages: { manager: { act: { roles: [], user_ids: [3] } } } });
    as(2);
    expect(await kit.assignment.canActQuietly(kit.prisma, task, 2, 1, 1)).toBe(false);
    expect(await kit.assignment.canActQuietly(kit.prisma, task, 3, 1, 1)).toBe(true);
    expect(await kit.assignment.canActQuietly(kit.prisma, task, 6, 1, 1)).toBe(false);
  });

  it('the request detail shows can_act false (no error) to a holder who may not decide', async () => {
    restrict({ stages: { manager: { act: { roles: [], user_ids: [3] } } } });
    as(2, { permissions: ['store:workflows:read'] });
    kit.db.table('workflow_tasks').find((t) => t.id === task.id)!.assignee_user_id = null;
    const detail: any = await kit.instances.get(instance.id);
    const t = detail.tasks.find((x: any) => x.id === task.id);
    expect(t.can_act).toBe(false);
    as(3, { permissions: ['store:workflows:read'] });
    const own: any = await kit.instances.get(instance.id);
    expect(own.tasks.find((x: any) => x.id === task.id).can_act).toBe(true);
  });
});
