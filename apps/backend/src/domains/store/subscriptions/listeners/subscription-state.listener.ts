import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { SubscriptionStateService } from '../services/subscription-state.service';

/**
 * Payload emitted by:
 *  - SubscriptionPaymentService.handleChargeSuccess (sync charge + webhook
 *    flow) — carries subscriptionId + storeId resolved from the invoice.
 *  - SubscriptionWebhookService.handleWompiEvent — observability hook with
 *    the same shape (subscriptionId + storeId may be present).
 *
 * `storeId` is required for SubscriptionStateService.transition() (which
 * locks `store_subscriptions` by `store_id`). When missing we resolve it
 * from the invoice as a fallback.
 */
interface PaymentSucceededEventPayload {
  invoiceId: number;
  paymentId: number;
  subscriptionId?: number;
  storeId?: number;
  source?: string;
}

/**
 * Auto-promotes a subscription to `active` the moment its payment is
 * confirmed.
 *
 * Triggered by `subscription.payment.succeeded`, which fires from:
 *  - `SubscriptionPaymentService.handleChargeSuccess` (post-commit) for
 *    both the synchronous `charge()` path and the webhook-driven
 *    `markPaymentSucceededFromWebhook` path.
 *  - `SubscriptionWebhookService.handleWompiEvent` as an observability hook
 *    (same event name, idempotent on listener side).
 *
 * Promotable source states:
 *  - `pending_payment` — fresh purchase awaiting first Wompi confirmation.
 *  - `grace_soft`, `grace_hard` — recovered after a missed renewal.
 *  - `blocked` — recovered after dunning blocked the subscription.
 *
 * Idempotency: the underlying `transition()` is a no-op when the source
 * state already equals the target (`active`), so duplicate webhook deliveries
 * are safe. We also short-circuit explicitly for clarity + log noise.
 *
 * Errors are caught and logged. Webhook responses MUST NOT fail because of
 * a state-promotion hiccup — the daily 03:00 dunning cron is the canonical
 * reconciliation path.
 */
@Injectable()
export class SubscriptionStateListener {
  private readonly logger = new Logger(SubscriptionStateListener.name);

  // States from which a successful payment SHOULD promote the subscription
  // back to `active`. Excludes terminal states (cancelled/expired) and
  // already-active/trial states (which are no-ops anyway).
  private static readonly PROMOTABLE_FROM: readonly string[] = [
    'pending_payment',
    'grace_soft',
    'grace_hard',
    'blocked',
  ];

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
  ) {}

  @OnEvent('subscription.payment.succeeded')
  async onPaymentSucceeded(
    payload: PaymentSucceededEventPayload,
  ): Promise<void> {
    try {
      // Resolve subscriptionId + storeId. They may be missing on the
      // observability emit from SubscriptionWebhookService when the upstream
      // emitter wasn't updated. Fall back to invoice lookup.
      let subscriptionId = payload?.subscriptionId;
      let storeId = payload?.storeId;

      if (!subscriptionId || !storeId) {
        if (
          !Number.isInteger(payload?.invoiceId) ||
          (payload?.invoiceId as number) <= 0
        ) {
          this.logger.warn(
            'subscription.payment.succeeded: invalid payload, no invoiceId to resolve from',
          );
          return;
        }

        // withoutScope: webhook/event flow has no tenant context.
        const invoice = await this.prisma
          .withoutScope()
          .subscription_invoices.findUnique({
            where: { id: payload.invoiceId },
            select: { store_subscription_id: true, store_id: true },
          });

        if (!invoice) {
          this.logger.warn(
            `subscription.payment.succeeded: invoice ${payload.invoiceId} not found`,
          );
          return;
        }

        subscriptionId = subscriptionId ?? invoice.store_subscription_id;
        storeId = storeId ?? invoice.store_id;
      }

      if (!subscriptionId || !storeId) {
        this.logger.warn(
          `subscription.payment.succeeded: could not resolve subscriptionId/storeId (invoice=${payload?.invoiceId})`,
        );
        return;
      }

      const sub = await this.prisma
        .withoutScope()
        .store_subscriptions.findUnique({
          where: { id: subscriptionId },
          select: { id: true, state: true, store_id: true },
        });

      if (!sub) {
        this.logger.warn(
          `subscription.payment.succeeded: subscription ${subscriptionId} not found`,
        );
        return;
      }

      if (
        !SubscriptionStateListener.PROMOTABLE_FROM.includes(
          sub.state as string,
        )
      ) {
        this.logger.debug(
          `subscription ${sub.id} already in state '${sub.state}', no promotion needed (source=${payload?.source ?? 'unknown'})`,
        );
        return;
      }

      await this.stateService.transition(sub.store_id, 'active', {
        reason: 'payment_succeeded_webhook',
        triggeredByJob: 'subscription-state-listener',
        payload: {
          invoice_id: payload.invoiceId,
          payment_id: payload.paymentId,
          source: payload.source ?? 'unknown',
          previous_state: sub.state,
        },
      });

      this.logger.log(
        `Subscription ${sub.id} auto-promoted ${sub.state} -> active after payment ${payload.paymentId} (invoice ${payload.invoiceId}, source=${payload.source ?? 'unknown'})`,
      );
    } catch (e: any) {
      // Best-effort: never re-throw. The daily dunning cron will reconcile
      // any subscription this listener failed to promote.
      this.logger.error(
        `subscription.payment.succeeded handler failed (invoice=${payload?.invoiceId}, payment=${payload?.paymentId}): ${e?.message ?? e}`,
        e?.stack,
      );
    }
  }
}
