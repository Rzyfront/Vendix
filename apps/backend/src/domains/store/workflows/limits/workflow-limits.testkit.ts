import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { WorkflowLimitsService } from './workflow-limits.service';

type Row = Record<string, any>;

/**
 * Teaches the in-memory fake the two raw statements of the limits service: the
 * conditional counter upsert (atomic, like the real one) and the live storage
 * sum. Returns the counter rows for assertions.
 */
export function installLimitsRaw(db: FakeWorkflowDb) {
  db.rawHandlers.push((text, values) => {
    if (text.includes('INSERT INTO workflow_usage_counters')) {
      const [store_id, period, metric, cap] = values;
      const conditional = text.includes('WHERE workflow_usage_counters.count <');
      const table = db.table('workflow_usage_counters');
      const row = table.find((r) => r.store_id === store_id && r.period === period && r.metric === metric);
      if (!row) return [{ count: db.insert('workflow_usage_counters', { store_id, period, metric, count: 1 }).count }];
      if (conditional && row.count >= cap) return [];
      row.count += 1;
      return [{ count: row.count }];
    }
    if (text.includes('SUM(size_bytes)')) {
      const used = db
        .table('stored_files')
        .filter((f: Row) => f.store_id === values[0] && !f.deleted_at && !f.purged_at)
        .reduce((sum: number, f: Row) => sum + f.size_bytes, 0);
      return [{ used: BigInt(used) }];
    }
    return undefined;
  });
  return { counters: () => db.table('workflow_usage_counters') };
}

export interface LimitsFixture {
  /** `workflow_limits` of the plan row; `undefined` = column NULL (platform defaults). */
  limits?: Record<string, number | null>;
  paidPlanId?: number | null;
  planId?: number | null;
}

/** The real service over the fake database, with a scripted plan, resolver and notifier. */
export function buildLimits(db: FakeWorkflowDb, fixture: LimitsFixture = {}) {
  installLimitsRaw(db);
  const plans = { findUnique: jest.fn(async () => ({ workflow_limits: fixture.limits ?? null })) };
  const resolver = {
    resolveSubscription: jest.fn(async () => ({
      paidPlanId: fixture.paidPlanId === undefined ? 1 : fixture.paidPlanId,
      planId: fixture.planId === undefined ? 1 : fixture.planId,
    })),
  };
  const notifications = { createAndBroadcast: jest.fn(async () => undefined) };
  const service = new WorkflowLimitsService(
    db.asStorePrisma() as never,
    { subscription_plans: plans } as never,
    resolver as never,
    notifications as never,
  );
  return { service, plans, resolver, notifications };
}
