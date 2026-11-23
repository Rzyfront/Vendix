import { Prisma } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  AI_CAPABILITIES,
  AIEntitlement,
  aiCapAcceptsZero,
  aiCapabilityHasCap,
  aiCapabilityId,
  findAICapability,
  legacyFlagsToAIEntitlements,
} from '../../../store/subscriptions/types/ai-capabilities';
import { planAIEntitlements } from '../../../store/subscriptions/services/ai-entitlements.logic';

/**
 * T12 — writes of `plan_ai_entitlements` from the superadmin plan screens.
 * While the gate still decides with `ai_feature_flags` (shadow mode, T10),
 * every save keeps both models in step: `ai_entitlements` rewrites the legacy
 * fields it owns, and a legacy-only save rewrites the rows of the features
 * whose JSON changed.
 */

/** `ai_entitlements` row as the DTO receives it. */
export interface PlanAIEntitlementInput {
  agent_key: string;
  capability_key: string;
  enabled: boolean;
  cap_value?: number | null;
  on_limit: string;
}

type PlanAIEntitlementClient = Pick<
  Prisma.TransactionClient,
  'plan_ai_entitlements'
>;

/**
 * `ai_entitlements` checked against the catalog before any write: an unknown
 * or repeated agent/capability pair, a number on a capability without a cap,
 * or a 0 the legacy gate cannot enforce (`aiCapAcceptsZero`) is a 400
 * (SUBSCRIPTION_VALIDATION), never dropped in silence.
 * `undefined` = the caller did not send the field.
 */
export function parsePlanAIEntitlements(
  rows: readonly PlanAIEntitlementInput[] | undefined,
): AIEntitlement[] | undefined {
  if (rows === undefined) return undefined;
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const row of rows) {
    const id = aiCapabilityId(row.agent_key, row.capability_key);
    const def = findAICapability(row.agent_key, row.capability_key);
    if (!def) problems.push(`${id} is not an AI capability`);
    else if (seen.has(id)) problems.push(`${id} is repeated`);
    else if (!aiCapabilityHasCap(def) && row.cap_value != null) {
      problems.push(`${id} does not take a cap`);
    } else if (
      row.cap_value === 0 &&
      !aiCapAcceptsZero(def, row.on_limit as AIEntitlement['on_limit'])
    ) {
      // The legacy gate still decides and reads a 0 there as unlimited.
      problems.push(
        `${id} cannot take a cap of 0 (it would not be enforced); set a positive cap or switch it off`,
      );
    }
    seen.add(id);
  }
  if (problems.length) {
    throw new VendixHttpException(
      ErrorCodes.SUBSCRIPTION_VALIDATION,
      `Invalid ai_entitlements: ${problems.join('; ')}`,
      { field: 'ai_entitlements' },
    );
  }
  return rows.map((row) => ({
    agent_key: row.agent_key as AIEntitlement['agent_key'],
    capability_key: row.capability_key,
    enabled: row.enabled,
    cap_value: row.cap_value ?? null,
    on_limit: row.on_limit as AIEntitlement['on_limit'],
  }));
}

/** Column values of one row (BIGINT cap). */
export function aiEntitlementRowData(row: AIEntitlement) {
  return {
    agent_key: row.agent_key,
    capability_key: row.capability_key,
    enabled: row.enabled,
    cap_value: row.cap_value === null ? null : BigInt(row.cap_value),
    on_limit: row.on_limit,
  };
}

/** Legacy features whose JSON differs between two `ai_feature_flags`. */
export function changedLegacyFeatures(
  before: unknown,
  after: unknown,
): Set<string> {
  const changed = new Set<string>();
  for (const def of AI_CAPABILITIES) {
    const feature = def.legacy?.feature;
    if (!feature || changed.has(feature)) continue;
    if (stableJson(featureOf(before, feature)) !== stableJson(featureOf(after, feature))) {
      changed.add(feature);
    }
  }
  return changed;
}

