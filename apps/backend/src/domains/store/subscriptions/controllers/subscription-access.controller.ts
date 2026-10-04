import { Controller, Get, Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionResolverService } from '../services/subscription-resolver.service';
import { SubscriptionAccessService } from '../services/subscription-access.service';
import {
  AccessCheckResponseDto,
  SubscriptionBannerLevel,
} from '../dto/access-check-response.dto';
import { store_subscription_state_enum } from '@prisma/client';
import { SkipSubscriptionGate } from '../decorators/skip-subscription-gate.decorator';
import {
  AI_USAGE_GROUPS,
  AiUsageGroup,
  USAGE_GROUP_QUOTA,
} from '../contracts/ai-usage-groups.contract';
import { FEATURE_QUOTA_CONFIG, AI_FEATURE_KEYS } from '../types/access.types';

/**
 * Single read-only endpoint used by the frontend to drive the subscription
 * banner, paywall dialogs, and conditional UI in STORE_ADMIN.
 *
 * Routed under /store/* which is covered by the global JwtAuthGuard in
 * app.module. The store context resolution happens via the shared
 * RequestContextService populated by the request-context interceptor.
 */
@SkipSubscriptionGate()
@Controller('store/subscriptions')
export class SubscriptionAccessController {
  private readonly logger = new Logger(SubscriptionAccessController.name);

  constructor(
    private readonly resolver: SubscriptionResolverService,
    private readonly access: SubscriptionAccessService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('current/access')
  async getCurrentAccess() {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const resolved = await this.resolver.resolveSubscription(storeId);

    if (!resolved.found) {
      return this.responseService.success(
        {
          found: false,
          state: 'draft' as store_subscription_state_enum,
          planCode: '',
          features: {},
          currentPeriodEnd: null,
          overlayActive: false,
          overlayExpiresAt: null,
          bannerLevel: 'info' as SubscriptionBannerLevel,
        },
        'No subscription found',
      );
    }

    const dto: AccessCheckResponseDto = {
      found: true,
      state: resolved.state,
      planCode: resolved.planCode,
      features: resolved.features,
      currentPeriodEnd: resolved.currentPeriodEnd
        ? resolved.currentPeriodEnd.toISOString()
        : null,
      overlayActive: resolved.overlayActive,
      overlayExpiresAt: resolved.overlayExpiresAt
        ? resolved.overlayExpiresAt.toISOString()
        : null,
      bannerLevel: this.bannerLevel(resolved.state),
    };

    return this.responseService.success(dto, 'Subscription access retrieved');
  }

  @Get('usage')
  async getUsage() {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const resolved = await this.resolver.resolveSubscription(storeId);

    // Inicio de mes UTC, coherente con la llave Redis YYYYMM.
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const period_start = periodStart.toISOString();

    let consumptionByGroup: Record<
      AiUsageGroup,
      { calls: number; tokens: number }
    > | null = null;
    try {
      consumptionByGroup = await this.access.getAIConsumptionByGroup(
        storeId,
        periodStart,
        now,
      );
    } catch (err) {
      this.logger.error(
        `getAIConsumptionByGroup failed for store=${storeId}: ${(err as Error).message}`,
      );
    }

    if (!resolved.found) {
      return this.responseService.success(
        {
          features: {},
          period_start,
          consumption: consumptionByGroup
            ? AI_USAGE_GROUPS.map((group) => ({
                group,
                ...consumptionByGroup![group],
                quota: null,
              }))
            : null,
        },
        'Usage retrieved',
      );
    }

    const features: Record<
      string,
      { used: number; cap: number | null; period: string }
    > = {};

    for (const feature of AI_FEATURE_KEYS) {
      const quotaCfg = FEATURE_QUOTA_CONFIG[feature];
      const featureConfig = resolved.features[feature];

      if (!quotaCfg || !featureConfig) continue;

      const cap = featureConfig[quotaCfg.capField];
      const period = quotaCfg.period;

      const periodKey = this.getPeriodKey(period);
      const key = `ai:quota:${storeId}:${feature}:${periodKey}`;
      let used = 0;

      try {
        used = await this.access.getQuotaUsed(key);
      } catch {
        used = 0;
      }

      features[feature] = {
        used,
        cap: typeof cap === 'number' && cap > 0 ? cap : null,
        period,
      };
    }

    const consumption = consumptionByGroup
      ? AI_USAGE_GROUPS.map((group) => {
          const groupQuota = USAGE_GROUP_QUOTA[group];
          const f = groupQuota ? features[groupQuota.feature] : undefined;
          return {
            group,
            ...consumptionByGroup![group],
            quota:
              groupQuota && f
                ? {
                    feature: groupQuota.feature,
                    used: f.used,
                    cap: f.cap,
                    period: f.period,
                    unit: groupQuota.unit,
                  }
                : null,
          };
        })
      : null;

    return this.responseService.success(
      { features, period_start, consumption },
      'Usage retrieved',
    );
  }

  private getPeriodKey(period: 'daily' | 'monthly'): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    if (period === 'monthly') return `${y}${m}`;
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  private bannerLevel(
    state: store_subscription_state_enum,
  ): SubscriptionBannerLevel {
    switch (state) {
      case 'active':
      case 'trial':
        return 'none';
      case 'grace_soft':
        return 'warning';
      case 'grace_hard':
      case 'suspended':
      case 'blocked':
      case 'cancelled':
      case 'expired':
        return 'danger';
      case 'draft':
      default:
        return 'info';
    }
  }
}
