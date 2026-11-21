/**
 * Pure rules of the per-plan AI entitlements model (odd/tasks/vex-agente-avanzado.md
 * §3.11, T10). No I/O: the resolver, the shadow comparison, the superadmin
 * report and the plan dual-write (T12) all share these functions so the
 * model has one definition.
 *
 * Value semantics (N2): `cap_value` NULL = unlimited, 0 = nothing.
 */
import {
  AI_CAPABILITIES,
  AICapabilityDefinition,
  AIEntitlement,
  AIOnLimit,
  aiCapabilityHasCap,
  aiCapabilityId,
  defaultAIEntitlement,
  findAICapability,
  formatAICapValue,
  isAIAgentKey,
  legacyCapToCapValue,
  legacyFlagsToAIEntitlements,
} from '../types/ai-capabilities';

export type AIEntitlementDiffKind = 'divergence' | 'new_model_only';

/**
 * One capability where the legacy JSON and the entitlement rows give a
 * different decision.
 *
 * - `divergence`: the legacy field behind the decision disagrees with what
 *   the rows project onto it. Switching models would change behavior; the
 *   switch waits until there are none (T10 shadow criterion).
 * - `new_model_only`: the rows express something the legacy JSON cannot
 *   (a capability with no legacy source, or a per-agent split of a field the
 *   legacy model shares). Expected once the superadmin uses the new matrix.
 */
export interface AIEntitlementDiff {
  capability: string;
  kind: AIEntitlementDiffKind;
  legacy: string;
  current: string;
}

/** Legacy fields the rows own, per legacy feature key. */
export interface AILegacyProjectionEntry {
  /** Undefined when no gate row of this feature has a switch. */
  enabled?: boolean;
  /** cap_field → cap (NULL = unlimited, the legacy key is then removed). */
  caps: Record<string, number | null>;
  degradation: AIOnLimit;
}

export type AILegacyProjection = Record<string, AILegacyProjectionEntry>;

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function rowId(row: Pick<AIEntitlement, 'agent_key' | 'capability_key'>) {
  return aiCapabilityId(row.agent_key, row.capability_key);
}

function indexRows(
  rows: readonly AIEntitlement[],
): Map<string, AIEntitlement> {
  return new Map(rows.map((r) => [rowId(r), r]));
}

/** NULL = unlimited: the lower of two caps. */
export function minCapValue(a: number | null, b: number | null) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** NULL = unlimited: the higher of two caps (unlimited wins). */
export function maxCapValue(a: number | null, b: number | null) {
  if (a === null || b === null) return null;
  return Math.max(a, b);
}

/**
 * One row per catalog capability, in catalog order. A missing row takes the
 * matching `fallback` row (legacy-derived for a plan with partial rows) or
 * the catalog default; rows the catalog does not know are dropped.
 */
export function completeAIEntitlements(
  rows: readonly AIEntitlement[] | null | undefined,
  fallback?: readonly AIEntitlement[],
): AIEntitlement[] {
  const given = indexRows((rows ?? []).filter((r) => isAIAgentKey(r?.agent_key)));
  const backup = indexRows(fallback ?? []);
  return AI_CAPABILITIES.map((def) => {
    const id = aiCapabilityId(def.agent_key, def.capability_key);
    const row = given.get(id) ?? backup.get(id);
    if (!row) return defaultAIEntitlement(def);
    return {
      agent_key: def.agent_key,
      capability_key: def.capability_key,
      enabled: row.enabled === true,
      cap_value: normalizeCapValue(row.cap_value),
      on_limit: row.on_limit === 'warn' ? 'warn' : 'block',
    };
  });
}

