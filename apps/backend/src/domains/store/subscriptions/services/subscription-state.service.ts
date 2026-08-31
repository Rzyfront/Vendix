import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  Prisma,
  store_subscription_state_enum,
  store_subscriptions,
} from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionAccessService } from './subscription-access.service';
import {
  AUTO_RENEW_PAUSE_REASON_NO_CARD,
  AutoRenewPauseSource,
  autoRenewIntentDesired,
  metadataWithPausedAutoRenewIntent,
  metadataWithRearmedAutoRenewIntent,
  pickRenewalEligiblePaymentMethod,
  renewalEligiblePmWhere,
} from '../renewal-eligibility.contract';

type State = store_subscription_state_enum;

/**
 * Payload shape for `subscription.payment.failed` (emitted by
 * SubscriptionPaymentService.handleChargeFailure).
 *
 * Note: the original emitter only carries { invoiceId, paymentId, reason }.
 * subscriptionId/storeId are resolved on the listener side from invoiceId.
 */
interface PaymentFailedEventPayload {
  invoiceId: number;
  paymentId: number;
  reason: string;
  // Present when emitted from the BullMQ retry processor
  // (`subscription.payment.retry.failed`).
  subscriptionId?: number;
  storeId?: number;
  attempt?: number;
}

/**
 * Allowed transitions between subscription states.
 *
 * `pending_payment` is the parking state for a paid plan whose first invoice
 * has been issued but not yet confirmed by the Wompi webhook. The
 * SubscriptionStateListener auto-promotes it to `active` on
 * `subscription.payment.succeeded`. If the user abandons checkout or the
 * payment is declined, the subscription moves to `cancelled` or `blocked`.
 *
 * `draft → active` is preserved for FREE plans only (effective_price = 0)
 * which skip the invoice/charge cycle entirely. Paid plans MUST flow through
 * `draft → pending_payment → active`.
 *
 * `cancelled` and `expired` admit a single legal exit to `pending_payment`
 * via the re-subscribe checkout path. The first paid invoice promotes them
 * back through the existing pending → active flow.
 *
 * Recovery from grace/suspended via the regular checkout flow (NOT the
 * direct-charge retryPayment path) ALSO needs `pending_payment` as a legal
 * intermediate. The checkout commit endpoint creates an open invoice, hands
 * the user the Wompi widget, and the listener promotes pending_payment →
 * active on APPROVED. Without these transitions a customer in grace or
 * suspended cannot self-recover via the same checkout UX they would use to
 * change plans — they got a 409 "Illegal transition X -> pending_payment"
 * 409 from the controller and were stuck.
 */
const TRANSITIONS: Record<State, readonly State[]> = {
  draft: ['pending_payment', 'trial', 'active', 'no_plan'],
  // Recovery checkouts initiated from grace/suspended store the prior state
  // in `pending_revert_state`. cancelPendingChange uses that field to roll
  // back, so pending_payment must be able to transition back to those
  // states. Without these entries the cancel call throws "Illegal transition
  // pending_payment -> suspended" and leaves the subscription stuck.
  //
  // QUI-676: `trial` and `draft` belong to that same set and were left out of
  // the fix above. The rule is symmetry — every state that may LEGALLY ENTER
  // `pending_payment` must be able to come back out of it, because the state
  // it came from is exactly what the checkout paths write verbatim into
  // `pending_revert_state`, and that column is the ONLY instruction the
  // rollback paths have.
  //   - `trial`: written by the RNC-15 anti-arrastre upgrade
  //     (subscription-checkout.controller.ts, `pending_revert_state: 'trial'`)
  //     and reachable a second time through the generic mid-cycle branch,
  //     which stamps `pending_revert_state: sub.state` with no state guard —
  //     a trial whose window already lapsed lands there too.
  //   - `draft`: `store_subscriptions.state` is `@default(draft)` in the
  //     schema and `SubscriptionDraftCleanupJob` (RNC-40) exists precisely
  //     because abandoned draft rows are real. `draft -> pending_payment` is
  //     legal (row above), and the same unguarded mid-cycle branch — in the
  //     store AND the org checkout controller — stamps
  //     `pending_revert_state: sub.state`, so a draft can be parked in
  //     pending_payment with 'draft' as its documented way home.
  // Both rollbacks used to throw SUBSCRIPTION_010 inside
  // ReconcileStuckPendingJob.reconcilePendingChange() — the only thing that
  // rescues a checkout whose Wompi webhook never arrived — so the cron retried
  // and failed every 5 minutes while the store stayed parked in
  // `pending_payment` (store 99 sat there 11 days).
  pending_payment: [
    'active',
    'blocked',
    'cancelled',
    'expired',
    'no_plan',
    'grace_soft',
    'grace_hard',
    'suspended',
    'trial',
    'draft',
  ],
  // RNC-15 anti-arrastre: trial → pending_payment is allowed when the user
  // upgrades from a trial (free) to a paid plan via checkout. The charge runs
  // and on Wompi APPROVED the listener flips pending_payment → active.
  trial: ['active', 'pending_payment', 'blocked', 'cancelled', 'expired'],
  // ADR-7: active → pending_payment allowed for mid-cycle paid plan changes.
  // plan_id only mutates in confirmPendingChange() after gateway confirmation.
  active: ['grace_soft', 'cancelled', 'expired', 'no_plan', 'pending_payment'],
  grace_soft: ['active', 'grace_hard', 'cancelled', 'no_plan', 'pending_payment'],
  grace_hard: ['active', 'suspended', 'cancelled', 'expired', 'pending_payment'],
  suspended: ['active', 'blocked', 'cancelled', 'pending_payment'],
  blocked: ['active', 'cancelled'],
  cancelled: ['pending_payment', 'no_plan'],
  expired: ['pending_payment', 'no_plan'],
  no_plan: ['pending_payment', 'active', 'cancelled'],
};

export interface TransitionOptions {
  reason: string;
  triggeredByUserId?: number;
  triggeredByJob?: string;
  payload?: Record<string, unknown>;
  /**
   * Value persisted to `store_subscriptions.lock_reason` — the column the
   * access gate reads to tell the customer WHY its store is degraded.
   *
   * `reason` above is audit payload only (it lands in
   * `subscription_events.payload.reason`); passing the motive there and not
   * here leaves the column untouched and the customer gets the generic
   * "payment" story. Both are needed.
   */
  lockReason?: string;
  graceSoftUntil?: Date;
  graceHardUntil?: Date;
}

/**
 * `store_subscriptions.lock_reason` written when the plan a store sits on was
 * retired from the catalog and therefore could not be re-billed at renewal.
 * The store does NOT owe money — the plan simply stopped existing.
 *
 * Consumer: `SubscriptionAccessService.stateToMode()` matches exactly this
 * value to answer `SUBSCRIPTION_011` ("Plan retired — choose an active plan")
 * instead of the past-due codes. It keeps a private copy of the literal on the
 * read side; the two must stay in sync.
 */
export const LOCK_REASON_PLAN_RETIRED = 'current_plan_unavailable_at_renewal';

/**
 * `lock_reason` for the ordinary dunning path: the store crossed its payment
 * deadlines and really does owe money.
 */
export const LOCK_REASON_PAST_DUE = 'past_due';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Contractual cycle length in days, per `subscription_billing_cycle_enum`.
 *
 * KNOWLEDGE GAP (duplication): the same table already exists as
 * `SubscriptionProrationService.billingCycleMs` and
 * `SubscriptionPaymentService.billingCycleDays`, both `private`. Neither is
 * reachable, and `SubscriptionProrationService` already injects THIS service
 * (see its constructor), so injecting it back would close a DI cycle. The
 * table is therefore re-stated here instead of reached into. Extracting it to
 * a shared `billing-cycle.util.ts` is the right follow-up.
 */
const BILLING_CYCLE_DAYS: Record<string, number> = {
  monthly: 30,
  quarterly: 90,
  semiannual: 180,
  annual: 365,
  lifetime: 100 * 365,
};
const DEFAULT_CYCLE_DAYS = BILLING_CYCLE_DAYS.monthly;

/**
 * Input for `ensureOperational` / `ensureOperationalInTx`.
 */
