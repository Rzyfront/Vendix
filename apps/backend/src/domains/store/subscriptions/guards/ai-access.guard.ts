import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionAccessService } from '../services/subscription-access.service';
import { AIFeatureKey, isAIFeatureKey } from '../types/access.types';

export const AI_FEATURE_KEY = 'ai_feature';

/**
 * Route-level decorator declaring the AI feature required by a handler.
 * Consumed by `AiAccessGuard`.
 */
export const RequireAIFeature = (feature: AIFeatureKey) =>
  SetMetadata(AI_FEATURE_KEY, feature);

/**
 * AI gate guard. Must be used together with `@RequireAIFeature('<feature>')`.
 *
 * Behavior:
 *   - `allow`: pass.
 *   - `warn` : pass + set header `X-Subscription-Warning`.
 *   - `block`:
 *        * AI_GATE_ENFORCE=true → throw VendixHttpException with mapped code.
 *        * otherwise (log-only) → log structured observation, pass.
 *
 * Missing storeId in context:
 *   - enforce → throw SUBSCRIPTION_001.
 *   - log-only → log and pass.
 */
@Injectable()
export class AiAccessGuard implements CanActivate {
  private readonly logger = new Logger(AiAccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly access: SubscriptionAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.get<AIFeatureKey>(
      AI_FEATURE_KEY,
      ctx.getHandler(),
    );
    if (!feature || !isAIFeatureKey(feature)) {
      // No decorator → guard is a no-op.
      return true;
    }

    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      if (this.isEnforceMode()) {
        throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
      }
      this.logger.warn(
        JSON.stringify({
          event: 'AI_GATE_OBSERVATION',
          feature,
          outcome: 'would_block',
          reason: 'missing_store_context',
        }),
      );
      return true;
    }

    const result = await this.access.canUseAIFeature(storeId, feature);

    if (result.mode === 'warn') {
      try {
        const res = ctx.switchToHttp().getResponse();
        if (res && typeof res.setHeader === 'function') {
          res.setHeader('X-Subscription-Warning', result.subscription_state);
        }
      } catch {
        // Not an HTTP context (e.g. SSE/worker). Skip silently.
      }
    }

    if (result.mode === 'block') {
      this.logger.warn(
        JSON.stringify({
          event: 'AI_GATE_OBSERVATION',
          storeId,
          feature,
          outcome: 'would_block',
          reason: result.reason,
          state: result.subscription_state,
          enforce: this.isEnforceMode(),
        }),
      );
      if (this.isEnforceMode()) {
        const key =
          (result.reason as keyof typeof ErrorCodes) ?? 'SUBSCRIPTION_005';
        const entry = ErrorCodes[key] ?? ErrorCodes.SUBSCRIPTION_005;
        throw new VendixHttpException(entry);
      }
    }

    return true;
  }

  private isEnforceMode(): boolean {
    return (
      process.env.STORE_GATE_ENFORCE === 'true' ||
      process.env.AI_GATE_ENFORCE === 'true'
    );
  }
}
