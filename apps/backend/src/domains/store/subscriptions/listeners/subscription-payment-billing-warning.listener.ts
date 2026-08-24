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
  /**
   * Intento de pago que originó la pausa. OPCIONAL: el cron de renovación y el
   * pago manual del administrador pausan sin que exista un intento de cobro
   * asociado, y ahí el aviso es igual de necesario.
   */
  paymentId?: number | null;
  source?: string;
}

/**
 * Payload de `subscription.auto_renew.rearmed`, emitido después del commit por
 * los DOS caminos que guardan una tarjeta:
 *   - `SubscriptionPaymentMethodsService.tokenizeAndRegister` (alta explícita).
 *   - `SubscriptionPaymentService.handleChargeSuccess` (tarjeta con la que se
 *     pagó una factura por el widget).
 *
 * `paymentMethodId` puede venir null desde el cobro (el auto-registro no devuelve
 * la fila al llamador); el listener lo resuelve para tener un ancla de dedupe
 * estable.
 */
interface AutoRenewRearmedEventPayload {
  storeId: number | undefined;
  subscriptionId?: number | null;
  paymentMethodId?: number | null;
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
      let firstInsert = false;
      try {
        await this.prisma.billing_warning_logs.create({
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

      // Resolve latest issued invoice for details (amount & due date)
      const latestInvoice = await this.prisma.subscription_invoices.findFirst({
        where: {
          store_id: storeId,
          state: { in: ['issued', 'overdue'] },
        },
        orderBy: { id: 'desc' },
      });

      const amountFormatted = latestInvoice
        ? new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: latestInvoice.currency || 'COP',
            maximumFractionDigits: 0,
          }).format(Number(latestInvoice.total))
        : null;

      const dueText = latestInvoice?.due_at
        ? ` Vence el ${new Date(latestInvoice.due_at).toLocaleDateString('es-CO', {
            day: 'numeric',
            month: 'short',
          })}.`
        : '.';

      const notifTitle = amountFormatted
        ? `Pago pendiente de ${amountFormatted}`
        : 'Tu plan requiere pago manual';

      const notifBody = amountFormatted
        ? `Tu período de suscripción requiere pago de ${amountFormatted}.${dueText} Paga directamente para mantener tu tienda activa.`
        : 'El medio de pago utilizado no admite renovación automática. Deberás pagar cada período manualmente.';

      // Bell + web push. notificationsService swallows internally; failures
      // here do NOT block the email enqueue.
      try {
        await this.notificationsService.createAndBroadcast(
          storeId,
          'auto_renew_disabled_no_credential',
          notifTitle,
          notifBody,
          {
            subscriptionEventId,
            invoiceId: latestInvoice?.id,
            route: '/admin/subscription/payment',
          },
        );
      } catch (e: any) {
        this.logger.warn(
          `createAndBroadcast failed for store=${storeId} event=${subscriptionEventId}: ${e?.message ?? e}`,
        );
      }

      // Email enqueue.
      try {
        await this.emailQueue.add(
          'subscription.billing.no-credential.email',
          {
            storeId,
            subscriptionEventId,
            invoiceId: latestInvoice?.id,
            amount: latestInvoice?.total ? Number(latestInvoice.total) : null,
            dueAt: latestInvoice?.due_at ? latestInvoice.due_at.toISOString() : null,
          },
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

  /**
   * Aviso del OTRO extremo del ciclo: el autopago volvió a quedar armado.
   *
   * La decisión de producto del defecto 4 exige avisar en los DOS momentos —
   * pausa y rearme — en pantalla y por correo. Avisar solo la pausa deja al
   * comerciante sin saber si su acción sirvió, y la duda lo lleva a pagar dos
   * veces o a llamar a soporte.
   *
   * Deduplicado con el MISMO mecanismo que la pausa: `billing_warning_logs`
   * (columna `type` es VARCHAR, así que el valor `auto_renew_rearmed` no necesita
   * migración) anclado al medio de pago que rearmó. Dos caminos que guardan la
   * misma tarjeta (widget + auto-registro del cobro) colapsan en un aviso.
   *
   * La campana reutiliza `notification_type_enum.subscription_reactivated` con
   * `data.kind = 'auto_renew_rearmed'`: no hay valor propio en el enum y añadirlo
   * exige migración, que aquí está prohibida. Queda reportado como gap.
   */
  @OnEvent('subscription.auto_renew.rearmed')
  async onAutoRenewRearmed(
    payload: AutoRenewRearmedEventPayload,
  ): Promise<void> {
    try {
      const rawStoreId = payload?.storeId;
      if (!Number.isInteger(rawStoreId) || (rawStoreId as number) <= 0) {
        this.logger.warn(
          'subscription.auto_renew.rearmed: invalid payload, missing storeId',
        );
        return;
      }
      const storeId = rawStoreId as number;

      const anchorId = await this.resolveRearmAnchor(storeId, payload);
      if (anchorId == null) {
        this.logger.warn(
          `subscription.auto_renew.rearmed: no anchor resolvable for store=${storeId}; skipping bell+email`,
        );
        return;
      }

      try {
        await this.prisma.billing_warning_logs.create({
          data: {
            store_id: storeId,
            type: 'auto_renew_rearmed',
            source_event_id: anchorId,
          },
        });
      } catch (e: any) {
        if (e?.code !== 'P2002') {
          throw e;
        }
        this.logger.log(
          `billing_warning_logs dedupe hit for store=${storeId} type=auto_renew_rearmed anchor=${anchorId}; skipping bell+email`,
        );
        return;
      }

      try {
        await this.notificationsService.createAndBroadcast(
          storeId,
          'subscription_reactivated',
          'Autopago reactivado',
          'Guardamos tu tarjeta y volvimos a activar la renovación automática. Te cobraremos con ella al final de cada periodo y te avisaremos antes de cada cobro.',
          {
            kind: 'auto_renew_rearmed',
            paymentMethodId: anchorId,
            route: '/admin/subscription/payment',
          },
        );
      } catch (e: any) {
        this.logger.warn(
          `createAndBroadcast failed for store=${storeId} rearm anchor=${anchorId}: ${e?.message ?? e}`,
        );
      }

      try {
        await this.emailQueue.add(
          'subscription.billing.auto-renew-rearmed.email',
          {
            storeId,
            subscriptionId: payload?.subscriptionId ?? null,
            paymentMethodId: anchorId,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 3600, count: 100 },
            removeOnFail: { age: 86400 },
          },
        );
      } catch (e: any) {
        this.logger.warn(
          `email-notifications enqueue failed for store=${storeId} rearm anchor=${anchorId}: ${e?.message ?? e}`,
        );
      }

      this.logger.log(
        `AUTO_RENEW_REARM_NOTIFIED store=${storeId} anchor=${anchorId} source=${payload?.source ?? 'unknown'}`,
      );
    } catch (err: any) {
      this.logger.error(
        `subscription.auto_renew.rearmed handler crashed: ${err?.message ?? err}`,
        err?.stack,
      );
    }
  }

  /**
   * Ancla de dedupe del rearme: el medio de pago que lo causó.
   *
   * El auto-registro del cobro no devuelve la fila creada al llamador, así que
   * cuando el evento llega sin `paymentMethodId` se resuelve el medio activo más
   * reciente de la tienda — que es exactamente el que acaba de guardarse.
   */
  private async resolveRearmAnchor(
    storeId: number,
    payload: AutoRenewRearmedEventPayload,
  ): Promise<number | null> {
    const explicit = payload?.paymentMethodId;
    if (explicit && Number.isInteger(explicit) && explicit > 0) {
      return explicit;
    }

    try {
      const latest = await this.prisma.subscription_payment_methods.findFirst({
        where: { store_id: storeId, state: 'active' },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      return latest?.id ?? null;
    } catch (e: any) {
      this.logger.warn(
        `rearm anchor lookup failed for store=${storeId}: ${e?.message ?? e}`,
      );
      return null;
    }
  }
}
