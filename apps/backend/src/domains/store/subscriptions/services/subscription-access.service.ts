import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { store_subscription_state_enum } from '@prisma/client';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
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

export interface DunningOverdueInvoice {
  id: number;
  invoice_number: string;
  amount_due: number;
  issued_at: string | null;
  period_start: string | null;
  period_end: string | null;
}

export interface DunningStateResponse {
  state: store_subscription_state_enum | 'none';
  deadlines: {
    grace_hard_at: string | null;
    suspend_at: string | null;
    cancel_at: string | null;
  };
  invoices_overdue: DunningOverdueInvoice[];
  total_due: number;
  features_lost: string[];
  features_kept: string[];
  /**
   * S2.2 — true when the store has no `state='active'` payment method, OR the
   * default payment method is in `state='invalid'`. The frontend dunning board
   * surfaces an "Actualizar método de pago" CTA when this is true while in a
   * grace_* state, because retrying payment with an invalid card is futile.
   */
  payment_method_invalid: boolean;
}

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
 * v3 (G7 — atomic dedup): `consumeAIQuota` REQUIRES `requestId` (X-Request-Id).
 * A Lua script atomically checks a dedup set keyed on requestId before
 * incrementing the period counter. Same requestId across retries (provider-side
 * or HTTP-level) yields exactly one increment. Missing requestId is a contract
 * violation and raises `InternalServerErrorException` — no silent fallback to
 * non-deduped INCR is permitted.
 *
 * Dedup set TTL is the same as the period TTL so the dedup window covers the
 * entire period in which the increment was recorded; cleanup is automatic at
 * period rollover (the key is namespaced by period).
 */
@Injectable()
export class SubscriptionAccessService {
  private readonly logger = new Logger(SubscriptionAccessService.name);

