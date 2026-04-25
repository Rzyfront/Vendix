import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { SubscriptionResolverService } from './subscription-resolver.service';
import {
  AI_FEATURE_KEYS,
  FeatureConfig,
  ResolvedFeatures,
} from '../types/access.types';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

@Injectable()
export class PromotionalApplyService {
  private readonly logger = new Logger(PromotionalApplyService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly resolver: SubscriptionResolverService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async apply(storeId: number, promoPlanId: number): Promise<void> {
    const promoPlan = await this.prisma.subscription_plans.findUnique({
      where: { id: promoPlanId },
    });

    if (!promoPlan || !promoPlan.is_promotional) {
      throw new VendixHttpException(ErrorCodes.PROMO_001);
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

    const baseFeatures = this.coerceFeatures(sub.plan.ai_feature_flags);
    let resolvedFeatures: ResolvedFeatures = baseFeatures;

    if (sub.partner_override?.feature_overrides) {
      resolvedFeatures = this.applyPartnerRestriction(
        resolvedFeatures,
        this.coerceFeatures(sub.partner_override.feature_overrides),
      );
    }

    const promoFeatures = this.coerceFeatures(effectivePromoPlan.ai_feature_flags);
    resolvedFeatures = this.applyOverlayUnion(resolvedFeatures, promoFeatures);

    await this.prisma.store_subscriptions.update({
      where: { id: sub.id },
      data: {
        promotional_plan_id: effectivePromoPlan.id,
        promotional_applied_at: new Date(),
        resolved_features: resolvedFeatures as unknown as Prisma.InputJsonValue,
        resolved_at: new Date(),
        updated_at: new Date(),
      },
    });

    await this.resolver.invalidate(storeId);
    await this.invalidateRedisCache(storeId);

    this.eventEmitter.emit('subscription.promotional.applied', {
      storeId,
      promoPlanId: effectivePromoPlan.id,
      previousPromoPlanId: sub.promotional_plan_id,
    });
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

    const baseFeatures = this.coerceFeatures(sub.plan.ai_feature_flags);
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
  ): { id: number; ai_feature_flags: unknown; is_promotional: boolean; promo_priority: number } & Record<string, unknown> {
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
