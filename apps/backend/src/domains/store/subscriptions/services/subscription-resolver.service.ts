import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  AIFeatureKey,
  AI_FEATURE_KEYS,
  FeatureConfig,
  ResolvedFeatures,
  ResolvedSubscription,
} from '../types/access.types';

const CACHE_PREFIX = 'sub:features';
const CACHE_TTL_SECONDS = 60;

interface CachedPayload {
  /**
   * Serialized ResolvedSubscription. Dates serialized as ISO strings.
   */
  found: boolean;
  storeId: number;
  state: ResolvedSubscription['state'] | null;
  planId: number | null;
  planCode: string | null;
  partnerOrgId: number | null;
  overlayActive: boolean;
  overlayExpiresAt: string | null;
  features: ResolvedFeatures;
  gracePeriodSoftDays: number;
  gracePeriodHardDays: number;
  currentPeriodEnd: string | null;
}

/**
 * Validates storeId is a safe positive integer. Throws if invalid.
 * Prevents Redis key injection and malformed DB queries.
 */
function assertValidStoreId(storeId: number): asserts storeId is number {
  if (
    !Number.isInteger(storeId) ||
    storeId <= 0 ||
    storeId > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(`Invalid storeId: ${storeId}`);
  }
}

/**
 * Materializes the effective AI feature flags for a store's subscription.
 *
 * Resolution order:
 *   1. Start from base `plan.ai_feature_flags`.
 *   2. Apply partner override as **restriction-only** (never enables features
 *      above base, never raises caps). Enforced via min()/AND semantics.
 *   3. If promo overlay is active, apply as **union-of-max** (OR for booleans,
 *      max() for numeric caps). Promos never subtract base features.
 *
 * Overlay expiry contract (CRITICAL — do NOT use current_period_end):
 *   overlay_active = (promotional_plan_id IS NOT NULL) &&
 *                    (now < promotional_applied_at + promo_rules.duration_days)
 *
 * Caching: Redis `sub:features:{storeId}` with 60s TTL. Write-through on miss.
 */
