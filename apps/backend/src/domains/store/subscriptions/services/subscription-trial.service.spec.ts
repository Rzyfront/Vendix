import { SubscriptionTrialService } from './subscription-trial.service';

/**
 * Unit tests for SubscriptionTrialService.
 * Focus: createTrialForStore creates store_subscriptions (state=trial, plan=trial-full)
 * with trial_ends_at = now + default_trial_days from platform_settings.
 */
describe('SubscriptionTrialService', () => {
  let service: SubscriptionTrialService;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      subscription_plans: { findUnique: jest.fn() },
      platform_settings: { findFirst: jest.fn() },
      store_subscriptions: { create: jest.fn() },
      subscription_events: { create: jest.fn() },
    };
    service = new SubscriptionTrialService(prismaMock);
  });

  const trialPlan = {
    id: 1,
    code: 'trial-full',
    currency: 'USD',
    ai_feature_flags: { text_generation: { enabled: true } },
  };

  it('creates trial subscription with state=trial and plan=trial-full', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue(trialPlan);
    prismaMock.platform_settings.findFirst.mockResolvedValue({ default_trial_days: 14 });
    prismaMock.store_subscriptions.create.mockResolvedValue({ id: 100 });

    await service.createTrialForStore(10);

    expect(prismaMock.subscription_plans.findUnique).toHaveBeenCalledWith({
      where: { code: 'trial-full' },
    });
    const arg = prismaMock.store_subscriptions.create.mock.calls[0][0];
    expect(arg.data.store_id).toBe(10);
    expect(arg.data.plan_id).toBe(1);
    expect(arg.data.state).toBe('trial');
    expect(arg.data.currency).toBe('USD');
  });

  it('trial_ends_at = now + default_trial_days (14 days)', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue(trialPlan);
    prismaMock.platform_settings.findFirst.mockResolvedValue({ default_trial_days: 14 });
    prismaMock.store_subscriptions.create.mockResolvedValue({ id: 100 });

    const before = Date.now();
    await service.createTrialForStore(10);
    const after = Date.now();

    const createCall = prismaMock.store_subscriptions.create.mock.calls[0][0];
    const trialEndsAt: Date = createCall.data.trial_ends_at;

    const expectedMinMs = before + 14 * 24 * 60 * 60 * 1000;
    const expectedMaxMs = after + 14 * 24 * 60 * 60 * 1000;
    expect(trialEndsAt.getTime()).toBeGreaterThanOrEqual(expectedMinMs);
    expect(trialEndsAt.getTime()).toBeLessThanOrEqual(expectedMaxMs);
  });

  it('reads custom default_trial_days from platform_settings', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue(trialPlan);
    prismaMock.platform_settings.findFirst.mockResolvedValue({ default_trial_days: 30 });
    prismaMock.store_subscriptions.create.mockResolvedValue({ id: 100 });

    const before = Date.now();
    await service.createTrialForStore(10);

    const createCall = prismaMock.store_subscriptions.create.mock.calls[0][0];
    const trialEndsAt: Date = createCall.data.trial_ends_at;
    // Expect ~30 days, not 14.
    const diffDays = (trialEndsAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(29);
    expect(diffDays).toBeLessThan(31);
  });

  it('falls back to 14 days when platform_settings is missing', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue(trialPlan);
    prismaMock.platform_settings.findFirst.mockResolvedValue(null);
    prismaMock.store_subscriptions.create.mockResolvedValue({ id: 100 });

    const before = Date.now();
    await service.createTrialForStore(10);

    const createCall = prismaMock.store_subscriptions.create.mock.calls[0][0];
    const trialEndsAt: Date = createCall.data.trial_ends_at;
    const diffDays = (trialEndsAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(13);
    expect(diffDays).toBeLessThan(15);
  });

  it('logs error and swallows exception when trial plan not found (does not throw)', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue(null);

    await service.createTrialForStore(10);

    expect(prismaMock.store_subscriptions.create).not.toHaveBeenCalled();
  });

  it('creates subscription_events row type=trial_started after creation', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue(trialPlan);
    prismaMock.platform_settings.findFirst.mockResolvedValue({ default_trial_days: 14 });
    prismaMock.store_subscriptions.create.mockResolvedValue({ id: 100 });

    await service.createTrialForStore(10);

    const arg = prismaMock.subscription_events.create.mock.calls[0][0];
    expect(arg.data.store_subscription_id).toBe(100);
    expect(arg.data.type).toBe('trial_started');
    expect(arg.data.to_state).toBe('trial');
  });
});
