import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

/**
 * Payload emitted by `SubscriptionPaymentService.handleChargeSuccess` AFTER
 * the in-tx `disableAutoRenewForMissingCredential` flipped `auto_renew` off
 * because the gateway approved a charge but no recurring
 * `subscription_payment_methods` row was persisted (no
 * `payment_source_id` / `cof_registered_at`).
 *
 * `subscriptionEventId` is the new `subscription_events.id` row the gate
 * stamped — the dedupe anchor for the bell + email. `storeId` + `paymentId`
 * are carried for routing + observability only.
 */
interface NoCredentialEventPayload {
  subscriptionEventId: number;
  storeId: number | undefined;
  paymentId: number;
  source?: string;
}

/**
 * Listens for `subscription.payment.no_credential` and:
 *
 *   1. Upserts a `billing_warning_logs` row keyed by
 *      (store_id, 'auto_renew_disabled_no_credential', source_event_id).
 *      UNIQUE on that triple is the dedupe — a retry of the same charge
 *      collapses to a single warning row, so the bell + email fire at most
 *      once per source event.
 *   2. On first insert (no P2002), broadcasts the bell via
 *      `notificationsService.createAndBroadcast` so the merchant sees the
 *      warning in the admin panel + as a web push.
 *   3. Enqueues an `email-notifications` BullMQ job carrying the event id +
 *      store id so a transactional email is rendered + sent. Enqueue is
 *      best-effort (try/catch) so the listener never breaks the charge path
 *      that already committed.
 *
 * Errors are swallowed and logged. The audit row IS the source of truth —
 * the bell + email are user-facing affordances layered on top of it, and
 * missing them is recoverable (the cron can re-attempt the bell from the
 * billing_warning_logs table if needed in a future iteration).
 */
@Injectable()
export class SubscriptionPaymentBillingWarningListener {
  private readonly logger = new Logger(
    SubscriptionPaymentBillingWarningListener.name,
  );

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly notificationsService: NotificationsService,
    @InjectQueue('email-notifications')
    private readonly emailQueue: Queue,
  ) {}

  @OnEvent('subscription.payment.no_credential')
  async onNoCredential(payload: NoCredentialEventPayload): Promise<void> {
    try {
      const subscriptionEventId = payload?.subscriptionEventId;
      const rawStoreId = payload?.storeId;
      // Narrow undefined out before the > 0 check — the typeof guards make
      // both fields `number` for the rest of the handler.
      if (
        !Number.isInteger(subscriptionEventId) ||
        (subscriptionEventId as number) <= 0 ||
        !Number.isInteger(rawStoreId) ||
        (rawStoreId as number) <= 0
      ) {
        this.logger.warn(
          `subscription.payment.no_credential: invalid payload, missing subscriptionEventId or storeId`,
        );
        return;
      }
      const storeId = rawStoreId as number;

      // Dedupe row. Unique(store_id, type, source_event_id) — a P2002 here
      // means another listener instance / retry already stamped this event,
      // and the bell + email were already enqueued. Skip both.
      //
      // KNOWN TS GAP: `billing_warning_logs` was added in Step 1's migration
      // but the workspace-root `@prisma/client` generated snapshot does not
      // expose the delegate on `GlobalPrismaService`. Mirror the workaround
      // from `apps/backend/src/jobs/billing-warning.processor.ts` — cast to
      // `any` and trust the runtime client. Once the generated client catches
      // up this cast disappears.
      let firstInsert = false;
      try {
        await (this.prisma as any).billing_warning_logs.create({
          data: {
            store_id: storeId,
            type: 'auto_renew_disabled_no_credential',
            source_event_id: subscriptionEventId,
          },
        });
        firstInsert = true;
      } catch (e: any) {
        if (e?.code !== 'P2002') {
          throw e;
        }
        this.logger.log(
          `billing_warning_logs dedupe hit for store=${storeId} type=auto_renew_disabled_no_credential event=${subscriptionEventId}; skipping bell+email`,
        );
        return;
      }

      if (!firstInsert) {
        return;
      }

      // Bell + web push. notificationsService swallows internally; failures
      // here do NOT block the email enqueue.
      try {
        await this.notificationsService.createAndBroadcast(
          storeId,
          'auto_renew_disabled_no_credential',
          'Tu autopago no se pudo activar',
          'Tu renovación automática quedó desactivada porque el cargo no incluyó una credencial recurrente. Agrega un método de pago para reactivar la renovación y evitar la interrupción del servicio.',
          {
            subscriptionEventId,
            route: '/admin/subscription/payment',
          },
        );
      } catch (e: any) {
        this.logger.warn(
          `createAndBroadcast failed for store=${storeId} event=${subscriptionEventId}: ${e?.message ?? e}`,
        );
      }

      // Email enqueue. Mirrors the `commissionQueue.add` try/catch shape
      // from subscription-payment.service.ts:1967-1976 — best-effort, the
      // audit row is the source of truth.
      try {
        await this.emailQueue.add(
          'subscription.billing.no-credential.email',
          { storeId, subscriptionEventId },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 3600, count: 100 },
            removeOnFail: { age: 86400 },
          },
        );
      } catch (e: any) {
        this.logger.warn(
          `email-notifications enqueue failed for store=${storeId} event=${subscriptionEventId}: ${e?.message ?? e}`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `subscription.payment.no_credential handler crashed: ${err?.message ?? err}`,
        err?.stack,
      );
    }
  }
}
