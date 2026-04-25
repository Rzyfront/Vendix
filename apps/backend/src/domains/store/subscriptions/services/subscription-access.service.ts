import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { store_subscription_state_enum } from '@prisma/client';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import {
  AccessCheckResult,
  AIFeatureKey,
  AI_FEATURE_KEYS,
  FEATURE_QUOTA_CONFIG,
  FeatureConfig,
  isAIFeatureKey,
  ResolvedSubscription,
} from '../types/access.types';
import { SubscriptionResolverService } from './subscription-resolver.service';

type Mode = 'allow' | 'warn' | 'block';
type Severity = 'info' | 'warning' | 'critical' | 'blocker';

/**
 * Central AI gate for the SaaS subscription system.
 *
 * Semantics:
 *   - `allow`: full access.
 *   - `warn` : access granted + caller should surface a banner.
 *   - `block`: access denied with machine-readable reason code.
 *
 * Enforce vs log-only toggle:
 *   - AI_GATE_ENFORCE=true  → block when the gate says block.
 *   - otherwise (default)   → log-only; all fail paths fall back to allow to
 *     preserve existing UX during rollout. Internal errors follow the same
 *     policy (fail-closed in enforce, fail-open in log-only).
 *
 * Quota counter (Redis INCR+EXPIRE) uses period keys:
 *   - daily features (streaming_chat): YYYYMMDD (UTC)
 *   - monthly features (everything else with a cap): YYYYMM (UTC)
 *
 * Known limitation (v1): `consumeAIQuota` uses bare INCR; provider retries
 * may double-count. True idempotency requires per-request dedup (X-Request-Id).
 * Tracked as a Fase C knowledge gap.
 */
@Injectable()
export class SubscriptionAccessService {
  private readonly logger = new Logger(SubscriptionAccessService.name);

