import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaClient } from './shared/client';

/**
 * Subscription Plans Production Seed — CANONICAL plans for Vendix SaaS
 *
 * ⚠️  CRITICAL: These are the CANONICAL production plans (starter / pro / enterprise).
 * They are seeded into ALL environments (dev / staging / prod) so plan codes,
 * pricing, and feature_matrix stay aligned across environments — eliminating
 * the historical drift caused by creating plans manually via the super-admin UI.
 *
 * Idempotency: each plan is upserted by its unique `code`. Re-running the seed
 * will UPDATE pricing / description / features / margin / billing on existing
 * rows but will NEVER duplicate. FKs from `store_subscriptions.plan_id` are
 * preserved because the row id never changes.
 *
 * 🚨 Modifying prices here REQUIRES coordination with:
 *   - Marketing (public price changes)
 *   - Finance (review historical invoices already emitted at the old price;
 *     historical invoices are immutable, only NEW billing periods will use the
 *     new `base_price`)
 *   - Partners (max_partner_margin_pct affects rev-share split)
 *
 * Currency: COP (Colombian Pesos), all amounts in cents-free Decimal(12,2).
 *
 * State: all plans are seeded with state='active' and archived_at=null.
 * Use the super-admin UI to archive plans you want to retire — DO NOT delete
 * rows here, archived plans must remain queryable for historical billing.
 *
 * NOT seeded by this file (TODO when models exist):
 *   - subscription_plan_features (currently feature_matrix JSON is the source of truth)
 *   - partner_plan_overrides (created on-demand by partners; not canonical)
 */

export interface SeedSubscriptionPlansProductionResult {
  plansCreated: number;
  plansUpdated: number;
  planCodes: string[];
}

type CanonicalPlan = {
  code: string;
  name: string;
  description: string;
  base_price: number;
  billing_cycle: 'monthly' | 'annual';
  max_partner_margin_pct: number;
  feature_matrix: Prisma.InputJsonValue;
  ai_feature_flags: Prisma.InputJsonValue;
  sort_order: number;
  is_popular: boolean;
};

const CANONICAL_PLANS: CanonicalPlan[] = [
  {
    code: 'starter',
    name: 'Starter',
    description:
      'Plan ideal para tiendas pequenas que estan comenzando. Incluye catalogo basico, una tienda y soporte por email.',
    base_price: 49000.0,
    billing_cycle: 'monthly',
    max_partner_margin_pct: 20.0,
    sort_order: 10,
    is_popular: false,
    feature_matrix: {
      pos: true,
      ecommerce: true,
      accounting: true,
      inventory: true,
      stores: { max: 1 },
      users: { max: 3 },
      support: { channel: 'email', sla_hours: 48 },
    },
    ai_feature_flags: {
      text_generation: {
        enabled: false,
        monthly_tokens_cap: 0,
        degradation: 'block',
      },
      streaming_chat: {
        enabled: false,
        daily_messages_cap: 0,
        degradation: 'block',
      },
      conversations: {
        enabled: false,
        retention_days: 0,
        degradation: 'block',
      },
      tool_agents: {
        enabled: false,
        tools_allowed: [],
        degradation: 'block',
      },
      rag_embeddings: {
        enabled: false,
        indexed_docs_cap: 0,
        degradation: 'block',
      },
      async_queue: {
        enabled: false,
        monthly_jobs_cap: 0,
        degradation: 'block',
      },
    },
  },
  {
    code: 'pro',
    name: 'Pro',
    description:
      'Plan completo para tiendas en crecimiento. Inventario avanzado, multi-tienda (hasta 3), IA basica y soporte prioritario.',
    base_price: 119000.0,
    billing_cycle: 'monthly',
    max_partner_margin_pct: 25.0,
    sort_order: 20,
    is_popular: true,
    feature_matrix: {
      pos: true,
      ecommerce: true,
      accounting: true,
      inventory: true,
      inventory_advanced: true,
      stores: { max: 3 },
      users: { max: 10 },
      support: { channel: 'priority', sla_hours: 12 },
    },
    ai_feature_flags: {
      text_generation: {
        enabled: true,
        monthly_tokens_cap: 250000,
        degradation: 'warn',
      },
      streaming_chat: {
        enabled: true,
        daily_messages_cap: 200,
        degradation: 'warn',
      },
      conversations: {
        enabled: true,
        retention_days: 90,
        degradation: 'warn',
      },
      tool_agents: {
        enabled: true,
        tools_allowed: ['inventory', 'customers', 'orders'],
        degradation: 'warn',
      },
      rag_embeddings: {
        enabled: true,
        indexed_docs_cap: 1000,
        degradation: 'warn',
      },
      async_queue: {
        enabled: true,
        monthly_jobs_cap: 1000,
        degradation: 'warn',
      },
    },
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description:
      'Plan anual para operaciones consolidadas. Tiendas y usuarios ilimitados, IA ilimitada, integraciones avanzadas y soporte dedicado.',
    base_price: 1290000.0,
    billing_cycle: 'annual',
    max_partner_margin_pct: 30.0,
    sort_order: 30,
    is_popular: false,
    feature_matrix: {
      pos: true,
      ecommerce: true,
      accounting: true,
      inventory: true,
      inventory_advanced: true,
      stores: { max: null },
      users: { max: 50 },
      integrations: { enabled: true },
      support: { channel: 'dedicated', sla_hours: 4 },
    },
    ai_feature_flags: {
      text_generation: {
        enabled: true,
        monthly_tokens_cap: null,
        degradation: 'warn',
      },
      streaming_chat: {
        enabled: true,
        daily_messages_cap: null,
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
        indexed_docs_cap: null,
        degradation: 'warn',
      },
      async_queue: {
        enabled: true,
        monthly_jobs_cap: null,
        degradation: 'warn',
      },
    },
  },
];