export interface EnsureOperationalContext {
  /** Audit reason written to every `subscription_events` row of the path. */
  reason: string;
  /**
   * Base `current_period_end` the caller wants. When omitted it is derived as
   * `now + plan cycle length`. Either way the grace discount is applied on
   * top of it.
   */
  periodEnd?: Date;
  /**
   * Plan whose `billing_cycle` governs the derived period length. Purely a
   * READ: `ensureOperational` never mutates `plan_id` / `paid_plan_id` —
   * that stays owned by the payment-confirmation path (ADR-7).
   */
  planId?: number;
  payload?: Record<string, unknown>;
  triggeredByUserId?: number;
  triggeredByJob?: string;
}

export interface EnsureOperationalResult {
  /** State the subscription is in once the seam returns successfully. */
  finalState: State;
  /**
   * States actually walked, in order. Empty when the subscription was
   * already operational (idempotent no-op). `['pending_payment','active']`
   * for the terminal states that must be walked, not jumped.
   */
  path: State[];
}

/**
 * Mutates `store_subscriptions.state` with a legal transition, writes a
 * `subscription_events` audit row, invalidates access cache, and emits a
 * NestJS event. All inside a Serializable transaction with SELECT FOR UPDATE
 * to prevent TOCTOU races.
 *
 * Concurrency model
 * -----------------
 * Two writers can race on the same subscription:
 *   (a) `SubscriptionStateEngineJob` — daily cron at 03:00 UTC.
 *   (b) `SubscriptionStateListener` — webhook-driven (G12), gated by
 *       `SUBSCRIPTION_EVENT_DRIVEN_STATE`.
 *
 * Both go through `transition()`, which takes a row-level FOR UPDATE lock
 * inside a Serializable tx. The same-state guard makes a second writer's
 * call a no-op — duplicate webhooks and webhook+cron crossings are safe.
 * No additional advisory lock is needed (the row lock already serializes).
 *
 * Rollout for G12 (event-driven recovery from grace soft/hard, suspended,
 * blocked):
 *   1. Deploy with `SUBSCRIPTION_EVENT_DRIVEN_STATE=false` (default).
 *      Listener emits `STATE_ENGINE_OBSERVATION` log markers but does NOT
 *      transition. Cron stays as source of truth.
 *   2. Compare listener observations against cron decisions for ~7 days.
 *   3. Flip flag to `true` in staging; observe `STATE_ENGINE_EVENT_RECOVERY`
 *      for ~3 days.
 *   4. Flip in prod. Cron remains as a redundant safety net (idempotent).
 */
@Injectable()
export class SubscriptionStateService {
  private readonly logger = new Logger(SubscriptionStateService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly accessService: SubscriptionAccessService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async transition(
    storeId: number,
    toState: State,
    opts: TransitionOptions,
  ): Promise<store_subscriptions> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }

    const result = await this.prisma.$transaction(
      async (tx: any) =>
        this.transitionInTxInternal(tx, storeId, toState, opts),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Idempotent no-op: nothing to invalidate / emit. Still return the row.
    if (result.noop) {
      return result.updated;
    }

    // Post-commit side effects. Failures here must NOT roll back the
    // transition (it already committed). Log + best-effort only.
    try {
      await this.accessService.invalidateCache(storeId);
    } catch (err) {
      this.logger.warn(
        `Post-transition cache invalidation failed for store ${storeId}: ${(err as Error).message}`,
      );
    }

    this.eventEmitter.emit('subscription.state.changed', {
      storeId,
      fromState: result.fromState,
      toState,
      reason: opts.reason,
      triggeredByUserId: opts.triggeredByUserId,
      triggeredByJob: opts.triggeredByJob,
    });

    return result.updated;
  }

