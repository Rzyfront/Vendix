import { PromotionalRulesEvaluator } from './promotional-rules.evaluator';

/**
 * Unit tests for `PromotionalRulesEvaluator.evaluate(storeId, promoPlanId)`.
 *
 * Each test isolates a single `reason_blocked` to ensure the evaluator
 * accumulates ALL failing reasons (no short-circuit) and returns the canonical
 * code list documented in `promo.types.ts`.
 */
describe('PromotionalRulesEvaluator.evaluate', () => {
  let evaluator: PromotionalRulesEvaluator;
  let prismaMock: any;

  const STORE_ID = 10;
  const ORG_ID = 100;
  const PROMO_PLAN_ID = 999;

  function setupPlan(promoRules: any, planType: string = 'promotional') {
    prismaMock.subscription_plans.findUnique.mockResolvedValue({
      id: PROMO_PLAN_ID,
      code: 'black-friday',
      plan_type: planType,
      promo_rules: promoRules,
    });
  }

  function setupStore(orgId: number = ORG_ID, isActive = true) {
    prismaMock.stores.findUnique.mockResolvedValue({
      id: STORE_ID,
      organization_id: orgId,
      is_active: isActive,
    });
  }

  beforeEach(() => {
    prismaMock = {
      subscription_plans: { findUnique: jest.fn() },
      stores: {
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
      },
      store_subscriptions: { count: jest.fn().mockResolvedValue(0) },
      addresses: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    evaluator = new PromotionalRulesEvaluator(prismaMock);
  });

  it('plan does not exist → throws SUBSCRIPTION_001', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue(null);
    await expect(evaluator.evaluate(STORE_ID, PROMO_PLAN_ID)).rejects.toThrow();
  });

  it('all criteria pass → eligible=true, no reasons', async () => {
    setupPlan({});
    setupStore();

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.eligible).toBe(true);
    expect(result.reasons_blocked).toEqual([]);
    expect(result.promo_plan_id).toBe(PROMO_PLAN_ID);
    expect(result.promo_plan_code).toBe('black-friday');
  });

  it('not started yet → reasons_blocked includes not_started', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
    setupPlan({ starts_at: future });
    setupStore();

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.eligible).toBe(false);
    expect(result.reasons_blocked).toContain('not_started');
  });

  it('expired → reasons_blocked includes expired', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    setupPlan({ ends_at: past });
    setupStore();

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.eligible).toBe(false);
    expect(result.reasons_blocked).toContain('expired');
  });

  it('stores_min not met → reasons_blocked includes stores_min', async () => {
    setupPlan({ stores_min: 5 });
    setupStore();
    prismaMock.stores.count.mockResolvedValue(2);

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.reasons_blocked).toContain('stores_min');
  });

  it('stores_max exceeded → reasons_blocked includes stores_max', async () => {
    setupPlan({ stores_max: 3 });
    setupStore();
    prismaMock.stores.count.mockResolvedValue(10);

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.reasons_blocked).toContain('stores_max');
  });

  it('plan_type_required mismatch → reasons_blocked includes plan_type_mismatch', async () => {
    setupPlan({ plan_type_required: 'partner_custom' }, 'base');
    setupStore();

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.reasons_blocked).toContain('plan_type_mismatch');
  });

  it('region not eligible → reasons_blocked includes region_not_eligible', async () => {
    setupPlan({ regions: ['CO', 'MX'] });
    setupStore();
    prismaMock.addresses.findFirst.mockResolvedValue({ country_code: 'US' });

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.reasons_blocked).toContain('region_not_eligible');
  });

  it('region matches primary address country → eligible', async () => {
    setupPlan({ regions: ['CO'] });
    setupStore();
    prismaMock.addresses.findFirst.mockResolvedValue({ country_code: 'CO' });

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.eligible).toBe(true);
  });

  it('region defined but no address found → reasons_blocked includes region_not_eligible', async () => {
    setupPlan({ regions: ['CO'] });
    setupStore();
    prismaMock.addresses.findFirst.mockResolvedValue(null);

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.reasons_blocked).toContain('region_not_eligible');
  });

  it('excluded organization → reasons_blocked includes excluded', async () => {
    setupPlan({ excluded_organizations: [ORG_ID, 200] });
    setupStore();

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.reasons_blocked).toContain('excluded');
  });

  it('not in target list → reasons_blocked includes not_targeted', async () => {
    setupPlan({ target_organizations: [200, 300] });
    setupStore();

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.reasons_blocked).toContain('not_targeted');
  });

  it('in target list → eligible', async () => {
    setupPlan({ target_organizations: [ORG_ID] });
    setupStore();

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.eligible).toBe(true);
  });

  it('max_uses reached → reasons_blocked includes max_uses_reached', async () => {
    setupPlan({ max_uses: 100 });
    setupStore();
    prismaMock.store_subscriptions.count.mockResolvedValue(100);

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.reasons_blocked).toContain('max_uses_reached');
  });

  it('max_uses_per_org reached → reasons_blocked includes max_uses_per_org_reached', async () => {
    setupPlan({ max_uses_per_org: 1 });
    setupStore();
    prismaMock.store_subscriptions.count.mockResolvedValue(1);

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.reasons_blocked).toContain('max_uses_per_org_reached');
  });

  it('multiple violations → all reasons accumulated (no short-circuit)', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    setupPlan({
      ends_at: past,
      stores_min: 10,
      regions: ['MX'],
      excluded_organizations: [ORG_ID],
    });
    setupStore();
    prismaMock.stores.count.mockResolvedValue(1);
    prismaMock.addresses.findFirst.mockResolvedValue({ country_code: 'CO' });

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.eligible).toBe(false);
    expect(result.reasons_blocked).toEqual(
      expect.arrayContaining([
        'expired',
        'stores_min',
        'region_not_eligible',
        'excluded',
      ]),
    );
    expect(result.reasons_blocked.length).toBeGreaterThanOrEqual(4);
  });

  it('store not found → eligible=false with store_not_found reason', async () => {
    setupPlan({});
    prismaMock.stores.findUnique.mockResolvedValue(null);

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.eligible).toBe(false);
    expect(result.reasons_blocked).toContain('store_not_found');
  });

  it('promo_rules null/empty → eligible=true (no rules to violate)', async () => {
    setupPlan(null);
    setupStore();

    const result = await evaluator.evaluate(STORE_ID, PROMO_PLAN_ID);
    expect(result.eligible).toBe(true);
    expect(result.reasons_blocked).toEqual([]);
  });
});
