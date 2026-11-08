import {
  WorkflowsOpsAlertsService,
  evaluateRules,
} from './workflows-ops-alerts.service';
import type { WorkflowOpsSignals } from './workflows-ops-metrics.service';
import { ALERT_LOCK_KEY } from './workflows-ops.constants';

const calm: WorkflowOpsSignals = {
  heartbeat_age_seconds: 30,
  backlog_due: 0,
  oldest_due_age_seconds: null,
  dead_outbox_1h: 0,
  webhooks_1h_total: 0,
  webhooks_1h_failed: 0,
  webhooks_dead_1h: 0,
  latency_p95_seconds: null,
};
const rulesOf = (over: Partial<WorkflowOpsSignals>) =>
  evaluateRules({ ...calm, ...over }).map((c) => c.rule);

describe('evaluateRules', () => {
  it('fires nothing on a healthy platform', () => {
    expect(rulesOf({})).toEqual([]);
  });

  it('dispatcher_stalled: heartbeat older than 5 min while rows are due, not below, not without due rows', () => {
    expect(rulesOf({ heartbeat_age_seconds: 301, backlog_due: 1 })).toContain('dispatcher_stalled');
    expect(rulesOf({ heartbeat_age_seconds: null, backlog_due: 1 })).toContain('dispatcher_stalled');
    expect(rulesOf({ heartbeat_age_seconds: 300, backlog_due: 1 })).not.toContain('dispatcher_stalled');
    expect(rulesOf({ heartbeat_age_seconds: 900, backlog_due: 0 })).not.toContain('dispatcher_stalled');
  });

  it('backlog_lag: oldest due row older than 10 min', () => {
    expect(rulesOf({ oldest_due_age_seconds: 601, backlog_due: 2 })).toContain('backlog_lag');
    expect(rulesOf({ oldest_due_age_seconds: 600, backlog_due: 2 })).not.toContain('backlog_lag');
  });

  it('dead_letters: 5 dead rows in the last hour fires, 4 does not', () => {
    expect(rulesOf({ dead_outbox_1h: 5 })).toContain('dead_letters');
    expect(rulesOf({ dead_outbox_1h: 4 })).not.toContain('dead_letters');
  });

  it('webhook_failures: 20 deliveries with half failed, or 5 dead; not below either', () => {
    expect(rulesOf({ webhooks_1h_total: 20, webhooks_1h_failed: 10 })).toContain('webhook_failures');
    expect(rulesOf({ webhooks_1h_total: 20, webhooks_1h_failed: 9 })).not.toContain('webhook_failures');
    expect(rulesOf({ webhooks_1h_total: 19, webhooks_1h_failed: 19 })).not.toContain('webhook_failures');
    expect(rulesOf({ webhooks_1h_total: 6, webhooks_1h_failed: 5, webhooks_dead_1h: 5 })).toContain('webhook_failures');
    expect(rulesOf({ webhooks_1h_total: 6, webhooks_1h_failed: 4, webhooks_dead_1h: 4 })).not.toContain('webhook_failures');
  });

  it('latency_p95: above 5 min fires, exactly 5 min does not', () => {
    expect(rulesOf({ latency_p95_seconds: 301 })).toContain('latency_p95');
    expect(rulesOf({ latency_p95_seconds: 300 })).not.toContain('latency_p95');
  });

  it('puts only counts and ages in the e-mail lines and details, never store data', () => {
    const [c] = evaluateRules({ ...calm, dead_outbox_1h: 7 });
    expect(JSON.stringify(c)).not.toMatch(/store|payload|token/i);
  });
});

