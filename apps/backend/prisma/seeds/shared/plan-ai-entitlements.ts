import { Prisma, PrismaClient } from '@prisma/client';
// Seeds run with tsx inside the production image: the Dockerfile copies this
// catalog file next to lodging-roles.constant.ts. It has no imports.
import {
  AI_CAPABILITIES,
  aiCapabilityId,
  legacyFlagsToAIEntitlements,
} from '../../../src/domains/store/subscriptions/types/ai-capabilities';

type SeedClient = PrismaClient | Prisma.TransactionClient;

/**
 * Keep a seeded plan's `plan_ai_entitlements` in step with the
 * `ai_feature_flags` the seed writes (T11), through the same catalog
 * translation as migration 20261223100000_plan_ai_entitlements_backfill.
 *
 * `overwriteFeatures`: legacy feature keys whose rows are rewritten; rows of
 * every other feature are only created when missing, so an existing plan
 * keeps its superadmin configuration. Omit it to rewrite every row (seeds
 * that rewrite the whole JSON on each run).
 */
export async function syncSeedPlanAIEntitlements(
  client: SeedClient,
  planId: number,
  flags: unknown,
  overwriteFeatures?: readonly string[],
): Promise<number> {
  const rows = legacyFlagsToAIEntitlements(flags);
  for (const row of rows) {
    const def = AI_CAPABILITIES.find(
      (c) =>
        aiCapabilityId(c.agent_key, c.capability_key) ===
        aiCapabilityId(row.agent_key, row.capability_key),
    );
    const overwrite =
      !overwriteFeatures ||
      (def?.legacy != null && overwriteFeatures.includes(def.legacy.feature));
    const data = {
      enabled: row.enabled,
      cap_value: row.cap_value === null ? null : BigInt(row.cap_value),
      on_limit: row.on_limit,
    };
    await client.plan_ai_entitlements.upsert({
      where: {
        plan_id_agent_key_capability_key: {
          plan_id: planId,
          agent_key: row.agent_key,
          capability_key: row.capability_key,
        },
      },
      update: overwrite ? { ...data, updated_at: new Date() } : {},
      create: {
        plan_id: planId,
        agent_key: row.agent_key,
        capability_key: row.capability_key,
        ...data,
      },
    });
  }
  return rows.length;
}
