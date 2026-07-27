import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Prisma,
  store_subscription_state_enum,
  subscription_billing_cycle_enum,
} from '@prisma/client';
import Redis from 'ioredis';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { SubscriptionResolverService } from './subscription-resolver.service';
import { SubscriptionStateService } from './subscription-state.service';
import {
  AI_FEATURE_KEYS,
  FeatureConfig,
  ResolvedFeatures,
} from '../types/access.types';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { PromotionalRulesEvaluator } from '../evaluators/promotional-rules.evaluator';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fallback promo-window length (in days) derived from the promo plan's
 * billing cycle when `promo_rules.duration_days` is not provided. Lifetime
 * promos never lapse, so their window is anchored ~100 years out.
 */
const BILLING_CYCLE_DAYS: Record<subscription_billing_cycle_enum, number> = {
  monthly: 30,
  quarterly: 90,
  semiannual: 180,
  annual: 365,
  lifetime: 36500,
};

/**
 * States a coupon/promo application may reactivate directly to `active`.
 * `cancelled`/`expired` are intentionally excluded: they are terminal and the
 * TRANSITIONS map only lets them exit via `pending_payment` (the re-subscribe
 * checkout, Path D) — a direct `cancelled → active` would be illegal.
 */
const REACTIVATABLE_STATES: readonly store_subscription_state_enum[] = [
  'grace_soft',
  'grace_hard',
  'suspended',
  'blocked',
];

/**
 * Result of a coupon validation request. Distinguishes between a hard "not
 * found" (no plan with that code) and a soft "not eligible" (plan exists but
 * the store fails the promo_rules — expired, max_uses reached, etc.).
 */
export interface CouponValidationResult {
  valid: boolean;
  /** Discriminator codes consumed by the frontend reason mapper. */
  reason?:
    | 'not_found'
    | 'expired'
    | 'already_used'
    | 'not_eligible'
    | 'invalid_state';
  reasons_blocked?: string[];
  plan?: {
    id: number;
    code: string;
    name: string;
    description: string | null;
    plan_type: string;
    base_price: string;
    currency: string;
    promo_priority: number;
  };
  overlay_features?: Record<string, unknown>;
  duration_days?: number | null;
  starts_at?: string | null;
  expires_at?: string | null;
}

@Injectable()
export class PromotionalApplyService {
  private readonly logger = new Logger(PromotionalApplyService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly resolver: SubscriptionResolverService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly evaluator: PromotionalRulesEvaluator,
    private readonly stateService: SubscriptionStateService,
  ) {}

  /**
   * S2.1 — Validate a redemption code for a given store. Read-only; never
   * mutates state. Returns a discriminator-style result so the frontend can
   * show a precise reason (not_found vs expired vs already_used vs not_eligible).
   */
  async validateCoupon(
    storeId: number,
    code: string,
  ): Promise<CouponValidationResult> {
    const normalized = (code ?? '').trim();
    if (!normalized) {
      return { valid: false, reason: 'not_found' };
    }

    const promoPlan = await this.prisma.subscription_plans.findFirst({
      where: {
        redemption_code: normalized,
      },
    });

    if (!promoPlan) {
      return { valid: false, reason: 'not_found' };
    }

    if (promoPlan.state !== 'active' || promoPlan.archived_at) {
      return { valid: false, reason: 'invalid_state' };
    }

    if (
      (promoPlan.plan_type as unknown as string) !== 'promotional' &&
      !promoPlan.is_promotional
    ) {
      return { valid: false, reason: 'invalid_state' };
    }

    const eligibility = await this.evaluator.evaluate(storeId, promoPlan.id);
    if (!eligibility.eligible) {
      const blocked = eligibility.reasons_blocked;
      let reason: CouponValidationResult['reason'] = 'not_eligible';
      if (blocked.includes('expired') || blocked.includes('not_started')) {
        reason = 'expired';
      } else if (
        blocked.includes('max_uses_reached') ||
        blocked.includes('max_uses_per_org_reached')
      ) {
        reason = 'already_used';
      }
      return {
        valid: false,
        reason,
        reasons_blocked: blocked,
      };
    }

    // S2.1 — Idempotency guard: if the same store already has THIS promo
    // applied, surface as `already_used` so the UI can show "Cupón ya
    // aplicado" instead of letting the user retry.
    const existing = await this.prisma.store_subscriptions.findFirst({
      where: { store_id: storeId, promotional_plan_id: promoPlan.id },
      select: { id: true },
    });
    if (existing) {
      return { valid: false, reason: 'already_used' };
    }

    const rules = (promoPlan.promo_rules ?? {}) as {
      starts_at?: string;
      ends_at?: string;
      duration_days?: number;
    };

    return {
      valid: true,
      plan: {
        id: promoPlan.id,
        code: promoPlan.code,
        name: promoPlan.name,
        description: promoPlan.description,
        plan_type: promoPlan.plan_type as unknown as string,
        base_price: promoPlan.base_price.toFixed(2),
        currency: promoPlan.currency,
        promo_priority: promoPlan.promo_priority,
      },
      overlay_features: this.coerceFeatures(
        promoPlan.ai_feature_flags,
      ) as Record<string, unknown>,
      duration_days:
        typeof rules.duration_days === 'number' ? rules.duration_days : null,
      starts_at: rules.starts_at ?? null,
      expires_at: rules.ends_at ?? null,
    };
  }