  constructor(
    private readonly resolver: SubscriptionResolverService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: GlobalPrismaService,
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
        plan_id: resolved.planId,
        has_record: false,
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
        plan_id: resolved.planId,
        has_record: resolved.found,
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
        plan_id: resolved.planId,
        has_record: resolved.found,
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
          plan_id: resolved.planId,
          has_record: resolved.found,
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
      plan_id: resolved.planId,
      has_record: resolved.found,
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
        plan_id: resolved.planId,
        has_record: false,
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
      plan_id: resolved.planId,
      has_record: resolved.found,
    };
  }

  /**
   * Atomically increments the per-period quota counter, deduplicated by
   * `requestId`. Multiple invocations with the same `requestId` for the same
   * `(storeId, feature, period)` produce exactly one increment.
   *
   * Contract:
   *   - `requestId` is REQUIRED. Throws `InternalServerErrorException` when
   *     missing/empty/non-string. This is intentional — silent non-dedup would
   *     allow provider retries (e.g. OpenAI/Anthropic 5xx auto-retry on the
   *     same X-Request-Id) to double-charge the customer.
   *   - Redis errors are still swallowed (observational counter, must not fail
   *     the surrounding operation), but a missing requestId is a programmer
   *     error and surfaces immediately.
   */
  async consumeAIQuota(
    storeId: number,
    feature: AIFeatureKey,
    units: number,
    requestId: string,
  ): Promise<void> {
    if (typeof requestId !== 'string' || requestId.trim().length === 0) {
      throw new InternalServerErrorException(
        'consumeAIQuota requires a non-empty requestId (X-Request-Id) for atomic dedup. ' +
          'Pass RequestContextService.getRequestId() or propagate it through job data.',
      );
    }

    if (!Number.isInteger(storeId) || storeId <= 0) return;
    if (!isAIFeatureKey(feature)) return;
    if (!Number.isFinite(units) || units <= 0) return;

    const quotaCfg = FEATURE_QUOTA_CONFIG[feature];
    if (!quotaCfg) return; // feature has no numeric quota

    const periodKey = this.periodKey(quotaCfg.period);
    const quotaKey = this.quotaKey(storeId, feature, periodKey);
    const dedupKey = this.dedupSetKey(storeId, feature, periodKey);
    const ttlSeconds = this.ttlForPeriod(quotaCfg.period);

    try {
      // Atomic dedup + increment via Lua script. KEYS[1] = quota counter,
      // KEYS[2] = dedup set (period-scoped — auto-cleans at rollover).
      // ARGV[1] = requestId, ARGV[2] = units, ARGV[3] = ttl seconds (applied to
      // BOTH keys so the dedup window matches the counter window).
      await this.redis.eval(
        this.consumeQuotaLua,
        2,
        quotaKey,
        dedupKey,
        requestId,
        Math.floor(units),
        ttlSeconds,
      );
    } catch (err) {
      // Never throw from consume path — quota is observational. Log and move on.
      this.logger.warn(
        `consumeAIQuota failed for store=${storeId} feature=${feature} requestId=${requestId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Atomic dedup-then-increment.
   *
   * KEYS[1] = quota counter      ai:quota:{storeId}:{feature}:{period}
   * KEYS[2] = dedup set          ai:quota:dedup:{storeId}:{feature}:{period}
   * ARGV[1] = request_id, ARGV[2] = units, ARGV[3] = ttl_seconds
   *
   * Returns: 0 if duplicate (no increment), new counter value otherwise.
   */
  private readonly consumeQuotaLua = `
    if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return 0 end
    redis.call('SADD', KEYS[2], ARGV[1])
    redis.call('EXPIRE', KEYS[2], ARGV[3])
    local v = redis.call('INCRBY', KEYS[1], ARGV[2])
    redis.call('EXPIRE', KEYS[1], ARGV[3])
    return v
  `;

  async invalidateCache(storeId: number): Promise<void> {
    await this.resolver.invalidate(storeId);
  }

  /**
   * Read-only snapshot of the dunning state for the given store, intended for
   * the dunning board UI. Computes deadlines from `current_period_end` plus
   * the plan's grace/suspension/cancellation offsets without mutating any
   * row (the state engine cron / event listener handle transitions). Returns
   * a flat shape consumed by the frontend `dunning-board.component`.
   *
   * For active/trial subscriptions (no dunning active) returns empty
   * deadlines + zero amounts so the frontend can use this endpoint as a
   * single source of truth without 404 branching.
   */
  async getDunningStateForCurrentStore(
    storeId: number,
  ): Promise<DunningStateResponse> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new InternalServerErrorException('Invalid storeId');
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      include: {
        plan: {
          select: {
            grace_period_soft_days: true,
            grace_period_hard_days: true,
            suspension_day: true,
            cancellation_day: true,
            ai_feature_flags: true,
            feature_matrix: true,
          },
        },
      },
    });

    if (!sub) {
      return {
        state: 'none',
        deadlines: {
          grace_hard_at: null,
          suspend_at: null,
          cancel_at: null,
        },
        invoices_overdue: [],
        total_due: 0,
        features_lost: [],
        features_kept: [],
        payment_method_invalid: false,
      };
    }

    const state = sub.state;
    const isDunningState =
      state === 'grace_soft' ||
      state === 'grace_hard' ||
      state === 'suspended' ||
      state === 'blocked';

    // Deadlines derived from plan + current_period_end. Same offsets the
    // SubscriptionStateService uses to drive transitions.
    const deadlines = this.computeDunningDeadlines(
      sub.current_period_end,
      sub.plan,
    );

    // Outstanding invoices: any invoice not paid/void with state in
    // ('issued','overdue'). When subscription is in dunning we report total
    // due; when active/trial we still report any overdue but normally none
    // exist.
    const invoicesRaw = await this.prisma.subscription_invoices.findMany({
      where: {
        store_subscription_id: sub.id,
        state: { in: ['issued', 'overdue'] },
      },
      orderBy: { issued_at: 'asc' },
      select: {
        id: true,
        invoice_number: true,
        total: true,
        amount_paid: true,
        issued_at: true,
        period_start: true,
        period_end: true,
      },
    });

    const invoices_overdue: DunningOverdueInvoice[] = invoicesRaw.map((inv) => {
      const total = this.toNumber(inv.total);
      const paid = this.toNumber(inv.amount_paid);
      const due = Math.max(0, total - paid);
      return {
        id: inv.id,
        invoice_number: inv.invoice_number,
        amount_due: due,
        issued_at: inv.issued_at ? inv.issued_at.toISOString() : null,
        period_start: inv.period_start ? inv.period_start.toISOString() : null,
        period_end: inv.period_end ? inv.period_end.toISOString() : null,
      };
    });

    const total_due = invoices_overdue.reduce(
      (acc, i) => acc + i.amount_due,
      0,
    );

    // features_lost / features_kept: compute degradation impact for the
    // current state. We resolve via the cached resolver and then partition
    // the AI feature keys into kept vs lost based on stateToMode().
    let resolved: ResolvedSubscription;
    try {
      resolved = await this.resolver.resolveSubscription(storeId);
    } catch {
      resolved = {
        found: false,
        storeId,
        state,
        planId: null,
        planCode: '',
        paidPlanId: null,
        pendingPlanId: null,
        partnerOrgId: null,
        overlayActive: false,
        overlayExpiresAt: null,
        features: {},
        gracePeriodSoftDays: 0,
        gracePeriodHardDays: 0,
        currentPeriodEnd: null,
      };
    }

    const features_lost: string[] = [];
    const features_kept: string[] = [];

    if (isDunningState) {
      for (const key of AI_FEATURE_KEYS) {
        const cfg = resolved.features[key];
        if (!cfg || cfg.enabled === false) continue;
        const mode = this.stateToMode(state, cfg);
        if (mode.mode === 'block') {
          features_lost.push(key);
        } else {
          features_kept.push(key);
        }
      }
    } else {
      // Active/trial: list every enabled AI feature as kept, lost stays empty.
      for (const key of AI_FEATURE_KEYS) {
        const cfg = resolved.features[key];
        if (cfg && cfg.enabled !== false) features_kept.push(key);
      }
    }

    // S2.2 — flag whether the store has a usable default payment method. The
    // frontend uses this to surface "Actualizar método de pago" instead of
    // (or alongside) "Pagar ahora" while in a grace_* window.
    let payment_method_invalid = false;
    try {
      const activeCount = await this.prisma.subscription_payment_methods.count({
        where: { store_id: storeId, state: 'active' },
      });
      if (activeCount === 0) {
        payment_method_invalid = true;
      } else {
        const activeDefault =
          await this.prisma.subscription_payment_methods.findFirst({
            where: {
              store_id: storeId,
              state: 'active',
              is_default: true,
            },
            select: { id: true },
          });
        if (!activeDefault) {
          payment_method_invalid = true;
        }
      }
    } catch (err) {
      this.logger.warn(
        `payment_method_invalid lookup failed for store=${storeId}: ${(err as Error).message}`,
      );
    }

    return {
      state,
      deadlines: isDunningState
        ? deadlines
        : { grace_hard_at: null, suspend_at: null, cancel_at: null },
      invoices_overdue,
      total_due,
      features_lost,
      features_kept,
      payment_method_invalid,
    };
  }

  private computeDunningDeadlines(
    periodEnd: Date | null,
    plan: {
      grace_period_soft_days: number;
      grace_period_hard_days: number;
      suspension_day: number;
      cancellation_day: number;
    } | null,
  ): {
    grace_hard_at: string | null;
    suspend_at: string | null;
    cancel_at: string | null;
  } {
    if (!periodEnd || !plan) {
      return { grace_hard_at: null, suspend_at: null, cancel_at: null };
    }
    const DAY = 24 * 60 * 60 * 1000;
    const base = new Date(periodEnd).getTime();
    return {
      grace_hard_at: new Date(
        base + plan.grace_period_hard_days * DAY,
      ).toISOString(),
      suspend_at: new Date(base + plan.suspension_day * DAY).toISOString(),
      cancel_at: new Date(base + plan.cancellation_day * DAY).toISOString(),
    };
  }

  private toNumber(value: unknown): number {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const n = parseFloat(value);
      return Number.isFinite(n) ? n : 0;
    }
    // Prisma.Decimal exposes toNumber()
    if (typeof (value as any).toNumber === 'function') {
      try {
        return (value as any).toNumber();
      } catch {
        return 0;
      }
    }
    return 0;
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
      case 'no_plan':
        return {
          mode: 'block',
          severity: 'blocker',
          reason: 'SUBSCRIPTION_004',
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

  /**
   * Period-scoped dedup set key. Lives alongside the counter and shares its
   * lifetime — when the period rolls over, both keys are abandoned and Redis
   * reaps them via TTL. Using a SET (not per-request key) keeps the surface
   * compact: one key per (storeId, feature, period) regardless of request volume.
   */
  private dedupSetKey(
    storeId: number,
    feature: AIFeatureKey,
    periodKey: string,
  ): string {
    return `ai:quota:dedup:${storeId}:${feature}:${periodKey}`;
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
      plan_id: null,
      has_record: false,
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
        plan_id: null,
        has_record: false,
      };
    }
    return {
      allowed: true,
      mode: 'allow',
      severity: 'info',
      subscription_state: 'draft',
      plan_id: null,
      has_record: false,
    };
  }
}

export { AI_FEATURE_KEYS };