  /**
   * Variant of `transition` that runs INSIDE an externally-provided
   * transaction. Does NOT emit events nor invalidate cache — those are the
   * caller's responsibility to fire AFTER the outer transaction commits, so
   * we don't run side effects on a rolled-back state change.
   *
   * Use this from webhook/payment success paths where the state promotion
   * must be atomic with the payment row update (so a partial commit can
   * never leave a payment 'succeeded' but subscription stuck in
   * 'pending_payment').
   *
   * Idempotency: same-state target is a true no-op (no log row, no update,
   * no throw). Illegal transitions still throw `SUBSCRIPTION_010`.
   */
  async transitionInTx(
    tx: Prisma.TransactionClient,
    storeId: number,
    toState: State,
    opts: TransitionOptions,
  ): Promise<store_subscriptions> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }
    const result = await this.transitionInTxInternal(
      tx as any,
      storeId,
      toState,
      opts,
    );
    return result.updated;
  }

  /**
   * Core transition logic shared by `transition()` (opens its own
   * Serializable tx) and `transitionInTx()` (runs inside the caller's tx).
   * Returns `{ noop: true }` when the subscription is already in `toState`
   * so the public API can skip post-commit side effects.
   */
  private async transitionInTxInternal(
    tx: any,
    storeId: number,
    toState: State,
    opts: TransitionOptions,
  ): Promise<{
    noop: boolean;
    fromState: State;
    updated: store_subscriptions;
  }> {
    // FOR UPDATE lock on the subscription row.
    const locked = (await tx.$queryRaw(
      Prisma.sql`SELECT id, state FROM store_subscriptions WHERE store_id = ${storeId} FOR UPDATE`,
    )) as Array<{ id: number; state: State }>;

    if (!locked.length) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const current = locked[0];
    const currentState = current.state;

    // Idempotent short-circuit: same target = true no-op. Log info, skip
    // update + audit row. This guarantees concurrent webhook + cron retries
    // for an already-active sub don't emit redundant events nor throw.
    if (currentState === toState) {
      this.logger.log(
        `transition no-op: store ${storeId} already in state '${toState}' (reason=${opts.reason})`,
      );
      const existing = await tx.store_subscriptions.findUniqueOrThrow({
        where: { id: current.id },
      });
      return { noop: true, fromState: currentState, updated: existing };
    }

    if (!this.isLegalTransition(currentState, toState)) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        `Illegal transition ${currentState} -> ${toState}`,
      );
    }

    // Auto-set lock_reason for suspended/blocked transitions; explicitly
    // clear it on recovery to active/trial so a stale 'past_due' /
    // 'admin_manual' label does not linger and keep the store looking locked.
    // `undefined` leaves the column intact.
    //
    // The grace_* branch exists because DEGRADATION STARTS AT GRACE, not at
    // suspension: a store whose plan was retired at renewal lands in
    // `grace_soft`, and if the truthful motive is not stamped right there the
    // consumer (`stateToMode` → SUBSCRIPTION_011) has nothing to read and the
    // customer is told it failed to pay a bill it never owed. Callers with no
    // truthful motive pass none and the column is left intact, so this only
    // ever ADDS information.
    let lockReason: string | null | undefined;
    if (toState === 'suspended' || toState === 'blocked') {
      lockReason = opts.lockReason ?? 'admin_manual';
    } else if (toState === 'grace_soft' || toState === 'grace_hard') {
      lockReason = opts.lockReason ?? undefined;
    } else if (toState === 'active' || toState === 'trial') {
      lockReason = null;
    } else {
      lockReason = undefined;
    }

    const graceData: Record<string, any> = {};
    if (toState === 'grace_soft') {
      graceData.grace_soft_until = opts.graceSoftUntil ?? undefined;
    }
    if (toState === 'grace_hard') {
      graceData.grace_hard_until = opts.graceHardUntil ?? undefined;
    }
    if (toState === 'active' || toState === 'trial') {
      graceData.grace_soft_until = null;
      graceData.grace_hard_until = null;
    }

    const updatedRow = await tx.store_subscriptions.update({
      where: { id: current.id },
      data: {
        state: toState,
        // `undefined` = leave intact, `null` = clear (recovery), string = set.
        lock_reason: lockReason,
        updated_at: new Date(),
        ...graceData,
      },
    });

    await tx.subscription_events.create({
      data: {
        store_subscription_id: current.id,
        type: 'state_transition',
        from_state: currentState,
        to_state: toState,
        payload: {
          reason: opts.reason,
          ...(opts.payload ?? {}),
        } as Prisma.InputJsonValue,
        triggered_by_user_id: opts.triggeredByUserId ?? null,
        triggered_by_job: opts.triggeredByJob ?? null,
      },
    });

    return { noop: false, fromState: currentState, updated: updatedRow };
  }

  isLegalTransition(from: State, to: State): boolean {
    return TRANSITIONS[from]?.includes(to) ?? false;
  }

  // ------------------------------------------------------------------
  // ensureOperational — the single reactivation seam
  // ------------------------------------------------------------------

  /**
   * Bring a store back to an OPERATIONAL subscription state after a
   * successful activation (payment confirmed, manual payment posted, admin
   * unblock, free-plan grant...).
   *
   * WHY THIS EXISTS
   * ---------------
   * Six call-sites used to hand-roll "now go active", each with its own idea
   * of which intermediate hops were legal and which stale scheduling columns
   * to clear. Any state whose TRANSITIONS row lacked `'active'` (i.e.
   * `cancelled` / `expired`) made those call-sites either throw
   * `SUBSCRIPTION_010` or — worse — swallow the error and return HTTP 200
   * while the store stayed blocked. A 200 with a blocked store is the worst
   * failure mode available: the customer discovers it while operating.
   *
   * This seam centralises the policy:
   *
   *  1. Already `active` / `trial` → idempotent NO-OP. Nothing is written, no
   *     event is emitted, the period is NOT extended (no free time).
   *  2. State whose TRANSITIONS row contains `'active'` (`grace_soft`,
   *     `grace_hard`, `suspended`, `blocked`, `draft`, `no_plan`,
   *     `pending_payment`) → one direct hop.
   *  3. State whose row does NOT contain `'active'` but does contain
   *     `'pending_payment'` (`cancelled`, `expired`) → TWO hops,
   *     `pending_payment` then `active`.
   *
   * Rule 3 is the core of the design. The terminality of `cancelled` /
   * `expired` is preserved by WALKING the legal path, never by adding
   * `'active'` to their TRANSITIONS row — that shortcut would let any code
   * path activate a terminated subscription with no evidence of collection,
   * and is explicitly rejected. `pending_payment` is the parking state that
   * says "an invoice exists and is being settled", so passing through it
   * keeps the audit trail honest: `subscription_events` gets one row per hop.
   *
   * EXIT GUARD
   * ----------
   * After the path completes, the state is RE-READ from the database. If it
   * is not `active` / `trial` the call throws instead of reporting success,
   * and (for `ensureOperational`) the whole path rolls back. A reported
   * success must imply an operational store.
   *
   * PERIOD WINDOW
   * -------------
   * When the previous `current_period_end` had already lapsed, the customer
   * was operating on grace time they did not pay for. The new period end
   * therefore DISCOUNTS the whole days consumed between the lapsed period end
   * and `now`: an annual plan reactivated 5 days past due gets
   * `now + 360d`, not `now + 365d`. When the period had NOT lapsed and the
   * caller passed no explicit `periodEnd`, the paid window is left untouched
   * (reactivating a mid-period `blocked` store must not gift a fresh cycle).
   *
   * Concurrency: same model as `transition()` — one Serializable transaction
   * holding a `FOR UPDATE` row lock for the whole path, so a competing
   * webhook/cron writer either waits or finds the store already operational
   * and no-ops.
   */
  async ensureOperational(
    storeId: number,
    ctx: EnsureOperationalContext,
  ): Promise<EnsureOperationalResult> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }

    const result = await this.prisma.$transaction(
      async (tx: any) => this.ensureOperationalInTxInternal(tx, storeId, ctx),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Idempotent no-op: nothing changed, so nothing to invalidate or emit.
    if (!result.path.length) {
      return { finalState: result.finalState, path: [] };
    }

    // Post-commit side effects. Failures must NOT roll back the reactivation
    // (it already committed). Log + best-effort only.
    try {
      await this.accessService.invalidateCache(storeId);
    } catch (err) {
      this.logger.warn(
        `Post-ensureOperational cache invalidation failed for store ${storeId}: ${(err as Error).message}`,
      );
    }

    // One event for the whole recovery. The intermediate `pending_payment`
    // hop is a mechanical waypoint, not a state the store ever really
    // occupied, so listeners see `degraded -> active` plus the full path.
    this.eventEmitter.emit('subscription.state.changed', {
      storeId,
      fromState: result.fromState,
      toState: result.finalState,
      reason: ctx.reason,
      triggeredByUserId: ctx.triggeredByUserId,
      triggeredByJob: ctx.triggeredByJob,
      path: result.path,
    });

    return { finalState: result.finalState, path: result.path };
  }

  /**
   * `ensureOperational` for callers that are ALREADY inside a transaction
   * (e.g. the payment-confirmation path, which must promote the state
   * atomically with the payment/invoice rows).
   *
   * Like `transitionInTx`, it does NOT invalidate the access cache nor emit
   * `subscription.state.changed`; the caller owns firing those AFTER its own
   * transaction commits, so side effects never run on a rolled-back change.
   *
   * The exit guard still applies: on a degraded outcome this throws, which
   * aborts the caller's transaction — exactly the desired behaviour, since a
   * payment confirmation that leaves the store blocked must not commit.
   */
  async ensureOperationalInTx(
    tx: Prisma.TransactionClient,
    storeId: number,
    ctx: EnsureOperationalContext,
  ): Promise<EnsureOperationalResult> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }
    const result = await this.ensureOperationalInTxInternal(
      tx as any,
      storeId,
      ctx,
    );
    return { finalState: result.finalState, path: result.path };
  }

  /**
   * Billing-warning detection — flips `store_subscriptions.auto_renew` back
   * to `true` when the merchant has just tokenized a fresh payment method
   * (the `reEnableAutoRenewAfterCredential` hook in
   * SubscriptionPaymentMethodsService.tokenizeAndRegister) and an unresolved
   * `auto_renew_disabled_no_credential` audit row still exists for this
   * subscription.
   *
   * Deliberately a simple guarded UPDATE — no `ensureOperational` walk,
   * no cache invalidation, no emit. The caller (`tokenizeAndRegister`)
   * already owns the in-tx context: it stamps the audit row's
   * `payload.resolved_at` on success, so the listener's next dedupe hit
   * won't re-fire. The store's subscription STATE is unchanged — only the
   * "auto-renew at next period end" flag moves.
   *
   * EL PREDICADO MANDA: el rearme se verifica contra
   * `renewal-eligibility.contract.ts`, nunca se impone. Un rearme sin medio
   * apto devolvía el autopago a la misma renovación silenciosa que lo apagó.
   * Al rearmar se marca la intención como cumplida en
   * `metadata.auto_renew_intent` para que el gate no la vuelva a leer como
   * pendiente.
   *
   * Returns true when the flip happened, false otherwise (already on,
   * no subscription row, no eligible payment method). Idempotent on retry.
   */
  async reEnableAutoRenewInTx(
    tx: Prisma.TransactionClient,
    storeId: number,
  ): Promise<boolean> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }
    const sub = await tx.store_subscriptions.findUnique({
      where: { store_id: storeId },
      select: { id: true, auto_renew: true, metadata: true },
    });
    if (!sub) {
      return false;
    }

    const now = new Date();
    const eligible = await this.hasRenewalEligiblePmInTx(tx, sub.id, now);
    if (!eligible) {
      this.logger.warn(
        `AUTO_RENEW_REARM_SKIPPED store=${storeId} sub=${sub.id} ` +
          `reason=no_renewal_eligible_payment_method — el autopago solo funciona con tarjeta`,
      );
      return false;
    }

    if (sub.auto_renew !== false) {
      // Ya estaba encendido (toggle manual entre el cobro y la tokenización).
      // Aun así cerramos la intención: quedó cumplida.
      await tx.store_subscriptions.update({
        where: { id: sub.id },
        data: {
          metadata: metadataWithRearmedAutoRenewIntent(
            sub.metadata,
            now,
          ) as Prisma.InputJsonValue,
          updated_at: now,
        },
      });
      return false;
    }

    await tx.store_subscriptions.update({
      where: { id: sub.id },
      data: {
        auto_renew: true,
        metadata: metadataWithRearmedAutoRenewIntent(
          sub.metadata,
          now,
        ) as Prisma.InputJsonValue,
        updated_at: now,
      },
    });
    return true;
  }

  /**
   * LA CURA, en un solo lugar — rearme automático del autopago cuando el
   * comerciante consigue una credencial cobrable.
   *
   * Dos caminos guardan tarjeta y ambos deben curar igual:
   *   - `SubscriptionPaymentMethodsService.tokenizeAndRegister` (alta explícita).
   *   - `SubscriptionPaymentService.autoRegisterPaymentMethodFromGateway` (la
   *     tarjeta con la que se pagó una factura por el widget).
   *
   * Vive aquí porque es el único servicio que AMBOS inyectan; duplicar la
   * secuencia en los dos era la vía segura a que un camino curara y el otro no.
   *
   * Autorización del rearme (no se enciende el autopago a quien lo apagó a mano):
   * hace falta una fila de auditoría `auto_renew_disabled_no_credential` sin
   * resolver, o la intención recordada en `metadata.auto_renew_intent`.
   *
   * Devuelve `rearmed: true` SOLO cuando el flag pasó de apagado a encendido —
   * es la señal con la que el llamador avisa (campana + correo) después del
   * commit. `resolvedEventId` es la fila de auditoría que quedó cerrada.
   */
  async rearmAutoRenewAfterCredentialInTx(
    tx: Prisma.TransactionClient,
    args: { storeId: number; subscriptionId: number; source: string },
  ): Promise<{
    rearmed: boolean;
    resolvedEventId: number | null;
    eligible: boolean;
  }> {
    const { storeId, subscriptionId, source } = args;
    const now = new Date();

    const eligible = await this.hasRenewalEligiblePmInTx(
      tx,
      subscriptionId,
      now,
    );
    if (!eligible) {
      // Medio guardado que NO renueva (Nequi/PSE, tarjeta vencida, sin COF bajo
      // enforce). Curar aquí sería reponer el autopago silencioso.
      this.logger.log(
        `AUTO_RENEW_REARM_NOT_ELIGIBLE store=${storeId} sub=${subscriptionId} source=${source}`,
      );
      return { rearmed: false, resolvedEventId: null, eligible: false };
    }

    const openEventId = await this.findUnresolvedNoCredentialEventInTx(
      tx,
      subscriptionId,
    );

    const sub = await tx.store_subscriptions.findFirst({
      where: { id: subscriptionId },
      select: { auto_renew: true, metadata: true },
    });

    const authorized =
      openEventId != null || autoRenewIntentDesired(sub?.metadata ?? null);
    if (!authorized) {
      return { rearmed: false, resolvedEventId: null, eligible: true };
    }

    const flipped = await this.reEnableAutoRenewInTx(tx, storeId);

    // `flipped === false` con autorización significa que el autopago ya estaba
    // encendido (toggle manual entre el cobro y el alta de la tarjeta). Se cierra
    // la auditoría igual para que el aviso en pantalla desaparezca, pero NO se
    // notifica un rearme que el cliente no percibe como cambio.
    let resolvedEventId: number | null = null;
    if (openEventId != null) {
      const existing = await tx.subscription_events.findUnique({
        where: { id: openEventId },
        select: { payload: true },
      });
      const prevPayload =
        existing?.payload &&
        typeof existing.payload === 'object' &&
        !Array.isArray(existing.payload)
          ? (existing.payload as Record<string, unknown>)
          : {};
      await tx.subscription_events.update({
        where: { id: openEventId },
        data: {
          payload: {
            ...prevPayload,
            resolved_at: now.toISOString(),
            resolved_by: source,
          } as Prisma.InputJsonValue,
        },
      });
      resolvedEventId = openEventId;
    }

    this.logger.log(
      `AUTO_RENEW_REARMED store=${storeId} sub=${subscriptionId} source=${source} ` +
        `flipped=${flipped} resolvedEvent=${resolvedEventId ?? 'none'}`,
    );

    return { rearmed: flipped, resolvedEventId, eligible: true };
  }

  /**
   * Id del `auto_renew_disabled_no_credential` más reciente que sigue sin
   * resolver, o null.
   *
   * SQL crudo a propósito: el filtro de path JSON de Prisma es frágil entre
   * versiones menores, y la pausa (`SubscriptionPaymentService`) lee la MISMA
   * expresión `payload->>'resolved_at' IS NULL`. Los dos lados tienen que hablar
   * del mismo registro o el aviso se duplica o no se cierra nunca.
   */
  private async findUnresolvedNoCredentialEventInTx(
    tx: Prisma.TransactionClient,
    subscriptionId: number,
  ): Promise<number | null> {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT id FROM subscription_events
      WHERE store_subscription_id = ${subscriptionId}
        AND type = 'auto_renew_disabled_no_credential'
        AND payload->>'resolved_at' IS NULL
      ORDER BY id DESC
      LIMIT 1
    `);
    return rows?.[0]?.id ?? null;
  }

  /**
   * `true` cuando la suscripción tiene al menos un medio de pago apto para
   * renovar, leído dentro de la transacción del llamador.
   *
   * Delega en `renewal-eligibility.contract.ts`. Este servicio NO puede inyectar
   * `SubscriptionPaymentService` (ese servicio inyecta a este: sería un ciclo de
   * DI), así que consume el predicado como función pura sobre el cliente de la
   * transacción. La REGLA sigue viviendo en un solo archivo.
   */
  private async hasRenewalEligiblePmInTx(
    tx: Prisma.TransactionClient,
    subscriptionId: number,
    now: Date = new Date(),
  ): Promise<boolean> {
    const rows = await tx.subscription_payment_methods.findMany({
      where: renewalEligiblePmWhere(subscriptionId, now),
    });
    return pickRenewalEligiblePaymentMethod(rows, now) !== null;
  }

  /**
   * Valor de `auto_renew` que una reactivación puede escribir, más el `metadata`
   * que debe acompañarlo.
   *
   * Regla: la reactivación NO impone `true`. Si hay medio apto lo enciende; si
   * no lo hay lo deja/pone en `false` y RECUERDA la intención del cliente en
   * `metadata.auto_renew_intent`, que es lo que autoriza el rearme automático
   * cuando el comerciante guarde una tarjeta.
   *
   * Este método existe porque la línea `auto_renew: true` sin condición era el
   * punto exacto donde se perdía el apagado del gate: el gate corre antes en la
   * MISMA transacción y la ventana de reactivación lo pisaba.
   *
   * Público porque `SubscriptionProrationService` escribe `auto_renew` por su
   * cuenta en tres caminos (cambio de plan, revertir cancelación programada y
   * resuscripción), y en el camino de **plan gratis** no corre ningún gate
   * después. Sin compartir este resolvedor, ese camino seguiría encendiendo el
   * autopago de una tienda sin tarjeta: el mismo defecto, por otra puerta.
   */
  async resolveAutoRenewForReactivation(
    tx: any,
    args: {
      subscriptionId: number;
      storeId: number;
      currentAutoRenew: boolean | null;
      metadata: unknown;
      source: AutoRenewPauseSource;
      now: Date;
    },
  ): Promise<{ auto_renew: boolean; metadata?: Prisma.InputJsonValue }> {
    const eligible = await this.hasRenewalEligiblePmInTx(
      tx as Prisma.TransactionClient,
      args.subscriptionId,
      args.now,
    );

    if (eligible) {
      return { auto_renew: true };
    }

    this.logger.warn(
      `AUTO_RENEW_HELD_OFF store=${args.storeId} sub=${args.subscriptionId} ` +
        `source=${args.source} reason=no_renewal_eligible_payment_method — ` +
        `el autopago solo funciona con tarjeta; intención recordada para rearme`,
    );

    return {
      auto_renew: false,
      metadata: metadataWithPausedAutoRenewIntent(args.metadata, {
        source: args.source,
        now: args.now,
      }) as Prisma.InputJsonValue,
    };
  }

  /**
   * Legal walk from `from` to `active`.
   *
   * - `[]`   → already operational, nothing to do.
   * - `null` → no legal path exists (caller throws `SUBSCRIPTION_010`).
   *
   * With the current TRANSITIONS table every state reaches `active` either
   * directly or via `pending_payment`, so `null` is defensive: it exists so
   * that a future edit which strands a state fails loudly here instead of
   * silently leaving stores degraded.
   */
  private resolveOperationalRoute(from: State): State[] | null {
    if (from === 'active' || from === 'trial') {
      return [];
    }
    if (this.isLegalTransition(from, 'active')) {
      return ['active'];
    }
    if (
      this.isLegalTransition(from, 'pending_payment') &&
      this.isLegalTransition('pending_payment', 'active')
    ) {
      return ['pending_payment', 'active'];
    }
    return null;
  }

  private async ensureOperationalInTxInternal(
    tx: any,
    storeId: number,
    ctx: EnsureOperationalContext,
  ): Promise<EnsureOperationalResult & { fromState: State }> {
    // Same FOR UPDATE lock `transition()` takes, but it also reads the
    // columns the period recalculation needs, so the whole seam works off one
    // consistent snapshot. Re-locking inside each hop is a no-op: this tx
    // already holds the row lock.
    const locked = (await tx.$queryRaw(
      Prisma.sql`SELECT id, state, plan_id, current_period_end, scheduled_cancel_at FROM store_subscriptions WHERE store_id = ${storeId} FOR UPDATE`,
    )) as Array<{
      id: number;
      state: State;
      plan_id: number | null;
      current_period_end: Date | string | null;
      scheduled_cancel_at: Date | string | null;
    }>;

    if (!locked.length) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const current = locked[0];
    const fromState = current.state;
    const route = this.resolveOperationalRoute(fromState);

    if (route === null) {
      this.logger.error(
        `ENSURE_OPERATIONAL_NO_PATH store=${storeId} from=${fromState} reason=${ctx.reason}`,
      );
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        `No legal path from ${fromState} to active`,
      );
    }

    const now = new Date();

    // Empty route = the row is ALREADY `active`/`trial`, so no hop is needed.
    // That is NOT the same as "already operational": `state` and
    // `current_period_end` are two independent truths, and there is a window
    // where they disagree — from the moment the period lapses until the
    // `subscription-state-engine` cron (03:00 UTC) degrades the row. A renewal
    // collected inside that window is the ON-TIME payment, and it used to be
    // the one this seam threw away: the early `return` sat BEFORE
    // `applyReactivationWindow`, the single writer of `current_period_*`, so
    // the invoice went `paid`, the payment `succeeded`, the window stayed
    // lapsed — and the cron degraded a store that had paid days earlier
    // (prod: `ENSURE_OPERATIONAL_NOOP store=96 state=active
    // reason=payment_42_approved`, then `active`->`grace_soft` 3 days later).
    //
    // The guard is `isWindowSpent`, the SAME predicate the window writer
    // consults — not a second copy of it — so the two routes cannot drift
    // apart on when a collection has to rebuild the cycle.
    //
    // It has to be asked BEFORE the call and not left to the writer, because
    // `applyReactivationWindow` ends in an unconditional row update that also
    // voids `scheduled_cancel_at` / `suspend_at` / `cancel_at`. On the hop
    // route that is correct (the store was degraded). On a genuine no-op it
    // would not be: a duplicate webhook on a healthy store would silently
    // cancel the user's own scheduled cancellation. A true no-op stays a true
    // no-op — zero writes, zero audit rows.
    if (!route.length) {
      const originalPeriodEnd = this.asDate(current.current_period_end);
      const windowSpent = this.isWindowSpent({
        originalPeriodEnd,
        now,
        requestedPeriodEnd: ctx.periodEnd,
        // A row with NO window at all is left alone here. Only the hop route
        // treats `null` as spent, which is where it means "recovering from a
        // degraded state that never had a cycle". An `active` row with a null
        // period is not what this fix is about, and minting a cycle for it
        // would be a behaviour change no incident asked for.
        missingCountsAsSpent: false,
      });

      if (windowSpent) {
        await this.applyReactivationWindow(tx, {
          subscriptionId: current.id,
          storeId,
          now,
          originalPeriodEnd,
          scheduledCancelAt: this.asDate(current.scheduled_cancel_at),
          planId: ctx.planId ?? current.plan_id,
          ctx,
          missingWindowCountsAsSpent: false,
        });
      }

      this.logger.log(
        `ENSURE_OPERATIONAL_NOOP store=${storeId} state=${fromState} ` +
          `reason=${ctx.reason} window_rebuilt=${windowSpent}`,
      );
      return { finalState: fromState, path: [], fromState };
    }

    const walked: State[] = [];

    for (let hop = 0; hop < route.length; hop++) {
      const step = route[hop];
      await this.transitionInTx(tx, storeId, step, {
        reason: ctx.reason,
        triggeredByUserId: ctx.triggeredByUserId,
        triggeredByJob: ctx.triggeredByJob,
        payload: {
          ...(ctx.payload ?? {}),
          ensure_operational: true,
          ensure_operational_from: fromState,
          ensure_operational_route: route,
          ensure_operational_hop: hop + 1,
        },
      });
      walked.push(step);
    }

    await this.applyReactivationWindow(tx, {
      subscriptionId: current.id,
      storeId,
      now,
      originalPeriodEnd: this.asDate(current.current_period_end),
      scheduledCancelAt: this.asDate(current.scheduled_cancel_at),
      planId: ctx.planId ?? current.plan_id,
      ctx,
      // Recovering from a degraded state: a row with no window at all needs
      // one minted. Pre-existing behaviour, kept explicit.
      missingWindowCountsAsSpent: true,
    });

    // EXIT GUARD — re-read from the database instead of trusting the writes
    // above. `findFirst` (not `findUnique`) per vendix-prisma-scopes: it stays
    // valid if this ever runs through a scoped client.
    const finalRow = (await tx.store_subscriptions.findFirst({
      where: { store_id: storeId },
      select: {
        state: true,
        current_period_end: true,
        scheduled_cancel_at: true,
      },
    })) as {
      state: State;
      current_period_end: Date | null;
      scheduled_cancel_at: Date | null;
    } | null;

    const finalState = finalRow?.state ?? null;

    if (finalState !== 'active' && finalState !== 'trial') {
      this.logger.error(
        `ENSURE_OPERATIONAL_FAILED store=${storeId} from=${fromState} ` +
          `route=[${route.join('->')}] walked=[${walked.join('->')}] ` +
          `final=${finalState ?? 'missing'} reason=${ctx.reason}`,
      );
      // Deliberately SUBSCRIPTION_INTERNAL_ERROR (500) and not
      // SUBSCRIPTION_010 (409): the client did nothing wrong and the path was
      // legal — a server invariant broke. A 5xx is what stops the caller from
      // reporting a success the store cannot honour.
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
        `Reactivation did not leave store ${storeId} operational ` +
          `(from=${fromState}, walked=[${walked.join('->')}], final=${finalState ?? 'missing'})`,
      );
    }

    this.logger.log(
      `ENSURE_OPERATIONAL_OK store=${storeId} from=${fromState} ` +
        `walked=[${walked.join('->')}] final=${finalState} reason=${ctx.reason}`,
    );

    return { finalState, path: walked, fromState };
  }

  /**
   * Reset the billing window and wipe every column that could re-degrade the
   * store right after it was reactivated.
   *
   * `scheduled_cancel_at` is the important one: a reactivation VOIDS any
   * end-of-cycle cancellation, otherwise a cron would cancel exactly what the
   * customer just paid for. `suspend_at` / `cancel_at` are stale dunning
   * deadlines computed off the lapsed period and must not survive either.
   * `grace_soft_until` / `grace_hard_until` / `lock_reason` are already
   * cleared by `transition()` on the way into `active`.
   *
   * `auto_renew` NO se impone
   * -------------------------
   * Esta línea escribía `auto_renew: true` sin condición y era el punto exacto
   * donde se perdía el apagado del gate: `handleChargeSuccess` pausa el autopago
   * por falta de tarjeta y DESPUÉS, en la MISMA transacción, llamaba aquí. El
   * apagado solo sobrevivía si la suscripción ya estaba `active` (no pasa por
   * esta ruta); en el primer checkout y en toda reactivación desde
   * gracia/suspendida/cancelada/vencida se perdía.
   *
   * Ahora el valor lo decide `renewal-eligibility.contract.ts`. Sin medio apto
   * queda en `false` y la intención del cliente se recuerda en
   * `metadata.auto_renew_intent` para el rearme automático.
   */
  /**
   * Has the billing window on the row been spent — i.e. does this collection
   * have to rebuild the cycle?
   *
   * ONE implementation, consulted by both routes of the seam (the hop route
   * and the already-operational route). It exists as a named predicate
   * precisely so the two cannot answer differently: the incident that produced
   * it was a paid renewal whose period was never advanced because the
   * already-operational route returned before the window writer ever ran.
   *
   * `missingCountsAsSpent` is the single axis on which the two routes
   * legitimately differ, so it is a parameter rather than a second predicate:
   *  - hop route (`true`): the store was degraded; a row with no window at all
   *    needs one minted for it.
   *  - already-operational route (`false`): an `active` row carrying a null
   *    window is left untouched — minting a cycle there is a behaviour change
   *    no incident asked for.
   */
  private isWindowSpent(params: {
    originalPeriodEnd: Date | null;
    now: Date;
    requestedPeriodEnd?: Date;
    missingCountsAsSpent: boolean;
  }): boolean {
    if (params.requestedPeriodEnd) {
      return true;
    }
    if (params.originalPeriodEnd === null) {
      return params.missingCountsAsSpent;
    }
    return params.originalPeriodEnd.getTime() <= params.now.getTime();
  }

  private async applyReactivationWindow(
    tx: any,
    args: {
      subscriptionId: number;
      storeId: number;
      now: Date;
      originalPeriodEnd: Date | null;
      scheduledCancelAt: Date | null;
      planId: number | null;
      ctx: EnsureOperationalContext;
      /** See `isWindowSpent`. */
      missingWindowCountsAsSpent: boolean;
    },
    // Returns whether the paid window was actually rebuilt, so the callers can
    // log which of the two outcomes they got.
  ): Promise<boolean> {
    const { subscriptionId, storeId, now, originalPeriodEnd, planId, ctx } =
      args;

    const existing = (await tx.store_subscriptions.findFirst({
      where: { id: subscriptionId },
      select: { auto_renew: true, metadata: true },
    })) as { auto_renew: boolean | null; metadata: unknown } | null;

    const autoRenew = await this.resolveAutoRenewForReactivation(tx, {
      subscriptionId,
      storeId,
      currentAutoRenew: existing?.auto_renew ?? null,
      metadata: existing?.metadata ?? null,
      source: 'reactivation_window',
      now,
    });

    const data: Prisma.store_subscriptionsUncheckedUpdateInput = {
      scheduled_cancel_at: null,
      auto_renew: autoRenew.auto_renew,
      suspend_at: null,
      cancel_at: null,
      updated_at: now,
    };

    if (autoRenew.metadata !== undefined) {
      data.metadata = autoRenew.metadata;
    }

    // Only rebuild the window when the paid one actually ran out (or the
    // caller pinned one). A mid-period `blocked` store recovering must keep
    // the window it already paid for.
    const rebuildWindow = this.isWindowSpent({
      originalPeriodEnd,
      now,
      requestedPeriodEnd: ctx.periodEnd,
      missingCountsAsSpent: args.missingWindowCountsAsSpent,
    });

    if (rebuildWindow) {
      const cycleDays = ctx.periodEnd
        ? DEFAULT_CYCLE_DAYS // unused: an explicit periodEnd is the base
        : await this.resolveCycleDays(tx, planId);

      const window = this.computeReactivationWindow({
        now,
        originalPeriodEnd,
        cycleDays,
        requestedPeriodEnd: ctx.periodEnd,
      });

      data.current_period_start = now;
      data.current_period_end = window.periodEnd;
      data.next_billing_at = window.periodEnd;

      // A rebuilt window voids the dunning clocks: `grace_soft_until`,
      // `grace_hard_until` and `lock_reason` were all derived from the period
      // that just got replaced, so leaving them would let the
      // `subscription-state-engine` degrade a store that has just paid — on
      // deadlines that no longer describe anything. `transitionInTx` already
      // applies exactly this policy when it walks into `active`/`trial`; the
      // no-op route walks no hop, so the clearing has to live here to cover
      // both callers with one rule instead of two that can drift.
      data.grace_soft_until = null;
      data.grace_hard_until = null;
      data.lock_reason = null;

      this.logger.log(
        `ENSURE_OPERATIONAL_WINDOW store=${storeId} ` +
          `original_period_end=${originalPeriodEnd?.toISOString() ?? 'null'} ` +
          `cycle_days=${ctx.periodEnd ? 'explicit' : cycleDays} ` +
          `grace_days_consumed=${window.graceDaysConsumed} ` +
          `discount_days=${window.discountDays}${window.clamped ? ' (clamped)' : ''} ` +
          `new_period_end=${window.periodEnd.toISOString()}`,
      );

      if (window.clamped) {
        this.logger.warn(
          `ENSURE_OPERATIONAL_WINDOW_CLAMPED store=${storeId}: consumed grace ` +
            `(${window.graceDaysConsumed}d) exceeded the cycle; discount capped ` +
            `at ${window.discountDays}d to keep the new period in the future`,
        );
      }
    }

    await tx.store_subscriptions.update({
      where: { id: subscriptionId },
      data,
    });

    return rebuildWindow;
  }

  /**
   * New period end, discounting the whole days the customer already consumed
   * operating past the lapsed period end.
   *
   * Whole days only — a partial day of grace is not deducted, which rounds in
   * the customer's favour and keeps the arithmetic reproducible.
   *
   * All arithmetic is on absolute UTC instants (`getTime()` deltas), never on
   * local calendar components, so it is DST- and timezone-independent:
   * `current_period_end` / `next_billing_at` are billing instants, not
   * date-only business fields, so the store-timezone bucketing rules from
   * `vendix-date-timezone` do not apply here.
   */
  private computeReactivationWindow(params: {
    now: Date;
    originalPeriodEnd: Date | null;
    cycleDays: number;
    requestedPeriodEnd?: Date;
  }): {
    periodEnd: Date;
    graceDaysConsumed: number;
    discountDays: number;
    clamped: boolean;
  } {
    const nowMs = params.now.getTime();
    const baseMs = params.requestedPeriodEnd
      ? params.requestedPeriodEnd.getTime()
      : nowMs + params.cycleDays * DAY_MS;

    const overdueMs = params.originalPeriodEnd
      ? nowMs - params.originalPeriodEnd.getTime()
      : 0;
    const graceDaysConsumed =
      overdueMs > 0 ? Math.floor(overdueMs / DAY_MS) : 0;

    // Never hand back a window that is already over: that would drop the
    // store straight back into dunning, i.e. the exact degradation this seam
    // exists to prevent. Keep at least one day of runway.
    const maxDiscountMs = Math.max(0, baseMs - nowMs - DAY_MS);
    const wantedDiscountMs = graceDaysConsumed * DAY_MS;
    const discountMs = Math.min(wantedDiscountMs, maxDiscountMs);

    return {
      periodEnd: new Date(baseMs - discountMs),
      graceDaysConsumed,
      discountDays: Math.floor(discountMs / DAY_MS),
      clamped: discountMs < wantedDiscountMs,
    };
  }

  private async resolveCycleDays(
    tx: any,
    planId: number | null,
  ): Promise<number> {
    if (!planId) {
      return DEFAULT_CYCLE_DAYS;
    }
    const plan = (await tx.subscription_plans.findUnique({
      where: { id: planId },
      select: { billing_cycle: true },
    })) as { billing_cycle: string | null } | null;
    const cycle = plan?.billing_cycle ?? undefined;
    return (cycle ? BILLING_CYCLE_DAYS[cycle] : undefined) ?? DEFAULT_CYCLE_DAYS;
  }

  /** Raw-query columns can arrive as strings depending on the driver path. */
  private asDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    return value instanceof Date ? value : new Date(value);
  }

  /**
   * Schedule a subscription to be cancelled at the end of the current billing
   * period. Sets `scheduled_cancel_at` to the subscription's
   * `current_period_end` and disables auto-renew.
   */
  async scheduleCancel(
    storeId: number,
    periodEnd: Date,
    opts: TransitionOptions,
  ): Promise<store_subscriptions> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }

    const updated = await this.prisma.store_subscriptions.update({
      where: { store_id: storeId },
      data: {
        scheduled_cancel_at: periodEnd,
        auto_renew: false,
        updated_at: new Date(),
      },
    });

    await this.prisma.subscription_events.create({
      data: {
        store_subscription_id: updated.id,
        type: 'scheduled_cancel',
        from_state: updated.state,
        to_state: 'cancelled',
        payload: {
          reason: opts.reason,
          kind: 'scheduled_cancel',
          scheduled_cancel_at: periodEnd.toISOString(),
        } as Prisma.InputJsonValue,
        triggered_by_user_id: opts.triggeredByUserId ?? null,
        triggered_by_job: opts.triggeredByJob ?? null,
      },
    });

    try {
      await this.accessService.invalidateCache(storeId);
    } catch (err) {
      this.logger.warn(
        `Post-schedule-cancel cache invalidation failed for store ${storeId}: ${(err as Error).message}`,
      );
    }

    this.eventEmitter.emit('subscription.state.changed', {
      storeId,
      fromState: updated.state,
      toState: 'cancelled',
      reason: opts.reason,
      triggeredByUserId: opts.triggeredByUserId,
      triggeredByJob: opts.triggeredByJob,
    });

    return updated;
  }

  /**
   * Revert a scheduled cancellation before period_end.
   * Clears scheduled_cancel_at and restores auto_renew **si hay medio apto**.
   * Returns the updated subscription (state stays unchanged).
   *
   * Volver a encender el autopago sin tarjeta cobrable reproducía el incidente:
   * el cliente cree que sigue renovando y la renovación falla en silencio. Sin
   * medio apto se deshace la cancelación (que es lo que el cliente pidió) pero el
   * autopago queda pausado con la intención recordada para el rearme automático.
   */
  async unscheduleCancel(
    storeId: number,
    opts: TransitionOptions,
  ): Promise<store_subscriptions> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
    });
    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }
    if (!sub.scheduled_cancel_at) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'No scheduled cancellation to revert',
      );
    }

    const now = new Date();
    const autoRenew = await this.resolveAutoRenewForReactivation(this.prisma, {
      subscriptionId: sub.id,
      storeId,
      currentAutoRenew: sub.auto_renew ?? null,
      metadata: sub.metadata ?? null,
      source: 'unschedule_cancel',
      now,
    });

    const updated = await this.prisma.store_subscriptions.update({
      where: { store_id: storeId },
      data: {
        scheduled_cancel_at: null,
        auto_renew: autoRenew.auto_renew,
        ...(autoRenew.metadata !== undefined
          ? { metadata: autoRenew.metadata }
          : {}),
        updated_at: now,
      },
    });

    await this.prisma.subscription_events.create({
      data: {
        store_subscription_id: updated.id,
        type: 'activated',
        from_state: updated.state,
        to_state: updated.state,
        payload: {
          reason: opts.reason,
          kind: 'scheduled_cancel_voided',
          previous_scheduled_cancel_at: sub.scheduled_cancel_at.toISOString(),
          auto_renew_restored: autoRenew.auto_renew,
          auto_renew_paused_reason: autoRenew.auto_renew
            ? null
            : AUTO_RENEW_PAUSE_REASON_NO_CARD,
        } as Prisma.InputJsonValue,
        triggered_by_user_id: opts.triggeredByUserId ?? null,
        triggered_by_job: opts.triggeredByJob ?? null,
      },
    });

    try {
      await this.accessService.invalidateCache(storeId);
    } catch (err) {
      this.logger.warn(
        `Post-unschedule-cancel cache invalidation failed for store ${storeId}: ${(err as Error).message}`,
      );
    }

    this.eventEmitter.emit('subscription.state.changed', {
      storeId,
      fromState: updated.state,
      toState: updated.state,
      reason: opts.reason,
      triggeredByUserId: opts.triggeredByUserId,
      triggeredByJob: opts.triggeredByJob,
    });

    return updated;
  }

  /**
   * Evaluate dunning windows for a single subscription and apply the
   * appropriate state transition if a deadline has been crossed.
   *
   * This is the per-subscription core that powers BOTH:
   *  - `SubscriptionStateEngineJob` (cron at 03:00 UTC, iterates non-terminal subs)
   *  - Event-driven listener `onPaymentFailed` (immediate evaluation when a
   *    charge or retry fails, gated by `SUBSCRIPTION_EVENT_DRIVEN_STATE=true`)
   *
   * Logic mirrors `SubscriptionStateEngineJob.processSubscription`:
   *  1. Promo expiry — if `promo_rules.ends_at` has passed, clear it.
   *  2. Trial expiry — if `trial_ends_at` has passed and currently `trial`,
   *     transition to `grace_soft` (had at least one successful payment) or
   *     `blocked` otherwise.
   *  3. Period expiry — compute soft/hard/suspension/cancellation deadlines
   *     from `current_period_end` + plan dunning offsets and transition to
   *     the deepest crossed deadline.
   *
   * Cache invalidation and event emission are handled by `transition()`.
   */
  async evaluateAndTransitionForSubscription(
    subscriptionId: number,
  ): Promise<void> {
    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: {
          select: {
            state: true,
            archived_at: true,
            grace_period_soft_days: true,
            grace_period_hard_days: true,
            suspension_day: true,
            cancellation_day: true,
          },
        },
        promotional_plan: {
          select: {
            id: true,
            promo_rules: true,
          },
        },
      },
    });

    if (!sub) {
      this.logger.warn(
        `evaluateAndTransitionForSubscription: subscription ${subscriptionId} not found`,
      );
      return;
    }

    // Skip terminal / non-evaluable states. The cron uses the same filter
    // (notIn ['cancelled','expired','draft']) to pick rows; here we
    // short-circuit when called via event.
    if (
      sub.state === 'cancelled' ||
      sub.state === 'expired' ||
      sub.state === 'draft' ||
      sub.state === 'no_plan'
    ) {
      // RNC-39: no_plan rows have no plan_id and no billing window. They are
      // not subject to dunning/promo/trial transitions until the user picks a
      // plan via the subscribe flow.
      this.logger.debug(
        `evaluateAndTransitionForSubscription: sub ${subscriptionId} in terminal/draft state ${sub.state}, skipping`,
      );
      return;
    }

    const now = new Date();
    const currentState = sub.state as State;
    const plan = sub.plan;

    // 1. Promo expiry
    if (
      sub.promotional_plan_id &&
      sub.promotional_plan &&
      sub.promotional_plan.promo_rules
    ) {
      const rules =
        typeof sub.promotional_plan.promo_rules === 'string'
          ? JSON.parse(sub.promotional_plan.promo_rules)
          : (sub.promotional_plan.promo_rules as Record<string, unknown>);
      const endsAt = (rules as { ends_at?: string })?.ends_at;
      if (endsAt && new Date(endsAt) < now) {
        await this.prisma.store_subscriptions.update({
          where: { id: sub.id },
          data: {
            promotional_plan_id: null,
            promotional_applied_at: null,
            updated_at: now,
          },
        });
      }
    }

    // 2. Trial expiry (RNC-06: auto_convert_at_end)
    if (
      sub.trial_ends_at &&
      new Date(sub.trial_ends_at) < now &&
      currentState === 'trial'
    ) {
      const metadata = sub.metadata as Record<string, unknown> | null;
      const autoConvert = metadata?.auto_convert_at_end !== false;

      if (autoConvert) {
        const hasActivePM =
          await this.prisma.subscription_payment_methods.findFirst({
            where: { store_subscription_id: sub.id, state: 'active' },
          });
        if (hasActivePM) {
          await this.transition(sub.store_id, 'active', {
            reason: 'Trial ended — auto-convert with valid PM',
            triggeredByJob: 'subscription-state-engine',
            payload: { trial_ends_at: sub.trial_ends_at, auto_converted: true },
          });
          // Re-issue invoice for the trial plan's base_price (if > 0)
          // The renewal billing cron handles this; just promote state.
          return;
        }
      }

      await this.transition(sub.store_id, 'expired', {
        reason:
          'Trial period ended without payment method or auto_convert=false',
        triggeredByJob: 'subscription-state-engine',
        payload: { trial_ends_at: sub.trial_ends_at },
      });
      return;
    }

    // 3. Period expiry — dunning windows
    if (sub.current_period_end && new Date(sub.current_period_end) < now) {
      const periodEnd = new Date(sub.current_period_end);
      // RNC-23: read dunning cadence from the plan. Defaults (5/10/14/45) are
      // applied here as a safety net for legacy rows where the plan FK is
      // somehow null/missing or where a plan predates the cadence columns.
      const softDays = plan?.grace_period_soft_days ?? 5;
      const hardDays = plan?.grace_period_hard_days ?? 10;
      const suspensionDay = plan?.suspension_day ?? 14;
      const cancellationDay = plan?.cancellation_day ?? 45;
      const planUnavailable =
        !!plan &&
        ((plan.state != null && plan.state !== 'active') || !!plan.archived_at);

      const softDeadline = new Date(
        periodEnd.getTime() + softDays * 24 * 60 * 60 * 1000,
      );
      const hardDeadline = new Date(
        periodEnd.getTime() + hardDays * 24 * 60 * 60 * 1000,
      );
      const suspendDeadline = new Date(
        periodEnd.getTime() + suspensionDay * 24 * 60 * 60 * 1000,
      );
      const cancelDeadline = new Date(
        periodEnd.getTime() + cancellationDay * 24 * 60 * 60 * 1000,
      );

      let targetState: State | null = null;
      let reason = '';

      if (now >= cancelDeadline) {
        targetState = 'cancelled';
        reason = 'Past cancellation day';
      } else if (now >= suspendDeadline) {
        targetState = 'suspended';
        reason = 'Past suspension day';
      } else if (now >= hardDeadline) {
        targetState = 'grace_hard';
        reason = 'Past hard grace period';
      } else if (now >= softDeadline || planUnavailable) {
        targetState = 'grace_soft';
        reason = planUnavailable
          ? 'Current plan unavailable after period end'
          : 'Past soft grace period';
      }

      if (targetState && targetState !== currentState) {
        // BUSINESS RULE — the real motive of a lock is stamped WHERE IT
        // ORIGINATES and SURVIVES the escalation grace_soft → grace_hard →
        // suspended.
        //
        // This used to write 'past_due' unconditionally on the suspension rung,
        // which overwrote the true motive: a store whose plan was retired was
        // then told it owed money. It owes nothing, and a debt that does not
        // exist cannot be collected — that is false information billed to the
        // customer. So an existing non-null `lock_reason` always wins, and
        // 'past_due' is stamped only when there is no prior motive (the
        // ordinary impago path, whose behaviour is unchanged).
        const existingLockReason = sub.lock_reason ?? null;
        const originLockReason =
          existingLockReason ??
          (planUnavailable ? LOCK_REASON_PLAN_RETIRED : null);
        const dunningLockReason =
          targetState === 'suspended'
            ? (originLockReason ?? LOCK_REASON_PAST_DUE)
            : (originLockReason ?? undefined);

        await this.transition(sub.store_id, targetState, {
          reason,
          triggeredByJob: 'subscription-state-engine',
          // transition() persists this only for grace_soft / grace_hard /
          // suspended / blocked; on the cancellation rung it is ignored.
          lockReason: dunningLockReason,
          graceSoftUntil: softDeadline,
          graceHardUntil: hardDeadline,
          payload: {
            current_period_end: sub.current_period_end,
            soft_deadline: softDeadline.toISOString(),
            hard_deadline: hardDeadline.toISOString(),
            suspend_deadline: suspendDeadline.toISOString(),
            cancel_deadline: cancelDeadline.toISOString(),
            plan_unavailable: planUnavailable,
            plan_state: plan?.state ?? null,
            plan_archived_at: plan?.archived_at?.toISOString() ?? null,
            // Auditable trace of the motive decision: what the row carried
            // before the rung and what this rung persisted (null = intact).
            previous_lock_reason: existingLockReason,
            lock_reason: dunningLockReason ?? null,
          },
        });
      }
    }

    // 4. expired → cancelled after prolonged inactivity (RNC-38)
    if (currentState === 'expired' && sub.cancelled_at === null) {
      const cancellationDay = plan?.cancellation_day ?? 45;
      const expiredSince = sub.current_period_end ?? sub.updated_at;
      if (expiredSince) {
        const cancelThreshold = new Date(
          new Date(expiredSince).getTime() +
            cancellationDay * 24 * 60 * 60 * 1000,
        );
        if (now >= cancelThreshold) {
          await this.transition(sub.store_id, 'cancelled', {
            reason: 'Expired — prolonged inactivity',
            triggeredByJob: 'subscription-state-engine',
            payload: { expired_since: expiredSince.toISOString() },
          });
        }
      }
    }
  }

  /**
   * Resolve subscriptionId from a `subscription.payment.failed` payload.
   * Original emitter only carries invoiceId; we need subscriptionId to
   * call `evaluateAndTransitionForSubscription`. Retry-job emitter carries
   * subscriptionId directly.
   */
  private async resolveSubscriptionIdFromPayload(
    payload: PaymentFailedEventPayload,
  ): Promise<number | null> {
    if (
      typeof payload.subscriptionId === 'number' &&
      Number.isInteger(payload.subscriptionId) &&
      payload.subscriptionId > 0
    ) {
      return payload.subscriptionId;
    }

    if (!Number.isInteger(payload.invoiceId) || payload.invoiceId <= 0) {
      return null;
    }

    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: payload.invoiceId },
      select: { store_subscription_id: true },
    });
    return invoice?.store_subscription_id ?? null;
  }

  /**
   * Event-driven dunning hook.
   *
   * When a SaaS charge fails (synchronous via `SubscriptionPaymentService`
   * or async via the BullMQ retry processor), evaluate the subscription's
   * dunning windows immediately instead of waiting for the daily 03:00 cron.
   *
   * Feature-flagged via `SUBSCRIPTION_EVENT_DRIVEN_STATE`:
   *  - `'true'`  -> immediate evaluation
   *  - anything else -> no-op (cron remains the canonical path)
   *
   * Failures are caught and logged — they MUST NOT propagate, because:
   *  - the originating emit() is fire-and-forget; throwing breaks unrelated listeners
   *  - the daily cron will perform the canonical evaluation if this best-effort path fails
   */
  @OnEvent('subscription.payment.failed')
  async onPaymentFailed(payload: PaymentFailedEventPayload): Promise<void> {
    return this.handlePaymentFailedEvent(
      payload,
      'subscription.payment.failed',
    );
  }

  /**
   * Same handling as `subscription.payment.failed` but for the BullMQ retry
   * processor's emission. Payload shape includes subscriptionId/storeId
   * directly, so resolution skips the invoice lookup.
   */
  @OnEvent('subscription.payment.retry.failed')
  async onPaymentRetryFailed(
    payload: PaymentFailedEventPayload,
  ): Promise<void> {
    return this.handlePaymentFailedEvent(
      payload,
      'subscription.payment.retry.failed',
    );
  }

  private async handlePaymentFailedEvent(
    payload: PaymentFailedEventPayload,
    eventName: string,
  ): Promise<void> {
    if (process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE !== 'true') {
      this.logger.debug(
        `Event-driven state disabled — skipping immediate eval for invoice ${payload?.invoiceId} (event=${eventName})`,
      );
      return;
    }

    try {
      const subscriptionId =
        await this.resolveSubscriptionIdFromPayload(payload);

      if (!subscriptionId) {
        this.logger.warn(
          `Event-driven state: could not resolve subscriptionId from payload (event=${eventName}, invoiceId=${payload?.invoiceId})`,
        );
        return;
      }

      await this.evaluateAndTransitionForSubscription(subscriptionId);

      this.logger.log(
        `Event-driven state evaluated sub ${subscriptionId} after ${eventName} (invoice ${payload?.invoiceId})`,
      );
    } catch (e: any) {
      // Best-effort path: never re-throw. The 03:00 cron is the canonical
      // source of truth for state transitions and will reconcile any sub
      // that this listener failed to advance.
      this.logger.error(
        `Event-driven state eval failed for invoice ${payload?.invoiceId} (event=${eventName}): ${e?.message ?? e}`,
      );
    }
  }
}