export async function seedSubscriptionPlansProduction(
  prisma?: PrismaClient,
): Promise<SeedSubscriptionPlansProductionResult> {
  const client = prisma || getPrismaClient();
  console.log(
    '  Seeding canonical SaaS subscription plans (starter / pro / enterprise)...',
  );

  let plansCreated = 0;
  let plansUpdated = 0;
  const planCodes: string[] = [];

  for (const plan of CANONICAL_PLANS) {
    const existing = await client.subscription_plans.findUnique({
      where: { code: plan.code },
    });

    const writeData = {
      name: plan.name,
      description: plan.description,
      plan_type: 'base' as const,
      state: 'active' as const,
      billing_cycle: plan.billing_cycle,
      base_price: plan.base_price,
      currency: 'COP',
      feature_matrix: plan.feature_matrix,
      ai_feature_flags: plan.ai_feature_flags,
      max_partner_margin_pct: plan.max_partner_margin_pct,
      resellable: true,
      is_free: false,
      is_promotional: false,
      promo_priority: 0,
      is_popular: plan.is_popular,
      sort_order: plan.sort_order,
      is_default: false,
    };

    if (existing) {
      await client.subscription_plans.update({
        where: { code: plan.code },
        data: {
          ...writeData,
          // Only un-archive if currently archived; do NOT touch archived_at
          // when it is already null to keep the timestamp invariant.
          ...(existing.archived_at ? { archived_at: null } : {}),
          updated_at: new Date(),
        },
      });
      plansUpdated++;
      console.log(
        `    Updated: ${plan.code} (${plan.name}, ${plan.billing_cycle}, ${plan.base_price} COP)`,
      );
    } else {
      await client.subscription_plans.create({
        data: {
          code: plan.code,
          ...writeData,
        },
      });
      plansCreated++;
      console.log(
        `    Created: ${plan.code} (${plan.name}, ${plan.billing_cycle}, ${plan.base_price} COP)`,
      );
    }
    planCodes.push(plan.code);
  }

  console.log(
    `  Canonical plans: ${plansCreated} created, ${plansUpdated} updated (total ${CANONICAL_PLANS.length}).`,
  );

  return {
    plansCreated,
    plansUpdated,
    planCodes,
  };
}