  /**
   * S2.1 — Apply a redemption code to an existing store subscription. Wraps
   * `apply()` with the redemption_code lookup + auditable event metadata.
   * Idempotent: re-applying the same coupon to the same store is a no-op
   * (no event duplication, no overwrite of promotional_applied_at).
   */
  async applyCoupon(
    storeId: number,
    code: string,
    triggeredByUserId: number | null,
  ): Promise<void> {
    const normalized = (code ?? '').trim();
    if (!normalized) {
      throw new VendixHttpException(ErrorCodes.PROMO_001, 'Código inválido');
    }

    const promoPlan = await this.prisma.subscription_plans.findFirst({
      where: { redemption_code: normalized },
    });
    if (!promoPlan) {
      throw new VendixHttpException(
        ErrorCodes.PROMO_001,
        'Cupón no encontrado',
      );
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
    });
    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    // Idempotency: same coupon already applied → no-op.
    if (sub.promotional_plan_id === promoPlan.id) {
      this.logger.log(
        `Coupon ${normalized} already applied to store ${storeId}; skipping`,
      );
      return;
    }

    await this.apply(storeId, promoPlan.id);

    const rules = (promoPlan.promo_rules ?? {}) as {
      duration_days?: number;
    };

    await this.prisma.subscription_events.create({
      data: {
        store_subscription_id: sub.id,
        type: 'promotional_applied',
        from_state: null,
        to_state: null,
        payload: {
          redemption_code: normalized,
          promo_plan_id: promoPlan.id,
          promo_plan_code: promoPlan.code,
          duration_days: rules.duration_days ?? null,
          overlay_features: this.coerceFeatures(promoPlan.ai_feature_flags),
          redeemed_by_user_id: triggeredByUserId,
        } as unknown as Prisma.InputJsonValue,
        triggered_by_user_id: triggeredByUserId,
      },
    });
  }

  async apply(storeId: number, promoPlanId: number): Promise<void> {
    const promoPlan = await this.prisma.subscription_plans.findUnique({
      where: { id: promoPlanId },
    });

    if (!promoPlan || !promoPlan.is_promotional) {
      throw new VendixHttpException(ErrorCodes.PROMO_001);
    }

    // G9 — strict eligibility gate. Read-only; throws on rule violation.
    const eligibility = await this.evaluator.evaluate(storeId, promoPlanId);
    if (!eligibility.eligible) {
      throw new VendixHttpException(
        ErrorCodes.PROMO_NOT_ELIGIBLE,
        `Promo no elegible: ${eligibility.reasons_blocked.join(', ')}`,
      );
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      include: {
        plan: true,
        promotional_plan: true,
        partner_override: { include: { base_plan: true } },
      },
    });

    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const effectivePromoPlan = this.resolveHighestPriorityPromo(
      sub.promotional_plan,
      promoPlan,
    );

    // RNC-39: no_plan rows have no base plan to derive features from.
    const baseFeatures = this.coerceFeatures(
      sub.plan?.ai_feature_flags ?? null,
    );
    let resolvedFeatures: ResolvedFeatures = baseFeatures;

    if (sub.partner_override?.feature_overrides) {
      resolvedFeatures = this.applyPartnerRestriction(
        resolvedFeatures,
        this.coerceFeatures(sub.partner_override.feature_overrides),
      );
    }

    const promoFeatures = this.coerceFeatures(
      effectivePromoPlan.ai_feature_flags,
    );
    resolvedFeatures = this.applyOverlayUnion(resolvedFeatures, promoFeatures);

    const now = new Date();
    const currentState = sub.state as store_subscription_state_enum;
    const needsReactivation = REACTIVATABLE_STATES.includes(currentState);

    // S1+S2 — A coupon/promo is an access overlay; on its own it never
    // reactivated a degraded store, so a store in grace/suspended/blocked
    // stayed blocked (SUBSCRIPTION_008/009) even after redeeming a valid
    // coupon. When the store is in a reactivatable state we (1) transition
    // back to `active` and (2) open a fresh promo window.
    let reactivationData: Prisma.store_subscriptionsUncheckedUpdateInput = {};
    if (needsReactivation) {
      // Derive the window from the EFFECTIVE (winning) promo plan so the
      // extension reflects the overlay actually governing features.
      const effectivePromoFull =
        sub.promotional_plan &&
        effectivePromoPlan.id === sub.promotional_plan.id
          ? sub.promotional_plan
          : promoPlan;
      const durationDays = this.resolvePromoDurationDays(effectivePromoFull);
      const periodEnd = new Date(now.getTime() + durationDays * DAY_MS);

      // Transition FIRST (own Serializable tx). If the overlay update below
      // fails, a retry is NOT short-circuited by applyCoupon()'s
      // promotional_plan_id idempotency guard: the state is already `active`
      // and the overlay write simply re-runs. transition() also clears
      // grace_*_until and (per the state-service fix) lock_reason.
      await this.stateService.transition(storeId, 'active', {
        reason: 'promotional_coupon_reactivation',
        payload: {
          promo_plan_id: effectivePromoPlan.id,
          previous_state: currentState,
          duration_days: durationDays,
          current_period_end: periodEnd.toISOString(),
        },
      });

      reactivationData = {
        current_period_start: now,
        current_period_end: periodEnd,
        next_billing_at: periodEnd,
        grace_soft_until: null,
        grace_hard_until: null,
        suspend_at: null,
        cancel_at: null,
      };
    }

    await this.prisma.store_subscriptions.update({
      where: { id: sub.id },
      data: {
        promotional_plan_id: effectivePromoPlan.id,
        promotional_applied_at: now,
        resolved_features: resolvedFeatures as unknown as Prisma.InputJsonValue,
        resolved_at: now,
        updated_at: now,
        ...reactivationData,
      },
    });

    // Invalidate AFTER the state transition + overlay write so the next
    // resolve reflects both the new state and the overlay features.
    await this.resolver.invalidate(storeId);
    await this.invalidateRedisCache(storeId);

    this.eventEmitter.emit('subscription.promotional.applied', {
      storeId,
      promoPlanId: effectivePromoPlan.id,
      previousPromoPlanId: sub.promotional_plan_id,
    });
  }

  /**
   * Derive the promo window length in days: prefer an explicit
   * `promo_rules.duration_days`, otherwise fall back to the plan's billing
   * cycle. All math is epoch-ms (UTC-safe) per the backend date convention.
   */
  private resolvePromoDurationDays(promoPlan: {
    promo_rules: Prisma.JsonValue | null;
    billing_cycle: subscription_billing_cycle_enum;
  }): number {
    const rules =
      promoPlan.promo_rules && typeof promoPlan.promo_rules === 'object'
        ? (promoPlan.promo_rules as { duration_days?: unknown })
        : {};
    if (typeof rules.duration_days === 'number' && rules.duration_days > 0) {
      return rules.duration_days;
    }
    return BILLING_CYCLE_DAYS[promoPlan.billing_cycle] ?? 30;
  }

  /**
   * Alias for `remove()`.
   */
  async revoke(storeId: number): Promise<void> {
    return this.remove(storeId);
  }

  async remove(storeId: number): Promise<void> {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      include: {
        plan: true,
        partner_override: { include: { base_plan: true } },
      },
    });

    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    if (!sub.promotional_plan_id) {
      return;
    }

    // RNC-39: no_plan rows have no base plan to derive features from.
    const baseFeatures = this.coerceFeatures(
      sub.plan?.ai_feature_flags ?? null,
    );
    let resolvedFeatures: ResolvedFeatures = baseFeatures;

    if (sub.partner_override?.feature_overrides) {
      resolvedFeatures = this.applyPartnerRestriction(
        resolvedFeatures,
        this.coerceFeatures(sub.partner_override.feature_overrides),
      );
    }

    await this.prisma.store_subscriptions.update({
      where: { id: sub.id },
      data: {
        promotional_plan_id: null,
        promotional_applied_at: null,
        resolved_features: resolvedFeatures as unknown as Prisma.InputJsonValue,
        resolved_at: new Date(),
        updated_at: new Date(),
      },
    });

    await this.resolver.invalidate(storeId);
    await this.invalidateRedisCache(storeId);

    this.eventEmitter.emit('subscription.promotional.removed', {
      storeId,
      removedPromoPlanId: sub.promotional_plan_id,
    });
  }

  private resolveHighestPriorityPromo(
    currentPromo: { promo_priority: number } | null,
    newPromo: { promo_priority: number },
  ): {
    id: number;
    ai_feature_flags: unknown;
    is_promotional: boolean;
    promo_priority: number;
  } & Record<string, unknown> {
    if (!currentPromo) {
      return newPromo as any;
    }
    return currentPromo.promo_priority >= newPromo.promo_priority
      ? (currentPromo as any)
      : (newPromo as any);
  }

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

  private applyPartnerRestriction(
    base: ResolvedFeatures,
    override: ResolvedFeatures,
  ): ResolvedFeatures {
    const result: ResolvedFeatures = {};
    for (const key of AI_FEATURE_KEYS) {
      const b = base[key];
      const o = override[key];
      if (!b) continue;

      if (!o) {
        result[key] = { ...b };
        continue;
      }

      const merged: FeatureConfig = {
        enabled: b.enabled && (o.enabled ?? true),
        degradation: b.degradation,
      };

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
      }

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
        result[key] = { ...o };
        continue;
      }

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

  private async invalidateRedisCache(storeId: number): Promise<void> {
    try {
      await this.redis.del(`sub:features:${storeId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate Redis cache for store ${storeId}: ${(err as Error).message}`,
      );
    }
  }
}