/** BIGINT, number or numeric string → number; anything else (or negative) → NULL. */
export function normalizeCapValue(raw: unknown): number | null {
  if (typeof raw === 'string' && raw.trim() === '') return null;
  if (!['number', 'bigint', 'string'].includes(typeof raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/**
 * Partner override (`store_subscriptions.partner_override.feature_overrides`,
 * still a legacy JSON) as restriction rows. The legacy merge reads a present
 * feature without a boolean `enabled` as "keep the base" (`o.enabled ?? true`).
 */
export function partnerOverrideToPatch(raw: unknown): AIEntitlement[] {
  const root = asObject(raw);
  if (!root) return [];
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(root)) {
    const feature = asObject(value);
    if (!feature) continue;
    normalized[key] = {
      ...feature,
      enabled: typeof feature.enabled === 'boolean' ? feature.enabled : true,
    };
  }
  return legacyFlagsToAIEntitlements(normalized, 'patch');
}

/**
 * Partner restriction: a partner can only switch off and lower. Enabled is
 * AND, the cap is the lower one (NULL = unlimited), on_limit stays the base.
 */
export function applyPartnerRestriction(
  base: readonly AIEntitlement[],
  patch: readonly AIEntitlement[],
): AIEntitlement[] {
  const byId = indexRows(patch);
  return base.map((b) => {
    const p = byId.get(rowId(b));
    if (!p) return { ...b };
    return {
      ...b,
      enabled: b.enabled && p.enabled,
      cap_value: minCapValue(b.cap_value, p.cap_value),
    };
  });
}

/**
 * Promotional overlay: union of the higher. A promo row grants only when it
 * is on and its agent row is on in the promo plan (a promo without Vex never
 * touches Vex caps); it grants a switched-off base row with the promo terms;
 * both on keep the higher cap (unlimited wins) and the base on_limit.
 */
export function applyPromoOverlay(
  base: readonly AIEntitlement[],
  overlay: readonly AIEntitlement[],
): AIEntitlement[] {
  const byId = indexRows(overlay);
  const grants = (o: AIEntitlement) =>
    o.enabled &&
    (o.capability_key === 'agent' ||
      !findAICapability(o.agent_key, 'agent') ||
      byId.get(aiCapabilityId(o.agent_key, 'agent'))?.enabled === true);
  return base.map((b) => {
    const o = byId.get(rowId(b));
    if (!o || !grants(o)) return { ...b };
    if (!b.enabled) return { ...o };
    return {
      ...b,
      enabled: true,
      cap_value: maxCapValue(b.cap_value, o.cap_value),
    };
  });
}

/**
 * Legacy fields the rows own (T12 dual-write and the shadow classification).
 *
 * - Switch-only rows (`kind: 'toggle'`, e.g. Vex files) are new granularity:
 *   they never write a legacy field.
 * - `enabled` is the OR of the gate rows of a feature (one voice switch in the
 *   legacy JSON serves both agents).
 * - each cap field takes the higher cap of the rows that are on (all rows when
 *   none is on); NULL = unlimited wins.
 * - `degradation` is `block` when any of those rows blocks at the limit.
 */
export function projectAIEntitlementsToLegacy(
  rows: readonly AIEntitlement[],
): AILegacyProjection {
  const byId = indexRows(completeAIEntitlements(rows));
  const groups = new Map<
    string,
    Array<{ def: AICapabilityDefinition; row: AIEntitlement }>
  >();
  for (const def of AI_CAPABILITIES) {
    if (!def.legacy || def.kind === 'toggle') continue;
    const row = byId.get(aiCapabilityId(def.agent_key, def.capability_key))!;
    const list = groups.get(def.legacy.feature) ?? [];
    list.push({ def, row });
    groups.set(def.legacy.feature, list);
  }

  const out: AILegacyProjection = {};
  for (const [feature, members] of groups) {
    const gates = members.filter((m) => m.def.legacy!.enabled_from === 'feature');
    const live = members.filter((m) => m.row.enabled);
    const pool = live.length ? live : members;
    const caps: Record<string, number | null> = {};
    for (const m of members) {
      const field = m.def.legacy!.cap_field;
      if (!field || field in caps) continue;
      const sameField = pool.filter((p) => p.def.legacy!.cap_field === field);
      const candidates = sameField.length
        ? sameField
        : members.filter((p) => p.def.legacy!.cap_field === field);
      caps[field] = candidates
        .map((c) => c.row.cap_value)
        .reduce<number | null>((acc, v, i) => (i === 0 ? v : maxCapValue(acc, v)), null);
    }
    out[feature] = {
      ...(gates.length ? { enabled: gates.some((g) => g.row.enabled) } : {}),
      caps,
      degradation: pool.some((p) => p.row.on_limit === 'block') ? 'block' : 'warn',
    };
  }
  return out;
}

interface DecisionView {
  effective: boolean;
  cap: number | null;
  on_limit: AIOnLimit | null;
}

/**
 * What a gate decides for one capability: a row only counts when it is on and
 * its agent row (`<agent>.agent`, when the agent has one) is on too; a cap and
 * its on_limit only count for an effective capped row.
 */
function decisionOf(
  rows: Map<string, AIEntitlement>,
  def: AICapabilityDefinition,
): DecisionView {
  const row =
    rows.get(aiCapabilityId(def.agent_key, def.capability_key)) ??
    defaultAIEntitlement(def);
  const headDef = findAICapability(def.agent_key, 'agent');
  const headOn =
    !headDef ||
    def.capability_key === 'agent' ||
    rows.get(aiCapabilityId(def.agent_key, 'agent'))?.enabled === true;
  const effective = row.enabled && headOn;
  const capped = effective && aiCapabilityHasCap(def);
  return {
    effective,
    cap: capped ? row.cap_value : null,
    on_limit: capped ? row.on_limit : null,
  };
}

function describeDecision(def: AICapabilityDefinition, view: DecisionView) {
  if (!view.effective) return 'no incluido';
  if (!aiCapabilityHasCap(def)) return 'incluido';
  const limit = view.on_limit === 'block' ? 'bloquea' : 'avisa';
  return `${formatAICapValue(def, view.cap)}, ${limit} al llegar al tope`;
}

type Dimension = 'enabled' | 'cap' | 'on_limit';

function legacyFieldMismatch(
  def: AICapabilityDefinition,
  dims: Dimension[],
  legacyRoot: Record<string, unknown>,
  projection: AILegacyProjection,
): boolean {
  const enabledMismatch = (d: AICapabilityDefinition | undefined) => {
    if (!d?.legacy || d.kind === 'toggle' || d.legacy.enabled_from !== 'feature')
      return false;
    const projected = projection[d.legacy.feature]?.enabled;
    const actual = asObject(legacyRoot[d.legacy.feature])?.enabled === true;
    return projected !== undefined && projected !== actual;
  };
  if (!def.legacy) return false;
  const feature = asObject(legacyRoot[def.legacy.feature]);
  const entry = projection[def.legacy.feature];
  return dims.some((dim) => {
    if (dim === 'enabled') {
      const head =
        def.capability_key === 'agent'
          ? undefined
          : findAICapability(def.agent_key, 'agent');
      return enabledMismatch(def) || enabledMismatch(head);
    }
    if (!entry || def.kind === 'toggle') return false;
    if (dim === 'cap') {
      const field = def.legacy!.cap_field;
      if (!field || !(field in entry.caps)) return false;
      return entry.caps[field] !== legacyCapToCapValue(feature?.[field]);
    }
    const actual: AIOnLimit = feature?.degradation === 'block' ? 'block' : 'warn';
    return entry.degradation !== actual;
  });
}

/**
 * Compare the decision the legacy JSON gives with the one the rows give.
 * `only` narrows the capabilities (the runtime shadow compares the ones of
 * the legacy feature the gate is deciding).
 */
export function compareAIEntitlements(
  legacyFlags: unknown,
  rows: readonly AIEntitlement[],
  only?: (def: AICapabilityDefinition) => boolean,
): AIEntitlementDiff[] {
  const legacyRoot = asObject(legacyFlags) ?? {};
  const derived = indexRows(legacyFlagsToAIEntitlements(legacyRoot));
  const currentRows = completeAIEntitlements(rows);
  const current = indexRows(currentRows);
  const projection = projectAIEntitlementsToLegacy(currentRows);

  const diffs: AIEntitlementDiff[] = [];
  for (const def of AI_CAPABILITIES) {
    if (only && !only(def)) continue;
    const before = decisionOf(derived, def);
    const after = decisionOf(current, def);
    const dims: Dimension[] = [];
    if (before.effective !== after.effective) dims.push('enabled');
    else if (after.effective) {
      if (before.cap !== after.cap) dims.push('cap');
      if (before.on_limit !== after.on_limit) dims.push('on_limit');
    }
    if (!dims.length) continue;
    diffs.push({
      capability: aiCapabilityId(def.agent_key, def.capability_key),
      kind: legacyFieldMismatch(def, dims, legacyRoot, projection)
        ? 'divergence'
        : 'new_model_only',
      legacy: describeDecision(def, before),
      current: describeDecision(def, after),
    });
  }
  return diffs;
}

/** Stable signature of a diff list (log dedupe). */
export function aiEntitlementDiffSignature(diffs: AIEntitlementDiff[]): string {
  return diffs
    .map((d) => `${d.capability}:${d.kind}:${d.legacy}>${d.current}`)
    .join('|');
}