@Injectable()
export class SubscriptionResolverService {
  private readonly logger = new Logger(SubscriptionResolverService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async resolveSubscription(storeId: number): Promise<ResolvedSubscription> {
    assertValidStoreId(storeId);

    const cached = await this.readCache(storeId);
    if (cached) return cached;

    const resolved = await this.resolveFromDatabase(storeId);
    await this.writeCache(storeId, resolved);
    return resolved;
  }

  async invalidate(storeId: number): Promise<void> {
    assertValidStoreId(storeId);
    try {
      await this.redis.del(this.cacheKey(storeId));
    } catch (err) {
      // Best-effort invalidation. Downstream TTL (60s) bounds staleness.
      this.logger.warn(
        `Failed to invalidate subscription cache for store ${storeId}: ${(err as Error).message}`,
      );
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private cacheKey(storeId: number): string {
    return `${CACHE_PREFIX}:${storeId}`;
  }

  private async readCache(
    storeId: number,
  ): Promise<ResolvedSubscription | null> {
    try {
      const raw = await this.redis.get(this.cacheKey(storeId));
      if (!raw) return null;
      const payload = JSON.parse(raw) as CachedPayload;
      return {
        found: payload.found,
        storeId: payload.storeId,
        state: payload.state ?? 'draft',
        planId: payload.planId ?? null,
        planCode: payload.planCode ?? '',
        partnerOrgId: payload.partnerOrgId,
        overlayActive: payload.overlayActive,
        overlayExpiresAt: payload.overlayExpiresAt
          ? new Date(payload.overlayExpiresAt)
          : null,
        features: payload.features,
        gracePeriodSoftDays: payload.gracePeriodSoftDays,
        gracePeriodHardDays: payload.gracePeriodHardDays,
        currentPeriodEnd: payload.currentPeriodEnd
          ? new Date(payload.currentPeriodEnd)
          : null,
      };
    } catch (err) {
      this.logger.warn(
        `Cache read failure for store ${storeId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async writeCache(
    storeId: number,
    resolved: ResolvedSubscription,
  ): Promise<void> {
    try {
      const payload: CachedPayload = {
        found: resolved.found,
        storeId: resolved.storeId,
        state: resolved.state,
        planId: resolved.planId,
        planCode: resolved.planCode,
        partnerOrgId: resolved.partnerOrgId,
        overlayActive: resolved.overlayActive,
        overlayExpiresAt: resolved.overlayExpiresAt
          ? resolved.overlayExpiresAt.toISOString()
          : null,
        features: resolved.features,
        gracePeriodSoftDays: resolved.gracePeriodSoftDays,
        gracePeriodHardDays: resolved.gracePeriodHardDays,
        currentPeriodEnd: resolved.currentPeriodEnd
          ? resolved.currentPeriodEnd.toISOString()
          : null,
      };
      await this.redis.set(
        this.cacheKey(storeId),
        JSON.stringify(payload),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Cache write failure for store ${storeId}: ${(err as Error).message}`,
      );
    }
  }

  private async resolveFromDatabase(
    storeId: number,
  ): Promise<ResolvedSubscription> {
    // This service IS the tenant boundary for subscription data — use
    // GlobalPrismaService directly with explicit store_id filter.
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      include: {
        plan: true,
        promotional_plan: true,
        partner_override: {
          include: { base_plan: true },
        },
      },
    });

    if (!sub) {
      return {
        found: false,
        storeId,
        // Defaults for consumers that still want to check state without
        // first branching on `found`. The gate will interpret missing subs
        // via the `found: false` flag.
        state: 'draft',
        planId: null,
        planCode: '',
        partnerOrgId: null,
        overlayActive: false,
        overlayExpiresAt: null,
        features: {},
        gracePeriodSoftDays: 0,
        gracePeriodHardDays: 0,
        currentPeriodEnd: null,
      };
    }

    // RNC-39: stores in 'no_plan' state have no plan assigned. Surface empty
    // features so the gate blocks all feature usage and consumers see a clear
    // "no plan" signal rather than leaking placeholder plan info.
    if (!sub.plan_id || !sub.plan) {
      return {
        found: true,
        storeId,
        state: sub.state,
        planId: null,
        planCode: '',
        partnerOrgId: sub.partner_override?.organization_id ?? null,
        overlayActive: false,
        overlayExpiresAt: null,
        features: {},
        gracePeriodSoftDays: 0,
        gracePeriodHardDays: 0,
        currentPeriodEnd: sub.current_period_end,
      };
    }

    const baseFeatures = this.coerceFeatures(sub.plan.ai_feature_flags);
    let features: ResolvedFeatures = baseFeatures;

    // 2. Partner override: restriction-only. Never enable above base, never
    //    raise numeric caps.
    if (sub.partner_override?.feature_overrides) {
      features = this.applyPartnerRestriction(
        features,
        this.coerceFeatures(sub.partner_override.feature_overrides),
      );
    }

    // 3. Overlay (if active): union-of-max.
    const { overlayActive, overlayExpiresAt } = this.computeOverlayState(
      sub.promotional_plan?.promo_rules ?? null,
      sub.promotional_applied_at,
    );

    if (overlayActive && sub.promotional_plan) {
      const overlay = this.coerceFeatures(
        sub.promotional_plan.ai_feature_flags,
      );
      features = this.applyOverlayUnion(features, overlay);
    }

    // Persist resolved_features snapshot if stale relative to source rows.
    // This is a best-effort denormalization; the source of truth for the gate
    // remains the live resolution above.
    await this.maybeSnapshotResolved(sub, features);

    return {
      found: true,
      storeId,
      state: sub.state,
      planId: sub.plan_id,
      planCode: sub.plan.code,
      partnerOrgId: sub.partner_override?.organization_id ?? null,
      overlayActive,
      overlayExpiresAt,
      features,
      gracePeriodSoftDays: sub.plan.grace_period_soft_days,
      gracePeriodHardDays: sub.plan.grace_period_hard_days,
      currentPeriodEnd: sub.current_period_end,
    };
  }

  /**
   * Coerce arbitrary JSON into ResolvedFeatures, constrained to known
   * AIFeatureKey entries. Silently drops unknown keys for forward-compat.
   */
  private coerceFeatures(raw: unknown): ResolvedFeatures {
    const out: ResolvedFeatures = {};
    if (!raw || typeof raw !== 'object') return out;
    const obj = raw as Record<string, unknown>;
    for (const key of AI_FEATURE_KEYS) {
      const value = obj[key];
      if (value && typeof value === 'object') {
        out[key] = value as FeatureConfig;
      }
    }
    return out;
  }

  /**
   * Apply partner override as a restriction-only patch.
   * - boolean.enabled: result = base AND override (never enable if base=false)
   * - numeric caps: result = min(base, override) when both set
   * - tools_allowed: result = intersection(base, override) when both set
   * - missing keys in override: passthrough base
   */
  private applyPartnerRestriction(
    base: ResolvedFeatures,
    override: ResolvedFeatures,
  ): ResolvedFeatures {
    const result: ResolvedFeatures = {};
    for (const key of AI_FEATURE_KEYS) {
      const b = base[key];
      const o = override[key];
      if (!b) continue; // nothing to carry forward

      if (!o) {
        result[key] = { ...b };
        continue;
      }

      const merged: FeatureConfig = {
        enabled: b.enabled && (o.enabled ?? true), // partner can only DISABLE
        degradation: b.degradation,
      };

      // Numeric caps: take min of defined values (partner can only LOWER).
      const capFields: Array<keyof FeatureConfig> = [
        'monthly_tokens_cap',
        'daily_messages_cap',
        'retention_days',
        'indexed_docs_cap',
        'monthly_jobs_cap',
      ];
      for (const f of capFields) {
        const bv = b[f];
        const ov = o[f];
        if (typeof bv === 'number' && typeof ov === 'number') {
          (merged as any)[f] = Math.min(bv, ov);
        } else if (typeof bv === 'number') {
          (merged as any)[f] = bv;
        }
        // If partner sets a cap where base had none, IGNORE (can't raise).
      }

      // tools_allowed: intersection if both defined.
      if (Array.isArray(b.tools_allowed) && Array.isArray(o.tools_allowed)) {
        const oSet = new Set(o.tools_allowed);
        merged.tools_allowed = b.tools_allowed.filter((t) => oSet.has(t));
      } else if (Array.isArray(b.tools_allowed)) {
        merged.tools_allowed = b.tools_allowed;
      }

      if (b.period) merged.period = b.period;

      result[key] = merged;
    }
    return result;
  }

  /**
   * Apply promo overlay as union-of-max.
   * - boolean.enabled: result = base OR overlay
   * - numeric caps: result = max(base, overlay)
   * - tools_allowed: result = union(base, overlay)
   * - missing keys in overlay: passthrough base
   * - missing keys in base but present in overlay: add as new feature
   */
  private applyOverlayUnion(
    base: ResolvedFeatures,
    overlay: ResolvedFeatures,
  ): ResolvedFeatures {
    const result: ResolvedFeatures = {};
    for (const key of AI_FEATURE_KEYS) {
      const b = base[key];
      const o = overlay[key];

      if (!b && !o) continue;

      if (b && !o) {
        result[key] = { ...b };
        continue;
      }

      if (!b && o) {
        // Overlay introduces a feature the base didn't declare; passthrough.
        result[key] = { ...o };
        continue;
      }

      // Both present: union-of-max.
      const merged: FeatureConfig = {
        enabled: (b!.enabled ?? false) || (o!.enabled ?? false),
        degradation: b!.degradation ?? o!.degradation,
      };

      const capFields: Array<keyof FeatureConfig> = [
        'monthly_tokens_cap',
        'daily_messages_cap',
        'retention_days',
        'indexed_docs_cap',
        'monthly_jobs_cap',
      ];
      for (const f of capFields) {
        const bv = b![f];
        const ov = o![f];
        if (typeof bv === 'number' && typeof ov === 'number') {
          (merged as any)[f] = Math.max(bv, ov);
        } else if (typeof bv === 'number') {
          (merged as any)[f] = bv;
        } else if (typeof ov === 'number') {
          (merged as any)[f] = ov;
        }
      }

      const bTools = Array.isArray(b!.tools_allowed) ? b!.tools_allowed : [];
      const oTools = Array.isArray(o!.tools_allowed) ? o!.tools_allowed : [];
      if (bTools.length || oTools.length) {
        merged.tools_allowed = Array.from(new Set([...bTools, ...oTools]));
      }

      if (b!.period || o!.period) merged.period = b!.period ?? o!.period;

      result[key] = merged;
    }
    return result;
  }

  /**
   * Determine overlay active state from promo_rules + promotional_applied_at.
   * Uses CRITICAL contract: expiry derived from promo_rules.duration_days,
   * never from current_period_end (which is billing-related).
   */
  private computeOverlayState(
    promoRules: unknown,
    appliedAt: Date | null,
  ): { overlayActive: boolean; overlayExpiresAt: Date | null } {
    if (!appliedAt || !promoRules || typeof promoRules !== 'object') {
      return { overlayActive: false, overlayExpiresAt: null };
    }
    const rules = promoRules as Record<string, unknown>;
    const durationRaw = rules['duration_days'];
    const durationDays =
      typeof durationRaw === 'number'
        ? durationRaw
        : typeof durationRaw === 'string'
          ? parseInt(durationRaw, 10)
          : NaN;

    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      // No expiry declared -> treat as indefinite while promotional_plan_id set.
      return { overlayActive: true, overlayExpiresAt: null };
    }

    const expiresAt = new Date(
      appliedAt.getTime() + durationDays * 24 * 60 * 60 * 1000,
    );
    return {
      overlayActive: Date.now() < expiresAt.getTime(),
      overlayExpiresAt: expiresAt,
    };
  }

