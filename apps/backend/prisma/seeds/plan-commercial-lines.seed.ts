import { Prisma, PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';
import {
  PLAN_MATRIX,
  PlanLineId,
  planLineForCode,
} from '../../src/common/access/plan-modules';

/**
 * DEV ONLY — the four commercial lines sold in production (Impulsa,
 * Emprendedor, Empresarial Pro, IA Business) with their plan-module rules and
 * the recalibrated AI caps (odd/tasks/planes-matriz-accesos.md §5.1).
 *
 * Production already has these plans (created from the super-admin UI) and
 * gets its `plan_module_rules` from migration 20261110090000_plan_module_rules.
 * This file is registered only in `prisma/seed.ts`, never in
 * `seed-production.ts`: it must not touch production rows.
 *
 * AI caps: base = the exclusive annual plan (`acceso-exclusivo-annual`) for
 * Emprendedor, then the public-matrix multipliers: Impulsa ÷5, Emprendedor ×1,
 * Empresarial ×2, IA Business ×20. Rafael accepted the resulting (practically
 * unlimited) token caps on 2026-11-04.
 *
 * Idempotent: plans are upserted by `code`; rules use the unique
 * `(plan_id, module_key)` and are rewritten to the matrix mode.
 */

type Degradation = 'block' | 'warn';

interface AiCaps {
  text_tokens: number;
  vex_tokens: number;
  chat_daily: number;
  rag_docs: number;
  queue_jobs: number;
  voice_seconds: number;
  degradation: Degradation;
}

/** §5.1 table, verbatim. */
export const AI_CAPS_BY_LINE: Record<PlanLineId, AiCaps> = {
  impulsa: {
    text_tokens: 200_000_000,
    vex_tokens: 200_000_000,
    chat_daily: 20,
    rag_docs: 200,
    queue_jobs: 100,
    voice_seconds: 1_440,
    degradation: 'block',
  },
  emprendedor: {
    text_tokens: 999_999_999,
    vex_tokens: 1_000_000_000,
    chat_daily: 100,
    rag_docs: 1_000,
    queue_jobs: 500,
    voice_seconds: 7_200,
    degradation: 'warn',
  },
  empresarial: {
    text_tokens: 1_999_999_998,
    vex_tokens: 2_000_000_000,
    chat_daily: 200,
    rag_docs: 2_000,
    queue_jobs: 1_000,
    voice_seconds: 14_400,
    degradation: 'warn',
  },
  ia_business: {
    text_tokens: 19_999_999_980,
    vex_tokens: 20_000_000_000,
    chat_daily: 2_000,
    rag_docs: 20_000,
    queue_jobs: 10_000,
    voice_seconds: 144_000,
    degradation: 'warn',
  },
};

export function aiFeatureFlagsFor(line: PlanLineId): Prisma.InputJsonObject {
  const caps = AI_CAPS_BY_LINE[line];
  const degradation = caps.degradation;
  return {
    text_generation: {
      enabled: true,
      monthly_tokens_cap: caps.text_tokens,
      degradation,
    },
    streaming_chat: {
      enabled: true,
      daily_messages_cap: caps.chat_daily,
      degradation,
    },
    conversations: { enabled: true, retention_days: 365, degradation },
    tool_agents: { enabled: true, tools_allowed: ['*'], degradation },
    rag_embeddings: {
      enabled: true,
      indexed_docs_cap: caps.rag_docs,
      degradation,
    },
    async_queue: {
      enabled: true,
      monthly_jobs_cap: caps.queue_jobs,
      degradation,
    },
    realtime_voice: {
      enabled: true,
      monthly_voice_seconds_cap: caps.voice_seconds,
      degradation,
    },
    vex_agent: {
      enabled: true,
      monthly_tokens_cap: caps.vex_tokens,
      daily_messages_cap: caps.chat_daily,
      degradation,
    },
  };
}

interface CommercialPlan {
  code: string;
  line: PlanLineId;
  name: string;
  description: string;
  base_price: number;
  sort_order: number;
  is_ai_plan: boolean;
  is_popular: boolean;
  feature_matrix: Prisma.InputJsonValue;
}

const COMMERCIAL_PLANS: CommercialPlan[] = [
  {
    code: 'vendix-impulsa',
    line: 'impulsa',
    name: 'Vendix Impulsa',
    description:
      'Usuarios limitados a 1 por sesión, 2 industrias por tienda, sin facturación electrónica. IA con límites.',
    base_price: 49_900,
    sort_order: 5,
    is_ai_plan: false,
    is_popular: false,
    feature_matrix: [
      { key: 'usuarios-limitados-a-1-por-sesion', label: 'Usuarios limitados a 1 por sesión', enabled: true },
      { key: 'industrias-limitadas-a-2-por-tienda', label: 'Industrias limitadas a 2 por tienda', enabled: true },
      { key: 'facturacion-electronica', label: 'Facturación electrónica', enabled: false },
      { key: 'herramientas-y-agentes-de-ia-con-limites', label: 'Herramientas y Agentes de IA con límites', enabled: true },
    ],
  },
  {
    code: 'emprendedor-pro-monthly',
    line: 'emprendedor',
    name: 'Emprendedor',
    description:
      'Usuarios e industrias ilimitados, sin facturación electrónica ni contabilidad automatizada. IA extendida x5.',
    base_price: 69_900,
    sort_order: 6,
    is_ai_plan: false,
    is_popular: false,
    feature_matrix: [
      { key: 'usuarios-ilimitados', label: 'Usuarios ilimitados', enabled: true },
      { key: 'industrias-ilimitadas', label: 'Industrias ilimitadas', enabled: true },
      { key: 'facturacion-electronica', label: 'Facturación electrónica', enabled: false },
      { key: 'contabilidad-automatizada', label: 'Contabilidad automatizada', enabled: false },
      { key: 'ia-extendida-x5', label: 'IA extendida x5', enabled: true },
    ],
  },
  {
    code: 'empresarial-pro-monthly',
    line: 'empresarial',
    name: 'Empresarial Pro',
    description:
      'Todo Emprendedor + facturación electrónica ilimitada + contabilidad automatizada + IA x10.',
    base_price: 89_900,
    sort_order: 7,
    is_ai_plan: false,
    is_popular: true,
    feature_matrix: [
      { key: 'todo-lo-de-emprendedor', label: 'Todo lo de Emprendedor', enabled: true },
      { key: 'facturacion-electronica-ilimitada', label: 'Facturación electrónica ilimitada', enabled: true },
      { key: 'contabilidad-automatizada', label: 'Contabilidad automatizada', enabled: true },
      { key: 'herramientas-y-agentes-de-ia-x10', label: 'Herramientas y Agentes de IA x10', enabled: true },
    ],
  },
  {
    code: 'ia-business',
    line: 'ia_business',
    name: 'IA Business',
    description:
      'Todo Empresarial Pro + IA x100 + Flujos Automatizados impulsados con IA + Documentación Avanzada con IA integrada.',
    base_price: 190_000,
    sort_order: 8,
    is_ai_plan: true,
    is_popular: false,
    feature_matrix: [
      { key: 'todo-lo-de-empresarial-pro', label: 'Todo lo de Empresarial Pro', enabled: true },
      { key: 'herramientas-y-agentes-de-ia-x100', label: 'Herramientas y Agentes de IA x100', enabled: true },
      { key: 'flujos-automatizados-impulsados-con-ia', label: 'Flujos Automatizados impulsados con IA', enabled: true },
      { key: 'documentacion-avanzada-con-ia-integrada', label: 'Documentación Avanzada con IA integrada', enabled: true },
    ],
  },
];

export interface SeedPlanCommercialLinesResult {
  plans: number;
  rules: number;
}

export async function seedPlanCommercialLines(
  prisma?: PrismaClient,
): Promise<SeedPlanCommercialLinesResult> {
  const client = prisma || getPrismaClient();
  console.log('  Seeding commercial plan lines + plan_module_rules (dev)...');

  for (const plan of COMMERCIAL_PLANS) {
    const data = {
      name: plan.name,
      description: plan.description,
      plan_type: 'base' as const,
      state: 'active' as const,
      billing_cycle: 'monthly' as const,
      base_price: plan.base_price,
      currency: 'COP',
      feature_matrix: plan.feature_matrix,
      ai_feature_flags: aiFeatureFlagsFor(plan.line),
      resellable: true,
      is_free: false,
      is_promotional: false,
      is_popular: plan.is_popular,
      is_ai_plan: plan.is_ai_plan,
      sort_order: plan.sort_order,
      is_default: false,
      redemption_code: null,
      plan_group_code: plan.line,
    };
    await client.subscription_plans.upsert({
      where: { code: plan.code },
      update: { ...data, updated_at: new Date() },
      create: { code: plan.code, ...data },
    });
  }

  // Rules for every non-promotional, non-archived plan of a commercial line
  // (dev may also carry quarterly/annual copies of a line).
  const plans = await client.subscription_plans.findMany({
    where: {
      archived_at: null,
      is_promotional: false,
      plan_type: { not: 'promotional' },
    },
    select: { id: true, code: true },
  });

  let rules = 0;
  for (const plan of plans) {
    const line = planLineForCode(plan.code);
    if (!line) continue;
    const entries = [
      ...line.blocked.map((key) => ({ key, mode: 'blocked' as const })),
      ...line.exclusive.map((key) => ({ key, mode: 'exclusive' as const })),
    ];
    for (const entry of entries) {
      await client.plan_module_rules.upsert({
        where: {
          plan_id_module_key: { plan_id: plan.id, module_key: entry.key },
        },
        update: { mode: entry.mode },
        create: { plan_id: plan.id, module_key: entry.key, mode: entry.mode },
      });
      rules++;
    }
  }

  console.log(
    `  Commercial lines: ${COMMERCIAL_PLANS.length} plans, ${rules} rules (matrix: ${PLAN_MATRIX.length} lines).`,
  );
  return { plans: COMMERCIAL_PLANS.length, rules };
}
