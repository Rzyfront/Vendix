import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { Prisma, store_subscription_state_enum } from '@prisma/client';
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
import { AutoRenewWarningState } from '../renewal-eligibility.contract';

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
 * `store_subscriptions.lock_reason` stamped by the renewal job
 * (`subscription-renewal-billing.job.ts`) when the subscription's plan was
 * archived and therefore could not be renewed. The store does NOT owe money:
 * the plan it was on simply stopped existing (e.g. the free plan was retired).
 */
const LOCK_REASON_PLAN_RETIRED = 'current_plan_unavailable_at_renewal';

/**
 * States in which `lock_reason` can carry the real cause of the lock. Any other
 * state short-circuits the lookup so the happy path never pays for it.
 *
 * `pending_payment` is in the set (QUI-676) because a recovery checkout started
 * from grace/suspended CARRIES its motive forward: `transition()` leaves
 * `lock_reason` intact on the way into `pending_payment` (only active/trial
 * clear it). So a store whose plan was retired and that is now settling an
 * invoice still owes no money, and must keep being told so. `active`/`trial` —
 * the hot path `StoreOperationsGuard` walks on every store write — stay out and
 * never touch the DB.
 */
const LOCK_REASON_STATES: ReadonlySet<store_subscription_state_enum> = new Set<
  store_subscription_state_enum
