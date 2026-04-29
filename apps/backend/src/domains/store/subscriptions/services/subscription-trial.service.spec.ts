import { SubscriptionTrialService } from './subscription-trial.service';
import { VendixHttpException } from '../../../../common/errors';

/**
 * Unit tests for SubscriptionTrialService.
 *
 * Contract under test (auto-trial, one-shot per organization):
 *   - Org with has_consumed_trial=false + active default plan -> creates
 *     store_subscriptions(state=trial), writes subscription_events(trial_started),
 *     INSERTs organization_trial_consumptions(organization_id), and dual-writes
 *     organizations.has_consumed_trial=true for back-compat.
 *   - Org with has_consumed_trial=true -> no-op (returns null, no DB writes
 *     beyond the FOR UPDATE select).
 *   - No default plan -> returns null and logs error.
 *   - Plan trial_days override wins over platform_settings.default_trial_days.
 *   - Concurrent trial consumption -> P2002 from
 *     organization_trial_consumptions UNIQUE(organization_id) is surfaced as
 *     VendixHttpException(SUBSCRIPTION_TRIAL_001) with Spanish message.
 *   - Platform settings are loaded via findUnique({ where: { key: 'core' } }).
 */
describe('SubscriptionTrialService', () => {
  let service: SubscriptionTrialService;
  let txMock: any;
  let prismaMock: any;

  const trialPlan = {
    id: 1,
    code: 'trial-default',
    currency: 'USD',
    trial_days: 0,
    ai_feature_flags: { text_generation: { enabled: true } },
  };

  beforeEach(() => {
    txMock = {
      $queryRaw: jest.fn(),
      subscription_plans: { findFirst: jest.fn() },
      platform_settings: { findUnique: jest.fn() },
      store_subscriptions: { create: jest.fn() },
      subscription_events: { create: jest.fn() },
      organization_trial_consumptions: { create: jest.fn() },
      organizations: { update: jest.fn() },
    };

    prismaMock = {
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(txMock)),
    };

    service = new SubscriptionTrialService(prismaMock);
  });

  it('creates trial subscription, writes audit row, and dual-writes the legacy flag', async () => {
    txMock.$queryRaw.mockResolvedValue([{ id: 5, has_consumed_trial: false }]);
    txMock.subscription_plans.findFirst.mockResolvedValue(trialPlan);
    txMock.platform_settings.findUnique.mockResolvedValue({
      key: 'core',
      default_trial_days: 14,
    });
    txMock.store_subscriptions.create.mockResolvedValue({ id: 100 });
    txMock.organization_trial_consumptions.create.mockResolvedValue({
      id: 1,
      organization_id: 5,
      store_subscription_id: 100,
    });

    const result = await service.createTrialForStore(10, 5);

    expect(result).toEqual({ id: 100 });

    // platform_settings is resolved deterministically via findUnique on key='core'
    expect(txMock.platform_settings.findUnique).toHaveBeenCalledWith({
      where: { key: 'core' },
    });

    // findFirst called with is_default=true filter
    expect(txMock.subscription_plans.findFirst).toHaveBeenCalledWith({
      where: { is_default: true, state: 'active', archived_at: null },
    });

    const createArg = txMock.store_subscriptions.create.mock.calls[0][0];
    expect(createArg.data.store_id).toBe(10);
    expect(createArg.data.plan_id).toBe(1);
    expect(createArg.data.state).toBe('trial');
    expect(createArg.data.currency).toBe('USD');
    expect(createArg.data.current_period_start).toBeInstanceOf(Date);
    expect(createArg.data.current_period_end).toBeInstanceOf(Date);
    expect(createArg.data.next_billing_at).toBeInstanceOf(Date);
    expect(createArg.data.auto_renew).toBe(true);

    // Audit event written
    const eventArg = txMock.subscription_events.create.mock.calls[0][0];
    expect(eventArg.data.store_subscription_id).toBe(100);
    expect(eventArg.data.type).toBe('trial_started');
    expect(eventArg.data.to_state).toBe('trial');
    expect(eventArg.data.triggered_by_job).toBe('auto-trial-bootstrap');
    expect(eventArg.data.payload.plan_id).toBe(1);
    expect(eventArg.data.payload.plan_code).toBe('trial-default');

    // organization_trial_consumptions audit INSERT (authoritative one-shot)
    expect(txMock.organization_trial_consumptions.create).toHaveBeenCalledTimes(
      1,
    );
    const trialAuditArg =
      txMock.organization_trial_consumptions.create.mock.calls[0][0];
    expect(trialAuditArg.data.organization_id).toBe(5);
    expect(trialAuditArg.data.store_subscription_id).toBe(100);
    expect(trialAuditArg.data.consumed_at).toBeInstanceOf(Date);

    // Dual-write of the legacy back-compat flag flipped LAST
    const updateArg = txMock.organizations.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 5 });
    expect(updateArg.data.has_consumed_trial).toBe(true);
    expect(updateArg.data.trial_consumed_at).toBeInstanceOf(Date);
  });

  it('throws VendixHttpException SUBSCRIPTION_TRIAL_001 (Spanish) on concurrent trial (P2002)', async () => {
    txMock.$queryRaw.mockResolvedValue([{ id: 5, has_consumed_trial: false }]);
    txMock.subscription_plans.findFirst.mockResolvedValue(trialPlan);
    txMock.platform_settings.findUnique.mockResolvedValue({
      key: 'core',
      default_trial_days: 14,
    });
    txMock.store_subscriptions.create.mockResolvedValue({ id: 100 });

    // Simulate a second concurrent writer that already inserted the audit
    // row — Prisma raises P2002 on the UNIQUE(organization_id) constraint.
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    txMock.organization_trial_consumptions.create.mockRejectedValue(p2002);

    let captured: unknown;
    try {
      // tx is passed so the service propagates the error (does not swallow).
      await service.createTrialForStore(10, 5, txMock);
    } catch (e) {
      captured = e;
    }

    expect(captured).toBeInstanceOf(VendixHttpException);
    const ex = captured as VendixHttpException;
    expect(ex.errorCode).toBe('SUBSCRIPTION_TRIAL_001');
    expect(ex.getStatus()).toBe(409);
    const body = ex.getResponse() as { error_code: string; message: string };
    expect(body.error_code).toBe('SUBSCRIPTION_TRIAL_001');
    expect(body.message).toBe('Trial ya consumido');

    // The legacy flag dual-write must NOT happen on failure
    expect(txMock.organizations.update).not.toHaveBeenCalled();
  });

  it('rethrows non-P2002 errors from the audit INSERT untouched', async () => {
    txMock.$queryRaw.mockResolvedValue([{ id: 5, has_consumed_trial: false }]);
    txMock.subscription_plans.findFirst.mockResolvedValue(trialPlan);
    txMock.platform_settings.findUnique.mockResolvedValue({
      key: 'core',
      default_trial_days: 14,
    });
    txMock.store_subscriptions.create.mockResolvedValue({ id: 100 });

    const dbError = Object.assign(new Error('connection lost'), {
      code: 'P1001',
    });
    txMock.organization_trial_consumptions.create.mockRejectedValue(dbError);

    await expect(service.createTrialForStore(10, 5, txMock)).rejects.toBe(
      dbError,
    );

    expect(txMock.organizations.update).not.toHaveBeenCalled();
  });

  it('skips silently when org has_consumed_trial=true (returns null)', async () => {
    txMock.$queryRaw.mockResolvedValue([{ id: 5, has_consumed_trial: true }]);

    const result = await service.createTrialForStore(10, 5);

    expect(result).toBeNull();
    expect(txMock.subscription_plans.findFirst).not.toHaveBeenCalled();
    expect(txMock.store_subscriptions.create).not.toHaveBeenCalled();
    expect(txMock.subscription_events.create).not.toHaveBeenCalled();
    expect(
      txMock.organization_trial_consumptions.create,
    ).not.toHaveBeenCalled();
    expect(txMock.organizations.update).not.toHaveBeenCalled();
  });

  it('returns null when org does not exist', async () => {
    txMock.$queryRaw.mockResolvedValue([]);

    const result = await service.createTrialForStore(10, 999);

    expect(result).toBeNull();
    expect(txMock.subscription_plans.findFirst).not.toHaveBeenCalled();
    expect(txMock.store_subscriptions.create).not.toHaveBeenCalled();
    expect(
      txMock.organization_trial_consumptions.create,
    ).not.toHaveBeenCalled();
  });

  it('returns null when no default plan is available (no throw)', async () => {
    txMock.$queryRaw.mockResolvedValue([{ id: 5, has_consumed_trial: false }]);
    txMock.subscription_plans.findFirst.mockResolvedValue(null);

    const result = await service.createTrialForStore(10, 5);

    expect(result).toBeNull();
    expect(txMock.store_subscriptions.create).not.toHaveBeenCalled();
    expect(txMock.subscription_events.create).not.toHaveBeenCalled();
    expect(
      txMock.organization_trial_consumptions.create,
    ).not.toHaveBeenCalled();
    expect(txMock.organizations.update).not.toHaveBeenCalled();
  });

  it('uses plan.trial_days when > 0 (overrides platform default)', async () => {
    txMock.$queryRaw.mockResolvedValue([{ id: 5, has_consumed_trial: false }]);
    txMock.subscription_plans.findFirst.mockResolvedValue({
      ...trialPlan,
      trial_days: 30,
    });
    txMock.platform_settings.findUnique.mockResolvedValue({
      key: 'core',
      default_trial_days: 14,
    });
    txMock.store_subscriptions.create.mockResolvedValue({ id: 100 });
    txMock.organization_trial_consumptions.create.mockResolvedValue({ id: 1 });

    const before = Date.now();
    await service.createTrialForStore(10, 5);

    const createArg = txMock.store_subscriptions.create.mock.calls[0][0];
    const trialEndsAt: Date = createArg.data.trial_ends_at;
    const diffDays = (trialEndsAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(29);
    expect(diffDays).toBeLessThan(31);
  });

  it('falls back to platform_settings.default_trial_days when plan.trial_days=0', async () => {
    txMock.$queryRaw.mockResolvedValue([{ id: 5, has_consumed_trial: false }]);
    txMock.subscription_plans.findFirst.mockResolvedValue({
      ...trialPlan,
      trial_days: 0,
    });
    txMock.platform_settings.findUnique.mockResolvedValue({
      key: 'core',
      default_trial_days: 21,
    });
    txMock.store_subscriptions.create.mockResolvedValue({ id: 100 });
    txMock.organization_trial_consumptions.create.mockResolvedValue({ id: 1 });

    const before = Date.now();
    await service.createTrialForStore(10, 5);

    const createArg = txMock.store_subscriptions.create.mock.calls[0][0];
    const trialEndsAt: Date = createArg.data.trial_ends_at;
    const diffDays = (trialEndsAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(20);
    expect(diffDays).toBeLessThan(22);
  });

  it('falls back to 14 days when both plan.trial_days=0 and platform_settings missing', async () => {
    txMock.$queryRaw.mockResolvedValue([{ id: 5, has_consumed_trial: false }]);
    txMock.subscription_plans.findFirst.mockResolvedValue({
      ...trialPlan,
      trial_days: 0,
    });
    txMock.platform_settings.findUnique.mockResolvedValue(null);
    txMock.store_subscriptions.create.mockResolvedValue({ id: 100 });
    txMock.organization_trial_consumptions.create.mockResolvedValue({ id: 1 });

    const before = Date.now();
    await service.createTrialForStore(10, 5);

    const createArg = txMock.store_subscriptions.create.mock.calls[0][0];
    const trialEndsAt: Date = createArg.data.trial_ends_at;
    const diffDays = (trialEndsAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(13);
    expect(diffDays).toBeLessThan(15);
  });

  it('runs inside caller-provided tx (does NOT open its own $transaction)', async () => {
    txMock.$queryRaw.mockResolvedValue([{ id: 5, has_consumed_trial: false }]);
    txMock.subscription_plans.findFirst.mockResolvedValue(trialPlan);
    txMock.platform_settings.findUnique.mockResolvedValue({
      key: 'core',
      default_trial_days: 14,
    });
    txMock.store_subscriptions.create.mockResolvedValue({ id: 100 });
    txMock.organization_trial_consumptions.create.mockResolvedValue({ id: 1 });

    await service.createTrialForStore(10, 5, txMock);

    // When tx is passed, the service should NOT wrap with its own $transaction.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.store_subscriptions.create).toHaveBeenCalled();
    expect(txMock.organization_trial_consumptions.create).toHaveBeenCalled();
    expect(txMock.organizations.update).toHaveBeenCalled();
  });

  it('propagates errors when caller passed a tx (so caller can rollback)', async () => {
    txMock.$queryRaw.mockResolvedValue([{ id: 5, has_consumed_trial: false }]);
    txMock.subscription_plans.findFirst.mockResolvedValue(trialPlan);
    txMock.platform_settings.findUnique.mockResolvedValue({
      key: 'core',
      default_trial_days: 14,
    });
    txMock.store_subscriptions.create.mockRejectedValue(
      new Error('boom: db down'),
    );

    await expect(service.createTrialForStore(10, 5, txMock)).rejects.toThrow(
      'boom: db down',
    );
  });

  it('swallows errors when no tx was passed (graceful no-throw contract)', async () => {
    txMock.$queryRaw.mockResolvedValue([{ id: 5, has_consumed_trial: false }]);
    txMock.subscription_plans.findFirst.mockResolvedValue(trialPlan);
    txMock.platform_settings.findUnique.mockResolvedValue({
      key: 'core',
      default_trial_days: 14,
    });
    txMock.store_subscriptions.create.mockRejectedValue(
      new Error('boom: db down'),
    );

    const result = await service.createTrialForStore(10, 5);

    expect(result).toBeNull();
  });
});
