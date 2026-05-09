import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedSubscriptionPlansResult {
  plansCreated: number;
  plansUpdated: number;
  defaultPlanCode: string;
}

/**
 * Subscription Plans Seed — single canonical trial plan
 *
 * Creates (or upserts) the only plan the platform ships with: `trial-default`.
 * Used by SubscriptionTrialService via `is_default=true AND state='active'`.
 *
 * Full AI feature flags by default. The intent is to ship a permissive trial
 * out of the box; cost containment / tier differentiation is configured later
 * by editing the plan in the super-admin UI (or by adding additional plans).
 *
 * is_default=true cooperates with the partial UNIQUE INDEX
 * (subscription_plans_unique_default_active) which guarantees only ONE
 * active, non-archived default at any time.
 *
  * No dependencies on other seeds. Trial duration comes from
  * platform_settings.default_trial_days; this plan only owns access/features.
 */
export async function seedSubscriptionPlans(
  prisma?: PrismaClient,
): Promise<SeedSubscriptionPlansResult> {
  const client = prisma || getPrismaClient();
  console.log('  Seeding subscription plans (default trial plan)...');

  const TRIAL_DEFAULT_CODE = 'trial-default';

  const featureMatrix = {
    pos: true,
    ecommerce: true,
    accounting: true,
    inventory: true,
  };

  // Full AI access. Generous caps so the platform ships usable out of the box.
  const aiFeatureFlags = {
    text_generation: {
      enabled: true,
      monthly_tokens_cap: 1000000,
      degradation: 'warn',
    },
    streaming_chat: {
      enabled: true,
      daily_messages_cap: 1000,
      degradation: 'warn',
    },
    conversations: {
      enabled: true,
      retention_days: 365,
      degradation: 'warn',
    },
    tool_agents: {
      enabled: true,
      tools_allowed: ['*'],
      degradation: 'warn',
    },
    rag_embeddings: {
      enabled: true,
      indexed_docs_cap: 5000,
      degradation: 'warn',
    },
    async_queue: {
      enabled: true,
      monthly_jobs_cap: 5000,
      degradation: 'warn',
    },
  };

  const planData = {
    code: TRIAL_DEFAULT_CODE,
    name: 'Trial Inicial',
    description:
      'Plan trial por defecto. Acceso completo a todas las funciones de IA durante el periodo de prueba global. Editable desde el panel super-admin.',
    plan_type: 'base' as const,
    state: 'active' as const,
    billing_cycle: 'monthly' as const,
    base_price: 0,
    currency: 'COP',
    grace_period_soft_days: 3,
    grace_period_hard_days: 7,
    suspension_day: 14,
    cancellation_day: 30,
    feature_matrix: featureMatrix,
    ai_feature_flags: aiFeatureFlags,
    resellable: false,
    is_free: true,
    is_promotional: false,
    promo_priority: 0,
    is_default: true,
    // Canonical trial plan MUST never carry a redemption_code. The CHECK
    // constraint `subscription_plans_redemption_code_only_promo` requires
    // redemption_code IS NULL OR plan_type='promotional' OR is_promotional=true.
    // Force NULL on every write so legacy rows are normalized on re-seed.
    redemption_code: null as string | null,
  };

  let plansCreated = 0;
  let plansUpdated = 0;

  // Transactional upsert with prior demotion of any other default plan.
  // Demote-first preserves the partial unique index invariant: at most one
  // active, non-archived plan with is_default=true.
  await client.$transaction(async (tx) => {
    const demoted = await tx.subscription_plans.updateMany({
      where: {
        is_default: true,
        state: 'active',
        archived_at: null,
        code: { not: TRIAL_DEFAULT_CODE },
      },
      data: { is_default: false },
    });
    if (demoted.count > 0) {
      console.log(
        `    Demoted ${demoted.count} existing default plan(s) (not '${TRIAL_DEFAULT_CODE}')`,
      );
    }

    const existing = await tx.subscription_plans.findUnique({
      where: { code: TRIAL_DEFAULT_CODE },
    });

    if (existing) {
      await tx.subscription_plans.update({
        where: { code: TRIAL_DEFAULT_CODE },
        data: {
          name: planData.name,
          description: planData.description,
          plan_type: planData.plan_type,
          state: planData.state,
          billing_cycle: planData.billing_cycle,
          base_price: planData.base_price,
          currency: planData.currency,
          grace_period_soft_days: planData.grace_period_soft_days,
          grace_period_hard_days: planData.grace_period_hard_days,
          suspension_day: planData.suspension_day,
          cancellation_day: planData.cancellation_day,
          feature_matrix: planData.feature_matrix,
          ai_feature_flags: planData.ai_feature_flags,
          resellable: planData.resellable,
          is_free: planData.is_free,
          is_promotional: planData.is_promotional,
          promo_priority: planData.promo_priority,
          is_default: planData.is_default,
          // Force NULL: canonical trial plan can never carry a redemption_code
          // and any legacy non-null value would violate the CHECK constraint.
          redemption_code: planData.redemption_code,
          updated_at: new Date(),
        },
      });
      plansUpdated++;
      console.log(`    Updated: ${TRIAL_DEFAULT_CODE} (is_default=true)`);
    } else {
      await tx.subscription_plans.create({
        data: planData,
      });
      plansCreated++;
      console.log(`    Created: ${TRIAL_DEFAULT_CODE} (is_default=true)`);
    }
  });

  return {
    plansCreated,
    plansUpdated,
    defaultPlanCode: TRIAL_DEFAULT_CODE,
  };
}