describe('WorkflowsOpsAlertsService', () => {
  const stalled: WorkflowOpsSignals = { ...calm, heartbeat_age_seconds: 900, backlog_due: 4 };
  let store: Map<string, string>;
  let redis: { set: jest.Mock; del: jest.Mock };
  let created: Array<Record<string, unknown>>;
  let sendEmail: jest.Mock;
  let findUsers: jest.Mock;
  let env: Record<string, string | undefined>;
  let signals: WorkflowOpsSignals;

  const build = () =>
    new WorkflowsOpsAlertsService(
      {
        withoutScope: () => ({
          workflow_ops_alerts: {
            create: jest.fn(async ({ data }) => {
              created.push(data);
              return data;
            }),
          },
          users: { findMany: findUsers },
        }),
      } as never,
      { getSignals: jest.fn(async () => signals) } as never,
      { sendEmail } as never,
      { get: (k: string) => env[k] } as never,
      redis as never,
    );

  beforeEach(() => {
    store = new Map();
    created = [];
    signals = stalled;
    env = { FRONTEND_URL: 'https://vendix.test/' };
    sendEmail = jest.fn().mockResolvedValue({ success: true });
    findUsers = jest.fn().mockResolvedValue([{ email: 'root@quickss.test' }, { email: 'ROOT@quickss.test' }]);
    redis = {
      set: jest.fn(async (key: string, value: string, _ex: string, _ttl: number, nx?: string) => {
        if (nx === 'NX' && store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
      del: jest.fn(async (key: string) => void store.delete(key)),
    };
  });

  it('inserts a history row and sends one e-mail with the numbers and the screen link', async () => {
    const raised = await build().evaluate();
    expect(raised).toEqual(['dispatcher_stalled']);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      rule: 'dispatcher_stalled',
      severity: 'critical',
      recipients: 1,
      details: { heartbeat_age_seconds: 900, backlog_due: 4 },
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [to, subject, html, text] = sendEmail.mock.calls[0];
    expect(to).toBe('root@quickss.test');
    expect(subject).toContain('despachador');
    expect(text).toContain('15 min');
    expect(text).toContain('4 tarea(s)');
    expect(text).toContain('https://vendix.test/super-admin/workflows-ops');
    expect(html).toContain('https://vendix.test/super-admin/workflows-ops');
  });

  it('does not repeat the same rule inside the hour (SET NX EX 3600) but raises a different rule', async () => {
    const service = build();
    await service.evaluate();
    expect(await service.evaluate()).toEqual([]);
    expect(created).toHaveLength(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('workflows:ops:alert:dispatcher_stalled', '1', 'EX', 3600, 'NX');
    signals = { ...stalled, dead_outbox_1h: 5 };
    expect(await service.evaluate()).toEqual(['dead_letters']);
    expect(created).toHaveLength(2);
  });

  it('sends to WORKFLOW_OPS_ALERT_EMAILS when set and does not look up super admins', async () => {
    env.WORKFLOW_OPS_ALERT_EMAILS = ' ops@quickss.test, oncall@quickss.test ,,nonsense';
    await build().evaluate();
    expect(findUsers).not.toHaveBeenCalled();
    expect(sendEmail.mock.calls.map((c) => c[0])).toEqual(['ops@quickss.test', 'oncall@quickss.test']);
    expect(created[0].recipients).toBe(2);
  });

  it('falls back to the active super admins (deduped) when the env var is unset', async () => {
    const recipients = await build().resolveRecipients();
    expect(recipients).toEqual(['root@quickss.test']);
    expect(findUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: 'active',
          user_roles: { some: { roles: { name: 'super_admin' } } },
        }),
      }),
    );
  });

  it('records zero recipients when the e-mail provider refuses, and still keeps the history row', async () => {
    sendEmail.mockResolvedValue({ success: false, error: 'down' });
    await build().evaluate();
    expect(created[0].recipients).toBe(0);
  });

  const withBrokenHistory = () => {
    const service = build();
    (service as unknown as { prisma: unknown }).prisma = {
      withoutScope: () => ({
        workflow_ops_alerts: { create: jest.fn().mockRejectedValue(new Error('db')) },
        users: { findMany: findUsers },
      }),
    };
    return service;
  };

  it('keeps the dedupe key when the e-mail went out but the row cannot be written, so nobody is mailed again next cycle', async () => {
    const service = withBrokenHistory();
    expect(await service.evaluate()).toEqual(['dispatcher_stalled']);
    expect(store.has('workflows:ops:alert:dispatcher_stalled')).toBe(true);
    const mailed = sendEmail.mock.calls.length;
    expect(mailed).toBeGreaterThan(0);

    expect(await service.evaluate()).toEqual([]);
    expect(sendEmail.mock.calls.length).toBe(mailed);
  });

  it('releases the dedupe key when nobody got the e-mail and the row cannot be written, so the next cycle retries', async () => {
    sendEmail.mockResolvedValue({ success: false, error: 'down' });
    const service = withBrokenHistory();
    expect(await service.evaluate()).toEqual([]);
    expect(store.has('workflows:ops:alert:dispatcher_stalled')).toBe(false);
  });

  it('handle() runs only on the replica that takes the Redis lock', async () => {
    const first = build();
    const second = build();
    await first.handle();
    store.delete('workflows:ops:alert:dispatcher_stalled');
    await second.handle();
    expect(redis.set).toHaveBeenCalledWith(ALERT_LOCK_KEY, '1', 'EX', 240, 'NX');
    expect(created).toHaveLength(1);
  });
});
