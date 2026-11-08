import { VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { WORKFLOW_LIMIT_DEFAULTS } from './workflow-limits.constants';
import { workflowPeriod } from './workflow-limits.service';
import { buildLimits } from './workflow-limits.testkit';
import { parseWorkflowLimits } from './workflow-limits.validation';

const GIB = 1024 * 1024 * 1024;

async function failure(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException
      ? { code: e.errorCode, status: e.getStatus(), body: e.getResponse() as Record<string, any> }
      : { code: `OTHER:${(e as Error).message}`, status: 0, body: {} };
  }
}

describe('WorkflowLimitsService (P7.1)', () => {
  let db: FakeWorkflowDb;

  beforeEach(() => {
    db = new FakeWorkflowDb();
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 1 } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('effective limits', () => {
    it('a plan without workflow_limits gets the platform defaults', async () => {
      const { service } = buildLimits(db);
      expect(await service.effectiveLimits(1)).toEqual({
        monthly_instances: 20_000,
        monthly_http_calls: 50_000,
        storage_bytes: 10 * GIB,
      });
      expect(WORKFLOW_LIMIT_DEFAULTS.storage_bytes).toBe(10 * GIB);
    });

    it('reads the plan row by the paid plan, a key set to null is unlimited and a missing key keeps its default', async () => {
      const { service, plans } = buildLimits(db, {
        limits: { monthly_instances: 3, monthly_http_calls: null },
        paidPlanId: 7,
        planId: 9,
      });
      expect(await service.effectiveLimits(1)).toEqual({
        monthly_instances: 3,
        monthly_http_calls: null,
        storage_bytes: 10 * GIB,
      });
      expect(plans.findUnique).toHaveBeenCalledWith({ where: { id: 7 }, select: { workflow_limits: true } });
    });

    it('a trial store (no paid plan) reads its trial plan; a store without any plan gets the defaults', async () => {
      const trial = buildLimits(db, { limits: { monthly_instances: 5 }, paidPlanId: null, planId: 4 });
      expect((await trial.service.effectiveLimits(1)).monthly_instances).toBe(5);
      expect(trial.plans.findUnique).toHaveBeenCalledWith({ where: { id: 4 }, select: { workflow_limits: true } });

      const none = buildLimits(db, { paidPlanId: null, planId: null });
      expect((await none.service.effectiveLimits(1)).monthly_instances).toBe(20_000);
      expect(none.plans.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('consume (atomic conditional counter)', () => {
    const counter = () => db.table('workflow_usage_counters').find((r) => r.metric === 'monthly_instances');

    it('counts up to the cap and refuses the next one without changing the counter', async () => {
      const { service } = buildLimits(db, { limits: { monthly_instances: 2 } });
      const period = workflowPeriod();
      expect(await service.consume(1, 'monthly_instances')).toMatchObject({ allowed: true, used: 1, cap: 2, period });
      expect(await service.consume(1, 'monthly_instances')).toMatchObject({ allowed: true, used: 2 });
      expect(await service.consume(1, 'monthly_instances')).toMatchObject({ allowed: false, used: 2, cap: 2, period });
      expect(counter()?.count).toBe(2);
    });

    it('concurrent callers can never pass the cap', async () => {
      const { service } = buildLimits(db, { limits: { monthly_instances: 3 } });
      const results = await Promise.all(
        Array.from({ length: 10 }, () => service.consume(1, 'monthly_instances')),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(3);
      expect(counter()?.count).toBe(3);
    });

    it('enforce:false always counts, past the cap', async () => {
      const { service } = buildLimits(db, { limits: { monthly_instances: 1 } });
      await service.consume(1, 'monthly_instances');
      const exempt = await service.consume(1, 'monthly_instances', { enforce: false });
      expect(exempt).toMatchObject({ allowed: true, used: 2, cap: 1 });
      expect(counter()?.count).toBe(2);
    });

    it('a null cap is unlimited and a cap of 0 refuses everything', async () => {
      const unlimited = buildLimits(db, { limits: { monthly_instances: null } });
      for (let i = 0; i < 5; i++) await unlimited.service.consume(1, 'monthly_instances');
      expect(counter()?.count).toBe(5);

      const zero = buildLimits(new FakeWorkflowDb(), { limits: { monthly_instances: 0 } });
      expect(await zero.service.consume(1, 'monthly_instances')).toMatchObject({ allowed: false, used: 0, cap: 0 });
    });

    it('counters are per store and per metric', async () => {
      const { service } = buildLimits(db, { limits: { monthly_instances: 1, monthly_http_calls: 1 } });
      await service.consume(1, 'monthly_instances');
      expect((await service.consume(2, 'monthly_instances')).allowed).toBe(true);
      expect((await service.consume(1, 'monthly_http_calls')).allowed).toBe(true);
      expect((await service.consume(1, 'monthly_instances')).allowed).toBe(false);
    });
  });

  describe('storage', () => {
    const file = (over: Record<string, unknown>) =>
      db.insert('stored_files', { store_id: 1, size_bytes: 100, s3_key: `k${Math.random()}`, ...over });

    it('sums only live files of the store and refuses used + incoming over the cap before anything is written', async () => {
      const { service } = buildLimits(db, { limits: { storage_bytes: 1000 } });
      file({ size_bytes: 600 });
      file({ size_bytes: 300, deleted_at: new Date() });
      file({ size_bytes: 300, purged_at: new Date() });
      file({ size_bytes: 5000, store_id: 2 });
      expect(await service.storageUsed(1)).toBe(600);
      await expect(service.assertStorage(1, 400)).resolves.toBeUndefined();
      const refused = await failure(service.assertStorage(1, 401));
      expect(refused).toMatchObject({ code: 'WORKFLOW_PLAN_LIMIT_REACHED', status: 402 });
      expect(refused?.body.details).toEqual({
        limit: 'storage_bytes',
        used: 600,
        cap: 1000,
        period: workflowPeriod(),
      });
    });

    it('an outsider gets the neutral message and no plan details', async () => {
      const { service } = buildLimits(db, { limits: { storage_bytes: 10 } });
      const refused = await failure(service.assertStorage(1, 11, 'outsider'));
      expect(refused).toMatchObject({ code: 'WORKFLOW_INTAKE_UNAVAILABLE', status: 503 });
      expect(refused?.body.details).toBeUndefined();
    });

    it('a null cap never refuses', async () => {
      const { service } = buildLimits(db, { limits: { storage_bytes: null } });
      await expect(service.assertStorage(1, 50 * GIB)).resolves.toBeUndefined();
    });
  });

  describe('refusal wording', () => {
    it('words each limit in Spanish and carries the details that open the paywall', async () => {
      const { service } = buildLimits(db);
      const base = { allowed: false as const, period: '2026-11' };
      const requests = service.refusal({ ...base, metric: 'monthly_instances', used: 3, cap: 3 });
      expect(requests.message).toBe('Llegaste al límite de solicitudes de tu plan (3 de 3 este mes).');
      expect(requests.getStatus()).toBe(402);
      expect(service.refusal({ ...base, metric: 'monthly_http_calls', used: 50_000, cap: 50_000 }).message).toBe(
        'Llegaste al límite de llamadas HTTP de tu plan (50.000 de 50.000 este mes).',
      );
      expect(service.refusal({ ...base, metric: 'storage_bytes', used: GIB * 2.5, cap: GIB * 3 }).message).toBe(
        'Llegaste al límite de almacenamiento de tu plan (2,5 de 3 GB).',
      );
    });
  });

  describe('owner notice', () => {
    it('notifies once per month and limit, whoever asks', async () => {
      const { service, notifications } = buildLimits(db);
      const use = { metric: 'monthly_instances' as const, allowed: false, used: 3, cap: 3, period: '2026-11' };
      await service.noticeOnce(1, use, false);
      await service.noticeOnce(1, use, false);
      await service.noticeOnce(1, use, true);
      expect(notifications.createAndBroadcast).toHaveBeenCalledTimes(1);
      expect(notifications.createAndBroadcast).toHaveBeenCalledWith(
        1,
        'workflow_task',
        expect.stringContaining('límite de solicitudes'),
        expect.any(String),
        expect.objectContaining({ kind: 'workflow_plan_limit', period: '2026-11', url: '/admin/workflows/usage' }),
      );
      await service.noticeOnce(1, { ...use, period: '2026-12' }, false);
      expect(notifications.createAndBroadcast).toHaveBeenCalledTimes(2);
    });

    it('a failing notifier never breaks the caller', async () => {
      const { service, notifications } = buildLimits(db);
      notifications.createAndBroadcast.mockRejectedValue(new Error('sse down'));
      await expect(
        service.noticeOnce(1, { metric: 'monthly_instances', allowed: false, used: 1, cap: 1, period: '2026-11' }, false),
      ).resolves.toBeUndefined();
    });
  });
});

describe('parseWorkflowLimits', () => {
  const code = (raw: unknown) => {
    try {
      parseWorkflowLimits(raw);
      return undefined;
    } catch (e) {
      return (e as VendixHttpException).errorCode;
    }
  };

  it('undefined keeps the stored value, null clears it, an object keeps only valid keys', () => {
    expect(parseWorkflowLimits(undefined)).toBeUndefined();
    expect(parseWorkflowLimits(null)).toBeNull();
    expect(parseWorkflowLimits({ monthly_instances: 0, monthly_http_calls: null })).toEqual({
      monthly_instances: 0,
      monthly_http_calls: null,
    });
    expect(parseWorkflowLimits({})).toEqual({});
  });

  it.each([
    ['an unknown key', { monthly_tokens: 5 }],
    ['a negative number', { monthly_instances: -1 }],
    ['a fraction', { storage_bytes: 1.5 }],
    ['a string', { monthly_http_calls: '10' }],
    ['an array', [1, 2]],
    ['a string body', 'x'],
  ])('rejects %s with WORKFLOW_LIMITS_INVALID', (_name, raw) => {
    expect(code(raw)).toBe('WORKFLOW_LIMITS_INVALID');
  });
});
