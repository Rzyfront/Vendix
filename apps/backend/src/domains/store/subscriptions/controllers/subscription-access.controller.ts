import { Controller, Get } from '@nestjs/common';
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
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
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

    if (!resolved.found) {
      return this.responseService.success({ features: {} }, 'Usage retrieved');
    }

    const features: Record<string, { used: number; cap: number | null; period: string }> = {};

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

    return this.responseService.success({ features }, 'Usage retrieved');
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
