import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  AIEntitlement,
  legacyFlagsToAIEntitlements,
} from '../types/ai-capabilities';
import {
  applyPartnerRestriction,
  applyPromoOverlay,
  completeAIEntitlements,
  normalizeCapValue,
  partnerOverrideToPatch,
} from './ai-entitlements.logic';
import { computePromoOverlayState } from './subscription-resolver.service';

const CACHE_PREFIX = 'sub:entitlements';
const CACHE_TTL_SECONDS = 60;

/** Where the base rows of the effective plan came from. */
export type AIEntitlementsBaseSource = 'table' | 'legacy_fallback' | 'none';

export interface ResolvedAIEntitlements {
  found: boolean;
  storeId: number;
  planId: number | null;
  /** One row per catalog capability, catalog order. */
  rows: AIEntitlement[];
  baseSource: AIEntitlementsBaseSource;
  partnerRestricted: boolean;
  overlayActive: boolean;
}

interface PlanWithEntitlements {
  id: number;
  ai_feature_flags: unknown;
  ai_entitlements: Array<{
    agent_key: string;
    capability_key: string;
    enabled: boolean;
    cap_value: bigint | number | null;
    on_limit: string;
  }>;
}

const PLAN_SELECT = {
  id: true,
  ai_feature_flags: true,
  ai_entitlements: {
    select: {
      agent_key: true,
      capability_key: true,
      enabled: true,
      cap_value: true,
      on_limit: true,
    },
  },
} as const;

/**
 * Per-store AI entitlements from `plan_ai_entitlements` (T10).
 *
 * Same order as the legacy resolver: effective plan (trial → plan_id, paid →
 * paid_plan_id) → partner restriction → active promo overlay. A plan without
 * rows falls back to its legacy JSON translated by the catalog, so the model
 * answers for every plan before and after the backfill (M3).
 *
 * Shadow mode: nothing gates with this yet; `SubscriptionAccessService`
 * still decides with `ai_feature_flags` and only compares.
 */
@Injectable()
export class AIEntitlementsResolverService {
  private readonly logger = new Logger(AIEntitlementsResolverService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async resolveForStore(storeId: number): Promise<ResolvedAIEntitlements> {
    const cached = await this.readCache(storeId);
    if (cached) return cached;
    const resolved = await this.resolveFromDatabase(storeId);
    await this.writeCache(storeId, resolved);
    return resolved;
  }

  async invalidate(storeId: number): Promise<void> {
    try {
      await this.redis.del(this.cacheKey(storeId));
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate AI entitlements cache for store ${storeId}: ${(err as Error).message}`,
      );
    }
  }

  /** Complete rows of one plan (table first, legacy JSON as fallback). */
  planEntitlements(plan: PlanWithEntitlements): {
    rows: AIEntitlement[];
    source: Exclude<AIEntitlementsBaseSource, 'none'>;
  } {
    const legacy = legacyFlagsToAIEntitlements(plan.ai_feature_flags);
    if (!plan.ai_entitlements?.length) {
      return { rows: legacy, source: 'legacy_fallback' };
    }
    const stored = plan.ai_entitlements.map((r) => ({
      agent_key: r.agent_key,
      capability_key: r.capability_key,
      enabled: r.enabled,
      cap_value: normalizeCapValue(r.cap_value),
      on_limit: r.on_limit,
    })) as AIEntitlement[];
    return { rows: completeAIEntitlements(stored, legacy), source: 'table' };
  }

  private async resolveFromDatabase(
    storeId: number,
  ): Promise<ResolvedAIEntitlements> {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      select: {
        state: true,
        plan_id: true,
        paid_plan_id: true,
        promotional_applied_at: true,
        plan: { select: PLAN_SELECT },
        paid_plan: { select: PLAN_SELECT },
        promotional_plan: { select: { ...PLAN_SELECT, promo_rules: true } },
        partner_override: { select: { feature_overrides: true } },
      },
    });

    const empty = legacyFlagsToAIEntitlements({});
    if (!sub) {
      return {
        found: false,
        storeId,
        planId: null,
        rows: empty,
        baseSource: 'none',
        partnerRestricted: false,
        overlayActive: false,
      };
    }

    const effectivePlan =
      sub.state === 'trial' ? sub.plan : (sub.paid_plan ?? null);
    if (!effectivePlan) {
      return {
        found: true,
        storeId,
        planId: null,
        rows: empty,
        baseSource: 'none',
        partnerRestricted: false,
        overlayActive: false,
      };
    }

    const base = this.planEntitlements(effectivePlan);
    let rows = base.rows;

    const patch = partnerOverrideToPatch(
      sub.partner_override?.feature_overrides ?? null,
    );
    if (patch.length) rows = applyPartnerRestriction(rows, patch);

    const { overlayActive } = computePromoOverlayState(
      sub.promotional_plan?.promo_rules ?? null,
      sub.promotional_applied_at,
    );
    if (overlayActive && sub.promotional_plan) {
      rows = applyPromoOverlay(
        rows,
        this.planEntitlements(sub.promotional_plan).rows,
      );
    }

    return {
      found: true,
      storeId,
      planId: effectivePlan.id,
      rows,
      baseSource: base.source,
      partnerRestricted: patch.length > 0,
      overlayActive: Boolean(overlayActive && sub.promotional_plan),
    };
  }

  private cacheKey(storeId: number): string {
    return `${CACHE_PREFIX}:${storeId}`;
  }

  private async readCache(
    storeId: number,
  ): Promise<ResolvedAIEntitlements | null> {
    try {
      const raw = await this.redis.get(this.cacheKey(storeId));
      if (!raw) return null;
      const payload = JSON.parse(raw) as ResolvedAIEntitlements;
      return { ...payload, rows: completeAIEntitlements(payload.rows) };
    } catch (err) {
      this.logger.warn(
        `AI entitlements cache read failure for store ${storeId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async writeCache(
    storeId: number,
    resolved: ResolvedAIEntitlements,
  ): Promise<void> {
    try {
      await this.redis.set(
        this.cacheKey(storeId),
        JSON.stringify(resolved),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `AI entitlements cache write failure for store ${storeId}: ${(err as Error).message}`,
      );
    }
  }
}
