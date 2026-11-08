import { RequestContextService } from '@common/context/request-context.service';
import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { WorkflowUsageService } from './workflow-usage.service';
import { buildLimits } from './workflow-limits.testkit';
import { workflowPeriod } from './workflow-limits.service';

const MB = 1024 * 1024;

describe('WorkflowUsageService (P7.1 usage snapshot)', () => {
  let db: FakeWorkflowDb;

  beforeEach(() => {
    db = new FakeWorkflowDb();
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(1);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 1 } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  function build(
    limits: Record<string, number | null> | undefined,
    quota: Record<string, unknown>,
  ) {
    const l = buildLimits(db, { limits });
    const ai = { quota: jest.fn(async () => quota) };
    const service = new WorkflowUsageService(db.asStorePrisma() as never, l.service, ai as never);
    return { service, ai };
  }

  const seedCounter = (metric: string, count: number) =>
    db.insert('workflow_usage_counters', { store_id: 1, period: workflowPeriod(), metric, count });

  it('builds the four meters in order with the current month', async () => {
    const { service } = build(
      { monthly_instances: 10, monthly_http_calls: 100, storage_bytes: 100 * MB },
      { state: 'ok', used: 10, cap: 100, percent: 10, period: '2026-11', reason: null },
    );
    const r = await service.snapshot();
    expect(r.period).toBe(workflowPeriod());
    expect(r.metrics.map((m) => m.key)).toEqual([
      'monthly_instances',
      'monthly_http_calls',
      'storage_bytes',
      'monthly_ai_tokens',
    ]);
  });

  it('marks ok under 80 %, warning from 80 %, blocked at 100 % and clamps past the cap', async () => {
    seedCounter('monthly_instances', 7);
    seedCounter('monthly_http_calls', 80);
    db.insert('stored_files', { store_id: 1, size_bytes: 300 * MB });
    const { service } = build(
      { monthly_instances: 10, monthly_http_calls: 100, storage_bytes: 100 * MB },
      { state: 'ok', used: 0, cap: 100, percent: 0, period: '2026-11', reason: null },
    );
    const [inst, http, storage] = (await service.snapshot()).metrics;
    expect(inst).toMatchObject({ used: 7, cap: 10, percent: 70, state: 'ok' });
    expect(http).toMatchObject({ used: 80, cap: 100, percent: 80, state: 'warning' });
    expect(storage).toMatchObject({ cap: 100 * MB, percent: 100, state: 'blocked' });
  });

  it('a null cap is unlimited with no percent', async () => {
    seedCounter('monthly_instances', 5);
    const { service } = build(
      { monthly_instances: null },
      { state: 'ok', used: 0, cap: null, percent: null, period: '2026-11', reason: null },
    );
    expect((await service.snapshot()).metrics[0]).toEqual({
      key: 'monthly_instances',
      used: 5,
      cap: null,
      percent: null,
      state: 'unlimited',
    });
  });

  it('maps the AI quota as is: unavailable, unlimited, warning and blocked', async () => {
    const tokens = async (quota: Record<string, unknown>) =>
      (await build(undefined, quota).service.snapshot()).metrics[3];
    expect(await tokens({ state: 'unavailable', used: 0, cap: null, percent: null })).toMatchObject({
      state: 'unavailable',
      cap: null,
    });
    expect(await tokens({ state: 'ok', used: 9, cap: null, percent: null })).toMatchObject({
      state: 'unlimited',
      used: 9,
    });
    expect(await tokens({ state: 'warning', used: 85, cap: 100, percent: 85 })).toMatchObject({
      state: 'warning',
      percent: 85,
      cap: 100,
    });
    expect(await tokens({ state: 'blocked', used: 120, cap: 100, percent: 120 })).toMatchObject({
      state: 'blocked',
      percent: 100,
    });
  });

  it('counts only this store', async () => {
    db.insert('workflow_usage_counters', {
      store_id: 2,
      period: workflowPeriod(),
      metric: 'monthly_instances',
      count: 99,
    });
    const { service } = build(
      { monthly_instances: 100 },
      { state: 'ok', used: 0, cap: 1, percent: 0, period: '2026-11', reason: null },
    );
    expect((await service.snapshot()).metrics[0].used).toBe(0);
  });
});