/** Catalog ids of the rows whose legacy feature is in `features`. */
export function aiCapabilityIdsOfFeatures(features: Set<string>): Set<string> {
  return new Set(
    AI_CAPABILITIES.filter(
      (def) => def.legacy && features.has(def.legacy.feature),
    ).map((def) => aiCapabilityId(def.agent_key, def.capability_key)),
  );
}

/**
 * Rows a legacy-only save leaves on a plan: the stored rows, with the rows of
 * changed features replaced by the legacy translation of the new JSON.
 */
export function rowsAfterLegacySave(
  stored: readonly AIEntitlement[],
  persistedFlags: unknown,
  nextFlags: unknown,
): { rows: AIEntitlement[]; overwrite: Set<string> } {
  const overwrite = aiCapabilityIdsOfFeatures(
    changedLegacyFeatures(persistedFlags, nextFlags),
  );
  const legacy = new Map(
    legacyFlagsToAIEntitlements(nextFlags).map((r) => [
      aiCapabilityId(r.agent_key, r.capability_key),
      r,
    ]),
  );
  const rows = stored.map((row) => {
    const id = aiCapabilityId(row.agent_key, row.capability_key);
    return overwrite.has(id) ? (legacy.get(id) ?? row) : row;
  });
  return { rows, overwrite };
}

/** The 11 rows of a stored plan (table, or legacy translation when it has none). */
export async function loadPlanAIEntitlements(
  client: PlanAIEntitlementClient,
  planId: number,
  flags: unknown,
): Promise<AIEntitlement[]> {
  const stored = await client.plan_ai_entitlements.findMany({
    where: { plan_id: planId },
    select: {
      agent_key: true,
      capability_key: true,
      enabled: true,
      cap_value: true,
      on_limit: true,
    },
  });
  return planAIEntitlements(flags, stored).rows;
}

function rowUpsert(
  planId: number,
  row: AIEntitlement,
  overwrite: Set<string> | undefined,
) {
  const data = aiEntitlementRowData(row);
  const rewrite =
    !overwrite || overwrite.has(aiCapabilityId(row.agent_key, row.capability_key));
  return {
    where: {
      plan_id_agent_key_capability_key: {
        plan_id: planId,
        agent_key: row.agent_key,
        capability_key: row.capability_key,
      },
    },
    update: rewrite
      ? {
          enabled: data.enabled,
          cap_value: data.cap_value,
          on_limit: data.on_limit,
          updated_at: new Date(),
        }
      : {},
    data,
  };
}

/**
 * Upsert the rows of one plan. Missing rows are always created; an existing
 * row is rewritten only when `overwrite` is omitted or lists its id.
 */
export async function upsertPlanAIEntitlements(
  client: PlanAIEntitlementClient,
  planId: number,
  rows: readonly AIEntitlement[],
  overwrite?: Set<string>,
): Promise<void> {
  for (const row of rows) {
    const { where, update, data } = rowUpsert(planId, row, overwrite);
    await client.plan_ai_entitlements.upsert({
      where,
      update,
      create: { plan_id: planId, ...data },
    });
  }
}

/**
 * The same upserts as a nested write of `subscription_plans.update`
 * (`ai_entitlements: { upsert }`), so a single-row save stays one statement.
 */
export function nestedPlanAIEntitlementUpserts(
  planId: number,
  rows: readonly AIEntitlement[],
  overwrite?: Set<string>,
) {
  return rows.map((row) => {
    const { where, update, data } = rowUpsert(planId, row, overwrite);
    return { where, update, create: data };
  });
}

function featureOf(flags: unknown, feature: string): unknown {
  return flags && typeof flags === 'object' && !Array.isArray(flags)
    ? (flags as Record<string, unknown>)[feature]
    : undefined;
}

/** JSON with sorted keys, so key order never counts as a change. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
