import { VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { buildLimits } from '../limits/workflow-limits.testkit';
import { workflowPeriod } from '../limits/workflow-limits.service';

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException
      ? { code: e.errorCode, details: (e.getResponse() as any)?.details ?? (e as any).details }
      : { code: `OTHER:${(e as Error).message}` };
  }
};

function definition(triggers: any[], key = 'limite') {
  const def = purchaseDefinition({
    key,
    name: 'Solicitud',
    subject: { type: 'order' },
    triggers,
  } as Partial<WorkflowDefinitionV1>) as WorkflowDefinitionV1;
  def.stages[0].assignee = { kind: 'role', role_key: 'manager' } as any;
  return def;
}

describe('P7.1 start enforcement of the monthly instances limit', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let limits: ReturnType<typeof buildLimits>;
  const instances = () => kit.db.table('workflow_instances');
  const counter = () =>
    kit.db
      .table('workflow_usage_counters')
      .find((r: any) => r.metric === 'monthly_instances' && r.period === workflowPeriod(new Date()));

  function wire(cap: number | null) {
    limits = buildLimits(kit.db, { limits: { monthly_instances: cap } });
    (kit.engine as any).starter.limits = limits.service;
  }

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
  });
  afterEach(() => jest.restoreAllMocks());

  it('a person is refused past the cap with the plan details and no instance is created', async () => {
    wire(1);
    seedDefinition(kit.db, definition([{ kind: 'manual' }]));
    await kit.engine.start({ definitionKey: 'limite', idempotencyKey: 'a' });
    const r = await failure(kit.engine.start({ definitionKey: 'limite', idempotencyKey: 'b' }));
    expect(r?.code).toBe('WORKFLOW_PLAN_LIMIT_REACHED');
    expect(r?.details).toMatchObject({ limit: 'monthly_instances', used: 1, cap: 1 });
    expect(instances()).toHaveLength(1);
    expect(counter()?.count).toBe(1);
  });

  it('a replay of an accepted start never consumes the limit again', async () => {
    wire(1);
    seedDefinition(kit.db, definition([{ kind: 'manual' }]));
    const first = await kit.engine.start({ definitionKey: 'limite', idempotencyKey: 'same' });
    const again = await kit.engine.start({ definitionKey: 'limite', idempotencyKey: 'same' });
    expect(again.instance.id).toBe(first.instance.id);
    expect(counter()?.count).toBe(1);
  });

  it('a system start past the cap throws and the owner is warned once', async () => {
    wire(1);
    const { definitionId } = seedDefinition(
      kit.db,
      definition([{ kind: 'event', event: 'order.created', map: {} }]),
    );
    kit.as({ user_id: undefined });
    const input = (k: string) => ({
      definitionId,
      event: 'order.created',
      eventContext: { order_id: 9, order_number: 'ORD-9', grand_total: 10, currency: 'COP', channel: 'pos' },
      idempotencyKey: k,
    });
    await kit.engine.startSystem(input('k1'));
    expect((await failure(kit.engine.startSystem(input('k2'))))?.code).toBe('WORKFLOW_PLAN_LIMIT_REACHED');
    expect((await failure(kit.engine.startSystem(input('k3'))))?.code).toBe('WORKFLOW_PLAN_LIMIT_REACHED');
    expect(instances()).toHaveLength(1);
    expect(limits.notifications.createAndBroadcast).toHaveBeenCalledTimes(1);
  });

  it('a schedule fire past the cap returns null instead of throwing', async () => {
    wire(0);
    const { definitionId } = seedDefinition(
      kit.db,
      definition([{ kind: 'cron', cron: '0 9 * * *' }]),
    );
    kit.as({ user_id: undefined });
    const r = await kit.engine.startScheduled({ definitionId, cron: '0 9 * * *', fireAt: '2026-11-01T09:00:00Z' });
    expect(r).toBeNull();
    expect(instances()).toHaveLength(0);
  });

  it('a webhook start past the cap answers the neutral intake error without plan details', async () => {
    wire(0);
    const { definitionId } = seedDefinition(kit.db, definition([{ kind: 'webhook' }]));
    kit.as({ user_id: undefined });
    const r = await failure(
      kit.engine.startExternal({
        definitionId,
        kind: 'webhook',
        values: { amount: '10', reason: 'x' },
        idempotencyKey: 'h1',
        started: {},
        title: 'Web',
      }),
    );
    expect(r?.code).toBe('WORKFLOW_INTAKE_UNAVAILABLE');
    expect(r?.details).toBeUndefined();
    expect(instances()).toHaveLength(0);
  });

  it('an email start counts as a system start (plan error, not the neutral one)', async () => {
    wire(0);
    const { definitionId } = seedDefinition(kit.db, definition([{ kind: 'email' }]));
    kit.as({ user_id: undefined });
    const r = await failure(
      kit.engine.startExternal({
        definitionId,
        kind: 'email',
        values: { amount: '10', reason: 'x' },
        idempotencyKey: 'e1',
        started: {},
        title: 'Correo',
      }),
    );
    expect(r?.code).toBe('WORKFLOW_PLAN_LIMIT_REACHED');
  });

  it('gates and subflow children are exempt: they count but are never refused', async () => {
    wire(1);
    const starter = (kit.engine as any).starter;
    const ctx = { store_id: 1 };
    const prisma = kit.db.asStorePrisma() as any;
    for (let i = 0; i < 3; i++) {
      await expect(
        prisma.$transaction((tx: any) => starter.countStart(tx, ctx, 'exempt')),
      ).resolves.toBeUndefined();
    }
    expect(counter()?.count).toBe(3);
  });

  it('with an ample cap the start behaves as before', async () => {
    wire(100);
    seedDefinition(kit.db, definition([{ kind: 'manual' }]));
    const r = await kit.engine.start({ definitionKey: 'limite', idempotencyKey: 'ok' });
    expect(r.instance.status).toBe('active');
    expect(counter()?.count).toBe(1);
  });

  it('without the limits service (not wired) nothing is counted', async () => {
    seedDefinition(kit.db, definition([{ kind: 'manual' }]));
    await kit.engine.start({ definitionKey: 'limite', idempotencyKey: 'n' });
    expect(kit.db.table('workflow_usage_counters')).toHaveLength(0);
  });
});