>(['grace_soft', 'grace_hard', 'suspended', 'blocked', 'pending_payment']);

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

    const lockReason = await this.readLockReason(storeId, resolved.state);
    const stateMode = this.stateToMode(
      resolved.state,
      resolved.features[feature],
      lockReason,
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

    const lockReason = await this.readLockReason(storeId, resolved.state);
    const stateMode = this.stateToMode(resolved.state, undefined, lockReason);
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
        // `sub` is the full subscription row, so the truthful lock reason is
        // already in hand — no extra lookup needed here.
        const mode = this.stateToMode(state, cfg, sub.lock_reason);
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

  /**
   * DEFECTO 5 — los tres campos `auto_renew_*` que `GET /store/subscriptions/current`
   * añade a la fila de la suscripción, DERIVADOS EN LECTURA. Sin columnas nuevas.
   *
   * El panel ya leía estos tres nombres (`subscription.facade.ts`) y el backend no
   * los devolvía nunca: el aviso en pantalla era código muerto y el comerciante
   * solo se enteraba por correo — o no se enteraba.
   *
   * Fuentes (todas existentes):
   *   - `subscription_events` tipo `auto_renew_disabled_no_credential` SIN
   *     `payload.resolved_at` → el autopago está pausado por falta de tarjeta.
   *     Se cura solo cuando el rearme estampa `resolved_at`.
   *   - `billing_warning_logs` tipo `renewal_failed` anclado (defecto 8) a una
   *     factura que sigue impaga → el cobro automático falló. Se apaga solo
   *     cuando la factura queda pagada o anulada, así que no hace falta que nadie
   *     "cierre" el aviso a mano.
   *   - `notifications` → id de la campana correspondiente, para que el panel
   *     pueda enlazar el aviso con la notificación que el comerciante ya tiene.
   *
   * PRECEDENCIA: `renewal_failed` gana sobre `auto_renew_disabled_no_credential`.
   * Un cobro que falló es dinero pendiente hoy; una pausa es un riesgo a futuro.
   *
   * Nunca lanza: es un adorno de una respuesta de lectura. Si algo falla se
   * devuelven los tres campos en null y `GET current` responde igual.
   */
  async getAutoRenewWarningState(
    storeId: number,
  ): Promise<AutoRenewWarningState> {
    const empty: AutoRenewWarningState = {
      auto_renew_warning_type: null,
      auto_renew_warning_notification_id: null,
      auto_renew_last_retry_at: null,
    };

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return empty;
    }

    try {
      const sub = await this.prisma.store_subscriptions.findUnique({
        where: { store_id: storeId },
        select: { id: true },
      });
      if (!sub) {
        return empty;
      }

      // ── 1. ¿Hay un cobro automático fallido todavía vivo?
      //
      // El `LEFT JOIN` doble cubre el ancla nueva (factura) y la legada (intento
      // de pago) sin necesitar migrar filas viejas. `COALESCE` prefiere la
      // factura, que es el ancla canónica desde el defecto 8.
      // `withoutScope()` porque el wrapper de scope no expone `$queryRaw` (solo
      // `$queryRawUnsafe`); el filtro de tenant va explícito en el WHERE, que es
      // lo que exige `vendix-prisma-scopes` para SQL crudo.
      const failedRows = await this.prisma.withoutScope().$queryRaw<
        Array<{ created_at: Date; invoice_id: number | null }>
      >(Prisma.sql`
        SELECT w.created_at,
               COALESCE(i_direct.id, i_pay.id) AS invoice_id
        FROM billing_warning_logs w
        LEFT JOIN subscription_invoices i_direct ON i_direct.id = w.source_event_id
        LEFT JOIN subscription_payments p ON p.id = w.source_event_id
        LEFT JOIN subscription_invoices i_pay ON i_pay.id = p.invoice_id
        WHERE w.store_id = ${storeId}
          AND w.type = 'renewal_failed'
          AND COALESCE(i_direct.store_subscription_id, i_pay.store_subscription_id) = ${sub.id}
          AND COALESCE(i_direct.state, i_pay.state) NOT IN ('paid', 'void', 'refunded', 'refunded_chargeback')
        ORDER BY w.created_at DESC
        LIMIT 1
      `);
      const failed = failedRows?.[0];

      if (failed) {
        // `auto_renew_last_retry_at` = último intento de cobro contra esa factura.
        // Es el dato que el panel muestra como "último intento", no la fecha del
        // aviso: el aviso se emite una vez por ciclo (defecto 8) y los intentos
        // siguen ocurriendo después.
        let lastRetryAt: Date = failed.created_at;
        if (failed.invoice_id) {
          const lastAttempt = await this.prisma.subscription_payments.findFirst({
            where: { invoice_id: failed.invoice_id },
            orderBy: { id: 'desc' },
            select: { created_at: true, updated_at: true },
          });
          const candidate =
            lastAttempt?.updated_at ?? lastAttempt?.created_at ?? null;
          if (candidate && candidate.getTime() > lastRetryAt.getTime()) {
            lastRetryAt = candidate;
          }
        }

        return {
          auto_renew_warning_type: 'auto_renew_charge_failed',
          auto_renew_warning_notification_id: await this.findWarningNotificationId(
            storeId,
            'auto_renew_charge_failed',
          ),
          auto_renew_last_retry_at: lastRetryAt.toISOString(),
        };
      }

      // ── 2. ¿El autopago está pausado por falta de tarjeta?
      const pausedRows = await this.prisma.withoutScope().$queryRaw<
        Array<{ created_at: Date }>
      >(Prisma.sql`
        SELECT created_at FROM subscription_events
        WHERE store_subscription_id = ${sub.id}
          AND type = 'auto_renew_disabled_no_credential'
          AND payload->>'resolved_at' IS NULL
        ORDER BY id DESC
        LIMIT 1
      `);
      const paused = pausedRows?.[0];

      if (paused) {
        return {
          auto_renew_warning_type: 'auto_renew_disabled_no_credential',
          auto_renew_warning_notification_id: await this.findWarningNotificationId(
            storeId,
            'auto_renew_disabled_no_credential',
          ),
          // No hubo reintento: el instante relevante es cuándo quedó pausado.
          auto_renew_last_retry_at: paused.created_at
            ? new Date(paused.created_at).toISOString()
            : null,
        };
      }

      return empty;
    } catch (err: any) {
      this.logger.warn(
        `AUTO_RENEW_WARNING_DERIVE_FAILED store=${storeId}: ${err?.message ?? err}`,
      );
      return empty;
    }
  }

  /**
   * Id de la campana que corresponde al aviso, o null.
   *
   * El panel la usa para enlazar el aviso con la notificación que el comerciante
   * ya tiene en la bandeja. Null es un resultado válido: la campana es
   * best-effort (el listener la traga si falla) y el aviso NO depende de ella.
   */
  private async findWarningNotificationId(
    storeId: number,
    type: 'auto_renew_charge_failed' | 'auto_renew_disabled_no_credential',
  ): Promise<number | null> {
    try {
      const notification = await this.prisma.notifications.findFirst({
        where: { store_id: storeId, type },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      return notification?.id ?? null;
    } catch (err: any) {
      this.logger.warn(
        `AUTO_RENEW_WARNING_NOTIFICATION_LOOKUP_FAILED store=${storeId} type=${type}: ${err?.message ?? err}`,
      );
      return null;
    }
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
   *
   * `lockReason` is the raw `store_subscriptions.lock_reason`. The real cause of
   * the lock was already recorded there, but this mapping used to discard it and
   * derive the reason from the state alone — so a store whose plan was retired
   * at renewal (owing nothing) was told "suspendida por falta de pago".
   * Charging someone with a debt they don't have is false information: it
   * generates support tickets and destroys trust. The truthful code wins.
   *
   * Only the `reason` changes: `mode` and `severity` per state stay exactly as
   * before, so the retired-plan case is not more (nor less) restrictive.
   */
  private stateToMode(
    state: store_subscription_state_enum,
    feature: FeatureConfig | undefined,
    lockReason?: string | null,
  ): { mode: Mode; severity: Severity; reason?: string } {
    const planRetired = lockReason === LOCK_REASON_PLAN_RETIRED;

    switch (state) {
      case 'active':
      case 'trial':
        return { mode: 'allow', severity: 'info' };
      // QUI-676 — `pending_payment` means "a charge is IN FLIGHT", not "the
      // customer did not pay". It had no case here, so it fell into
      // `default: block/blocker` and an unconfirmed Wompi webhook locked the
      // entire store out of every write under /api/store/**.
      //
      // A store that just handed us its card cannot be treated worse than one
      // that is five days past due (`grace_soft` → warn). Blocking is still
      // reachable and still correct — via `suspended`, `blocked`, `cancelled`
      // and `expired` — but it must be the OUTCOME of the charge, not its
      // waiting room.
      //
      // The window is bounded outside this mapping: after 60 minutes
      // `ReconcileStuckPendingJob` voids the stale invoice and reverts the
      // subscription to `pending_revert_state`, so `pending_payment` is a
      // transient state by construction, not an indefinite free pass.
      case 'pending_payment':
        return {
          mode: 'warn',
          severity: 'warning',
          reason: planRetired ? 'SUBSCRIPTION_011' : 'SUBSCRIPTION_007',
        };
      case 'grace_soft':
        return {
          mode: 'warn',
          severity: 'warning',
          reason: planRetired ? 'SUBSCRIPTION_011' : 'SUBSCRIPTION_007',
        };
      case 'grace_hard': {
        // Degradation per feature. Default = warn.
        const deg = feature?.degradation ?? 'warn';
        if (deg === 'block') {
          return {
            mode: 'block',
            severity: 'critical',
            reason: planRetired ? 'SUBSCRIPTION_011' : 'SUBSCRIPTION_009',
          };
        }
        return {
          mode: 'warn',
          severity: 'critical',
          reason: planRetired ? 'SUBSCRIPTION_011' : 'SUBSCRIPTION_007',
        };
      }
      case 'suspended':
        return {
          mode: 'block',
          severity: 'critical',
          reason: planRetired ? 'SUBSCRIPTION_011' : 'SUBSCRIPTION_008',
        };
      case 'blocked':
        return {
          mode: 'block',
          severity: 'blocker',
          reason: planRetired ? 'SUBSCRIPTION_011' : 'SUBSCRIPTION_009',
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
   * Reads the truthful `store_subscriptions.lock_reason` so `stateToMode()` can
   * name the real cause of the lock instead of assuming unpaid balance.
   *
   * The resolver cache (`ResolvedSubscription`) does not carry `lock_reason`
   * today, so we read the single column here. Cost control:
   *   - Only queried for `LOCK_REASON_STATES`; `active`/`trial` — the hot path
   *     for `StoreOperationsGuard` on every store write — never touch the DB.
   *   - Failures degrade to `null`, which reproduces the previous state-only
   *     reason. Losing message precision is acceptable; failing the gate for
   *     every write because of a lookup hiccup is not.
   */
  private async readLockReason(
    storeId: number,
    state: store_subscription_state_enum,
  ): Promise<string | null> {
    if (!LOCK_REASON_STATES.has(state)) return null;
    if (!Number.isInteger(storeId) || storeId <= 0) return null;

    try {
      const row = await this.prisma.store_subscriptions.findUnique({
        where: { store_id: storeId },
        select: { lock_reason: true },
      });
      return row?.lock_reason ?? null;
    } catch (err) {
      this.logger.debug(
        `lock_reason lookup failed for store=${storeId} state=${state}: ${(err as Error).message}`,
      );
      return null;
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
    else if (feature === 'realtime_voice')
      remaining.voice_seconds = remainingUnits;

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