  /**
   * Snapshot resolved_features + resolved_at if stale vs source rows.
   * Stale if resolved_at < max(plan.updated_at, partner_override.updated_at,
   * promo.updated_at). Best-effort — failures logged, never throw.
   */
  private async maybeSnapshotResolved(
    sub: {
      id: number;
      resolved_at: Date;
      plan?: { updated_at: Date } | null;
      partner_override?: { updated_at: Date } | null;
      promotional_plan?: { updated_at: Date } | null;
    },
    features: ResolvedFeatures,
  ): Promise<void> {
    try {
      const candidates: Date[] = [];
      if (sub.plan) candidates.push(sub.plan.updated_at);
      if (sub.partner_override)
        candidates.push(sub.partner_override.updated_at);
      if (sub.promotional_plan)
        candidates.push(sub.promotional_plan.updated_at);
      if (candidates.length === 0) return;
      const maxSource = candidates.reduce(
        (acc, d) => (d.getTime() > acc.getTime() ? d : acc),
        candidates[0],
      );
      if (sub.resolved_at.getTime() >= maxSource.getTime()) return;

      await this.prisma.store_subscriptions.update({
        where: { id: sub.id },
        data: {
          resolved_features: features as any,
          resolved_at: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to snapshot resolved_features for sub ${sub.id}: ${(err as Error).message}`,
      );
    }
  }
}