  constructor(
    private readonly resolver: SubscriptionResolverService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  async canUseAIFeature(
    storeId: number,
    feature: AIFeatureKey,
  ): Promise<AccessCheckResult> {
    if (!this.isEnforceMode()) {
      // Log-only shortcut path still runs the checks for observability,
      // but swallows failures below.
    }

    // Input validation — reject unknown keys / bad storeId eagerly.
    if (!isAIFeatureKey(feature)) {
      return this.failResult(
        'SUBSCRIPTION_005',
        'blocker' as Severity,
        'draft',
      );
    }
    if (!Number.isInteger(storeId) || storeId <= 0) {
      return this.failResult(
        'SUBSCRIPTION_INTERNAL_ERROR',
        'blocker' as Severity,
        'draft',
      );
    }

    let resolved: ResolvedSubscription;
    try {
      resolved = await this.resolver.resolveSubscription(storeId);
    } catch (err) {
      return this.handleInternalError(err, 'resolveSubscription');
    }

    if (!resolved.found) {
      return {
        allowed: false,
        mode: 'block',
        severity: 'blocker',
        reason: 'SUBSCRIPTION_001',
        subscription_state: resolved.state,
      };
    }

    const stateMode = this.stateToMode(
      resolved.state,
      resolved.features[feature],
    );
    if (stateMode.mode === 'block') {
      return {
        allowed: false,
        mode: 'block',
        severity: stateMode.severity,
        reason: stateMode.reason,
        subscription_state: resolved.state,
      };
    }

    const featureConfig = resolved.features[feature];
    if (!featureConfig || featureConfig.enabled === false) {
      return {
        allowed: false,
        mode: 'block',
        severity: 'blocker',
        reason: 'SUBSCRIPTION_005',
        subscription_state: resolved.state,
      };
    }

    // Quota check (read-only — does not increment).
    let remainingMeta: AccessCheckResult['remaining'];
    try {
      const quota = await this.checkQuotaRemaining(
        storeId,
        feature,
        featureConfig,
      );
      if (quota.exceeded) {
        return {
          allowed: false,
          mode: 'block',
          severity: 'critical',
          reason: 'SUBSCRIPTION_006',
          subscription_state: resolved.state,
          remaining: quota.remaining,
        };
      }
      remainingMeta = quota.remaining;
    } catch (err) {
      return this.handleInternalError(err, 'checkQuotaRemaining');
    }

    return {
      allowed: true,
      mode: stateMode.mode,
      severity: stateMode.severity,
      subscription_state: resolved.state,
      ...(remainingMeta ? { remaining: remainingMeta } : {}),
    };
  }

  async canUseModule(
    storeId: number,
    _moduleKey: string,
  ): Promise<AccessCheckResult> {
    // Used by `StoreOperationsGuard` to gate ALL writes under /api/store/**.
    // Policy:
    //   - No subscription row at all → block with SUBSCRIPTION_004 (no active
    //     subscription for store operations).
    //   - State maps via stateToMode(); for grace_soft/grace_hard we override
    //     a `block` decision to `warn` because store operations must keep
    //     working through the grace window — only the banner changes.
    //   - All other terminal states (suspended/blocked/cancelled/expired/draft)
    //     remain `block`.
    let resolved: ResolvedSubscription;
    try {
      resolved = await this.resolver.resolveSubscription(storeId);
    } catch (err) {
      return this.handleInternalError(err, 'canUseModule');
    }
    if (!resolved.found) {
      return {
        allowed: false,
        mode: 'block',
        severity: 'blocker',
        reason: 'SUBSCRIPTION_004',
        subscription_state: resolved.state,
      };
    }

    const stateMode = this.stateToMode(resolved.state, undefined);
    const inGrace =
      resolved.state === 'grace_soft' || resolved.state === 'grace_hard';
    const mode =
      stateMode.mode === 'block' && inGrace
        ? {
            mode: 'warn' as const,
            severity: 'warning' as const,
            reason: stateMode.reason,
          }
        : stateMode;

    return {
      allowed: mode.mode !== 'block',
      mode: mode.mode,
      severity: mode.severity,
      reason: mode.reason,
      subscription_state: resolved.state,
    };
  }

  async consumeAIQuota(
    storeId: number,
    feature: AIFeatureKey,
    units: number,
  ): Promise<void> {
    if (!Number.isInteger(storeId) || storeId <= 0) return;
    if (!isAIFeatureKey(feature)) return;
    if (!Number.isFinite(units) || units <= 0) return;

    const quotaCfg = FEATURE_QUOTA_CONFIG[feature];
    if (!quotaCfg) return; // feature has no numeric quota

    const periodKey = this.periodKey(quotaCfg.period);
    const key = this.quotaKey(storeId, feature, periodKey);
    const ttlSeconds = this.ttlForPeriod(quotaCfg.period);

    try {
      // INCRBY + EXPIRE. We set the TTL unconditionally; the period key
      // rolls over to a fresh key at period boundary, so extending the TTL
      // of an existing counter within its own period is harmless.
      const pipeline = this.redis.pipeline();
      pipeline.incrby(key, Math.floor(units));
      pipeline.expire(key, ttlSeconds);
      await pipeline.exec();
    } catch (err) {
      // Never throw from consume path — quota is observational. Log and move on.
      this.logger.warn(
        `consumeAIQuota failed for store=${storeId} feature=${feature}: ${(err as Error).message}`,
      );
    }
  }

  async invalidateCache(storeId: number): Promise<void> {
    await this.resolver.invalidate(storeId);
  }

  async getQuotaUsed(key: string): Promise<number> {
    try {
      const raw = await this.redis.get(key);
      const current = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(current) ? current : 0;
    } catch {
      return 0;
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Map subscription state to base gate mode. Feature-level degradation is
   * considered for grace_hard.
   */
  private stateToMode(
    state: store_subscription_state_enum,
    feature: FeatureConfig | undefined,
  ): { mode: Mode; severity: Severity; reason?: string } {
    switch (state) {
      case 'active':
      case 'trial':
        return { mode: 'allow', severity: 'info' };
      case 'grace_soft':
        return {
          mode: 'warn',
          severity: 'warning',
          reason: 'SUBSCRIPTION_007',
        };
      case 'grace_hard': {
        // Degradation per feature. Default = warn.
        const deg = feature?.degradation ?? 'warn';
        if (deg === 'block') {
          return {
            mode: 'block',
            severity: 'critical',
            reason: 'SUBSCRIPTION_009',
          };
        }
        return {
          mode: 'warn',
          severity: 'critical',
          reason: 'SUBSCRIPTION_007',
        };
      }
      case 'suspended':
        return {
          mode: 'block',
          severity: 'critical',
          reason: 'SUBSCRIPTION_008',
        };
      case 'blocked':
        return {
          mode: 'block',
          severity: 'blocker',
          reason: 'SUBSCRIPTION_009',
        };
      case 'cancelled':
        return {
          mode: 'block',
          severity: 'blocker',
          reason: 'SUBSCRIPTION_003',
        };
      case 'expired':
        return {
          mode: 'block',
          severity: 'blocker',
          reason: 'SUBSCRIPTION_003',
        };
      case 'draft':
      default:
        return {
          mode: 'block',
          severity: 'blocker',
          reason: 'SUBSCRIPTION_002',
        };
    }
  }

  /**
   * Read current quota counter and compute remaining units.
   * Returns `exceeded=true` when counter >= cap.
   */
  private async checkQuotaRemaining(
    storeId: number,
    feature: AIFeatureKey,
    config: FeatureConfig,
  ): Promise<{
    exceeded: boolean;
    remaining?: AccessCheckResult['remaining'];
  }> {
    const quotaCfg = FEATURE_QUOTA_CONFIG[feature];
    if (!quotaCfg) return { exceeded: false };

    const cap = config[quotaCfg.capField];
    if (typeof cap !== 'number' || cap <= 0) {
      // No cap declared → unlimited.
      return { exceeded: false };
    }

    const periodKey = this.periodKey(quotaCfg.period);
    const key = this.quotaKey(storeId, feature, periodKey);
    const raw = await this.redis.get(key);
    const current = raw ? parseInt(raw, 10) : 0;
    const safeCurrent = Number.isFinite(current) ? current : 0;
    const remainingUnits = Math.max(0, cap - safeCurrent);

    const remaining: AccessCheckResult['remaining'] = {};
    if (feature === 'text_generation') remaining.tokens = remainingUnits;
    else if (feature === 'streaming_chat') remaining.messages = remainingUnits;
    else if (feature === 'async_queue') remaining.jobs = remainingUnits;

    return {
      exceeded: safeCurrent >= cap,
      remaining: Object.keys(remaining).length ? remaining : undefined,
    };
  }

  private quotaKey(
    storeId: number,
    feature: AIFeatureKey,
    periodKey: string,
  ): string {
    // storeId and feature are validated; periodKey is generated by us.
    return `ai:quota:${storeId}:${feature}:${periodKey}`;
  }

  private periodKey(period: 'daily' | 'monthly'): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    if (period === 'monthly') return `${y}${m}`;
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  private ttlForPeriod(period: 'daily' | 'monthly'): number {
    // Over-provision TTL to survive period boundaries; next period will use a
    // distinct key anyway.
    if (period === 'daily') return 48 * 60 * 60; // 48h
    return 40 * 24 * 60 * 60; // 40d
  }

  private isEnforceMode(): boolean {
    return process.env.AI_GATE_ENFORCE === 'true';
  }

  private failResult(
    reason: string,
    severity: Severity,
    state: store_subscription_state_enum,
  ): AccessCheckResult {
    return {
      allowed: false,
      mode: 'block',
      severity,
      reason,
      subscription_state: state,
    };
  }

  /**
   * Fail-closed in enforce mode, fail-open in log-only.
   */
  private handleInternalError(err: unknown, where: string): AccessCheckResult {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(
      `SubscriptionAccessService.${where} failed: ${msg}`,
      err instanceof Error ? err.stack : undefined,
    );
    if (this.isEnforceMode()) {
      return {
        allowed: false,
        mode: 'block',
        severity: 'blocker',
        reason: 'SUBSCRIPTION_INTERNAL_ERROR',
        subscription_state: 'draft',
      };
    }
    return {
      allowed: true,
      mode: 'allow',
      severity: 'info',
      subscription_state: 'draft',
    };
  }
}

export { AI_FEATURE_KEYS };
