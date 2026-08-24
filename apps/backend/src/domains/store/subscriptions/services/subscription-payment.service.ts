import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  Prisma,
  subscription_invoices,
  subscription_payments,
  subscription_payment_method_state_enum,
} from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PaymentGatewayService } from '../../payments/services/payment-gateway.service';
import {
  PaymentData,
  PaymentStatus,
} from '../../payments/interfaces/payment-processor.interface';
import { WompiProcessor } from '../../payments/processors/wompi/wompi.processor';
import {
  WompiEnvironment,
  WompiTransactionData,
} from '../../payments/processors/wompi/wompi.types';
import { WompiClientFactory } from '../../payments/processors/wompi/wompi.factory';
import {
  PlatformGatewayService,
  DecryptedCreds,
} from '../../../superadmin/subscriptions/gateway/platform-gateway.service';
import { PlatformGatewayEnvironmentEnum } from '../../../superadmin/subscriptions/gateway/dto/upsert-gateway.dto';
import { SubscriptionBillingService } from './subscription-billing.service';
import { PartnerCommissionsService } from './partner-commissions.service';
import { SubscriptionStateService } from './subscription-state.service';
import { SubscriptionResolverService } from './subscription-resolver.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { isLegacyInlineTokenAllowed } from '../../payments/config/wompi-rollout.config';
import {
  MAX_CONSECUTIVE_FAILURES,
  AutoRenewPauseSource,
  RenewalEligiblePaymentMethod,
  metadataWithPausedAutoRenewIntent,
  pickRenewalEligiblePaymentMethod,
  renewalEligiblePmWhere,
  toRenewalEligiblePaymentMethod,
} from '../renewal-eligibility.contract';

const DECIMAL_ZERO = new Prisma.Decimal(0);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * S3.5 — Threshold of consecutive failed automatic charges against a saved
 * payment method before the PM is auto-invalidated (`state='invalid'`,
 * `is_default=false`) and the customer is notified to update their card.
 *
 * La constante vive en `renewal-eligibility.contract.ts` (es parte del
 * predicado). Se re-exporta aquí porque los tests y otros módulos ya la
 * importaban desde este archivo.
 */
export { MAX_CONSECUTIVE_FAILURES };

/**
 * Marker stamped on an error raised AFTER the gateway already APPROVED the
 * charge — today only "the store could not be left operational".
 *
 * It exists so `charge()` cannot mistake it for a gateway rejection. That catch
 * funnels everything into `handleChargeFailure()`, which would flip a payment
 * the customer really made to `failed` and bump the card's failure counter
 * toward dunning. The money is captured: the correct answer is to surface the
 * error, never to rewrite history as a decline.
 */
const POST_APPROVAL_FAILURE = Symbol('vendix.subscription.postApprovalFailure');

function markPostApprovalFailure<T>(err: T): T {
  if (err && typeof err === 'object') {
    (err as unknown as Record<symbol, unknown>)[POST_APPROVAL_FAILURE] = true;
  }
  return err;
}

/**
 * True when the error was raised after the gateway approved the charge.
 * Exported for the specs — the distinction is behavioural, not cosmetic.
 */
export function isPostApprovalFailure(err: unknown): boolean {
  return !!(
    err &&
    typeof err === 'object' &&
    (err as unknown as Record<symbol, unknown>)[POST_APPROVAL_FAILURE] === true
  );
}

export interface SaasWompiWidgetConfig {
  public_key: string;
  currency: string;
  amount_in_cents: number;
  reference: string;
  signature_integrity: string;
  redirect_url: string;
  customer_email: string;
}

/**
 * Por qué `status: 'pending'` no basta.
 *
 * `syncInvoiceFromGateway` devolvía `'pending'` en CUATRO situaciones que no
 * significan lo mismo, y quien lo llamaba no las podía separar:
 *
 *   - `no_reference`                  → el pago no trae `metadata.reference`:
 *                                       NO HAY con qué preguntarle a la pasarela.
 *   - `gateway_unreachable`           → se preguntó y la llamada reventó (red,
 *                                       timeout, credenciales): NO SABEMOS NADA.
 *   - `no_transaction_for_reference`  → la pasarela respondió y NO existe
 *                                       ninguna transacción con esa referencia:
 *                                       consta que no hubo cobro.
 *   - `gateway_pending`               → la pasarela respondió y la transacción
 *                                       sigue viva en PENDING: hay cobro en
 *                                       curso, todavía puede aprobar.
 *
 * La distinción no es cosmética: «no pude preguntar» y «pregunté y me dijo que
 * no» exigen decisiones OPUESTAS. Confundirlas es exactamente lo que anuló la
 * factura 17 de Multimarcas Ever (17/08/2026): el cron `reconcile-stuck-pending`
 * leyó un `'pending'` que en realidad era «Wompi no contestó», dio por hecho que
 * no había cobro, anuló una factura ya pagada y devolvió la tienda a
 * `grace_soft`. El cliente pagó $69.900 y quedó degradado.
 *
 * Regla de lectura para cualquier consumidor: sólo los `reason` que provienen de
 * una RESPUESTA de la pasarela (`no_transaction_for_reference`) autorizan a
 * tratar la factura como no cobrada. Los que provienen de la AUSENCIA de
 * respuesta (`gateway_unreachable`, `no_reference`) obligan a diferir, y
 * `gateway_pending` obliga a esperar.
 *
 * El campo es ADITIVO y opcional: los llamadores que sólo miran `status` siguen
 * comportándose igual.
 */
export type SyncInvoiceFromGatewayReason =
  | 'no_reference'
  | 'gateway_unreachable'
  | 'no_transaction_for_reference'
  | 'gateway_pending';

export interface SyncInvoiceFromGatewayResult {
  status: 'paid' | 'failed' | 'pending' | 'no_transaction';
  already_paid?: boolean;
  transaction_id?: string;
  payment_status?: string;
  /** Sólo se puebla cuando `status === 'pending'`. Ver el bloque de arriba. */
  reason?: SyncInvoiceFromGatewayReason;
}

@Injectable()
export class SubscriptionPaymentService {
  private readonly logger = new Logger(SubscriptionPaymentService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly gateway: PaymentGatewayService,
    private readonly billing: SubscriptionBillingService,
    private readonly commissionsService: PartnerCommissionsService,
    private readonly stateService: SubscriptionStateService,
    private readonly resolver: SubscriptionResolverService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly platformGw: PlatformGatewayService,
    private readonly wompiProcessor: WompiProcessor,
    private readonly wompiClientFactory: WompiClientFactory,
    @InjectQueue('commission-accrual')
    private readonly commissionQueue: Queue,
    @InjectQueue('email-notifications')
    private readonly emailQueue: Queue,
  ) {}

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Charge an invoice via the payment gateway.
   * On success: updates invoice state, creates payment record, and accrues
   * partner commission if applicable.
   */
  async chargeInvoice(invoiceId: number): Promise<subscription_payments> {
    return this.charge(invoiceId);
  }

  /**
   * Enqueue the commission-accrual BullMQ job for a given invoice after a
   * webhook-driven payment success.  Must be called AFTER the atomic
   * dedup+payment transaction commits — never inside the transaction body.
   *
   * This is the post-commit counterpart to the in-tx outbox row inserted by
   * handleChargeSuccess when called with an externalTx.  If the enqueue
   * fails the outbox row stays pending and will be picked up by
   * reconciliation or manual retry.
   */
  async enqueueCommissionAccrualPostCommit(invoiceId: number): Promise<void> {
    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice?.partner_organization_id) {
      return;
    }
    const splitBreakdown = invoice.split_breakdown as Record<
      string,
      unknown
    > | null;
    const partnerShare = splitBreakdown?.partner_share
      ? new Prisma.Decimal(splitBreakdown.partner_share as string)
      : DECIMAL_ZERO;
    if (!partnerShare.greaterThan(DECIMAL_ZERO)) {
      return;
    }
    try {
      await this.commissionQueue.add(
        'accrual',
        { invoiceId },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 3600, count: 100 },
          removeOnFail: { age: 86400 },
        },
      );
    } catch (e: any) {
      this.logger.warn(
        `Failed to enqueue commission accrual job (webhook path) for invoice ${invoiceId}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Prepare a Wompi WidgetCheckout payload for an invoice. Returns the config
   * the frontend feeds into `new WidgetCheckout({...}).open(cb)` — same flow
   * the eCommerce checkout uses, so users stay inside Vendix instead of
   * being redirected to the hosted page.
   *
   * The payment row is created in `pending`. The actual "succeeded" / "failed"
   * transition is driven by the platform Wompi webhook
   * (POST /platform/webhooks/wompi).
   */
  async prepareWidgetCharge(
    invoiceId: number,
    opts: { customerEmail?: string; redirectUrl?: string },
  ): Promise<{
    payment: subscription_payments;
    widget: SaasWompiWidgetConfig | null;
  }> {
    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }
    if (invoice.state === 'paid' || invoice.state === 'void') {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'Invoice already resolved',
      );
    }

    const total = new Prisma.Decimal(invoice.total);
    if (total.lessThanOrEqualTo(DECIMAL_ZERO)) {
      const payment = await this.handleZeroInvoice(invoiceId, invoice);
      return { payment, widget: null };
    }

    const wompiConfig = await this.platformGw.getActiveCredentials('wompi');
    if (!wompiConfig) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_003,
        'Credenciales de pasarela de plataforma no configuradas',
      );
    }

    const amountInCents = Math.round(total.toNumber() * 100);
    const currency = invoice.currency || 'COP';

    // Guard against orphan pending buildup: if there is an existing pending
    // payment created within the last 30 minutes with a valid reference, reuse it.
    const recentPending = await this.prisma.subscription_payments.findFirst({
      where: {
        invoice_id: invoiceId,
        state: 'pending',
        created_at: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      },
      orderBy: { id: 'desc' },
    });

    if (
      recentPending &&
      recentPending.metadata &&
      typeof (recentPending.metadata as any).reference === 'string'
    ) {
      const reference = (recentPending.metadata as any).reference;
      const signatureIntegrity = this.computeIntegritySignature(
        reference,
        amountInCents,
        currency,
        wompiConfig.integrity_secret,
      );

      this.logger.log(
        `prepareWidgetCharge: reusing recent pending payment ${recentPending.id} for invoice ${invoiceId} (ref=${reference})`,
      );

      return {
        payment: recentPending,
        widget: {
          public_key: wompiConfig.public_key,
          currency,
          amount_in_cents: amountInCents,
          reference,
          signature_integrity: signatureIntegrity,
          redirect_url: opts.redirectUrl ?? '',
          customer_email:
            opts.customerEmail ?? `saas-${invoice.store_id}@vendix.app`,
        },
      };
    }

    const attemptCounter =
      (await this.prisma.subscription_payments.count({
        where: { invoice_id: invoiceId },
      })) + 1;
    const idempotencyKey = `sub_inv_${invoiceId}_att_${attemptCounter}`;
    const reference = `vendix_saas_${invoice.store_subscription_id}_${invoiceId}_${Date.now()}`;

    const signatureIntegrity = this.computeIntegritySignature(
      reference,
      amountInCents,
      currency,
      wompiConfig.integrity_secret,
    );

    const payment = await this.prisma.subscription_payments.create({
      data: {
        invoice_id: invoiceId,
        state: 'pending',
        amount: total,
        currency,
        payment_method: 'wompi',
        metadata: {
          idempotency_key: idempotencyKey,
          reference,
          attempt: attemptCounter,
          widget_flow: true,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `prepareWidgetCharge: invoice ${invoiceId} → Wompi widget config (env=${wompiConfig.environment}, ref=${reference})`,
    );

    return {
      payment,
      widget: {
        public_key: wompiConfig.public_key,
        currency,
        amount_in_cents: amountInCents,
        reference,
        signature_integrity: signatureIntegrity,
        redirect_url: opts.redirectUrl ?? '',
        customer_email:
          opts.customerEmail ?? `saas-${invoice.store_id}@vendix.app`,
      },
    };
  }

  private computeIntegritySignature(
    reference: string,
    amountInCents: number,
    currency: string,
    integritySecret: string,
  ): string {
    const concatenated = `${reference}${amountInCents}${currency}${integritySecret}`;
    return require('crypto')
      .createHash('sha256')
      .update(concatenated)
      .digest('hex');
  }

  /**
   * Pull-fallback sync — Webhook safety net for environments where the
   * Wompi webhook cannot reach the backend (localhost, NAT, transient
   * outbound failures, prod misconfig). The frontend polling layer calls
   * this on every cycle while the subscription remains in `pending_payment`.
   *
   * Flow:
   *   1. Load invoice + payments. If invoice already paid → return.
   *   2. Pick the most recent pending payment row's `metadata.reference`
   *      (the one we generated when calling prepareWidgetCharge / charge).
   *   3. Query Wompi `GET /v1/transactions?reference=...` using PLATFORM
   *      credentials (same source the widget was issued with).
   *   4. If APPROVED → reuse webhook handler `markPaymentSucceededFromWebhook`
   *      so all atomic invariants (invoice paid, subscription promoted,
   *      auto-PM, partner commission outbox, listener emit) run identically.
   *      Idempotency via `webhook_event_dedup` keyed on the Wompi event id
   *      with processor='wompi_sync'.
   *   5. If DECLINED/ERROR → mark payment failed (same handler).
   *   6. If PENDING/empty → return pending status; caller keeps polling.
   *
   * Reusing the webhook handlers (instead of duplicating success logic)
   * guarantees parity: a charge confirmed via this path is indistinguishable
   * from one confirmed via the actual Wompi webhook.
   *
   * El `reason` del resultado discrimina los cuatro `pending` que antes eran
   * indistinguibles — ver `SyncInvoiceFromGatewayReason`.
   */
  async syncInvoiceFromGateway(
    invoiceId: number,
  ): Promise<SyncInvoiceFromGatewayResult> {
    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    if (invoice.state === 'paid') {
      return { status: 'paid', already_paid: true };
    }
    // `refunded` corta en seco: ahí SÍ hubo devolución real de dinero, así que
    // la pasarela puede decir APPROVED de la transacción original y aun así la
    // factura no debe revivir.
    if (invoice.state === 'refunded') {
      return { status: 'failed', already_paid: false };
    }

    // `void` YA NO corta. Una factura anulada por el cron de reconciliación es
    // precisamente el caso donde hay que preguntarle a la pasarela: si Wompi
    // dice APPROVED, el dinero entró y la anulación fue un error nuestro que hay
    // que deshacer. Antes este `return` temprano hacía la anulación
    // irreversible: la factura pagada quedaba `void` para siempre y sólo se
    // arreglaba a mano en base de datos.
    const reopeningVoidedInvoice = invoice.state === 'void';

    // Locate the most recent pending payment for this invoice. The
    // `metadata.reference` is the one passed to the Wompi widget — that is
    // the only stable join key against `GET /transactions?reference=`.
    const payment = await this.prisma.subscription_payments.findFirst({
      where: { invoice_id: invoiceId },
      orderBy: { id: 'desc' },
    });

    if (!payment) {
      return { status: 'no_transaction' };
    }

    if (this.isTerminalState(payment.state)) {
      // Payment row already terminal — invoice should reflect it.
      return {
        status: payment.state === 'succeeded' ? 'paid' : 'failed',
        payment_status: payment.state,
      };
    }

    const meta =
      payment.metadata && typeof payment.metadata === 'object'
        ? (payment.metadata as Record<string, unknown>)
        : {};
    // `metadata.reference` primero porque es la clave que se le pasó al widget
    // y la que este camino lleva usando desde siempre. `gateway_reference` es
    // RESPALDO, no preferencia: hay caminos que le escriben el id de la
    // transacción en vez de la referencia (ver el `gateway_reference:
    // transactionId` de `recordWidgetTransaction`), así que anteponerlo
    // cambiaría consultas que hoy funcionan.
    //
    // El respaldo existe porque `SubscriptionWebhookReconcilerJob` sí lo lee
    // (`gateway_reference ?? metadata.reference`): sin él, un pago cuya
    // referencia vive SOLO en la columna era encontrado por el reconciliador y
    // no por este seam, y la factura se quedaba anulada para siempre — el
    // desenlace exacto que este bloque de cambios existe para impedir.
    const reference =
      typeof meta.reference === 'string' && meta.reference.length > 0
        ? meta.reference
        : payment.gateway_reference || null;

    if (!reference) {
      this.logger.warn(
        `syncInvoiceFromGateway: payment ${payment.id} has no metadata.reference`,
      );
      // No hay clave de join contra `GET /transactions?reference=`: NO se
      // preguntó. Silencio nuestro, no de la pasarela.
      return {
        status: 'pending',
        payment_status: payment.state,
        reason: 'no_reference',
      };
    }

    const wompiCreds = await this.platformGw.getActiveCredentials('wompi');
    if (!wompiCreds) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_003,
        'Credenciales de pasarela de plataforma no configuradas',
      );
    }

    let txns: WompiTransactionData[] = [];
    try {
      const client = this.wompiClientFactory.getClient(
        'platform-sync',
        this.toProcessorWompiConfig(wompiCreds),
      );
      const result = await client.getTransactionsByReference(reference);
      txns = Array.isArray(result?.data) ? result.data : [];
    } catch (err: any) {
      this.logger.warn(
        `syncInvoiceFromGateway: Wompi lookup failed for invoice ${invoiceId} ref=${reference}: ${err?.message ?? err}`,
      );
      // Se preguntó y la llamada reventó (red, timeout, credenciales). No
      // sabemos NADA del cobro; el llamador no puede concluir que no existe.
      return {
        status: 'pending',
        payment_status: payment.state,
        reason: 'gateway_unreachable',
      };
    }

    if (txns.length === 0) {
      // La pasarela SÍ respondió y no conoce ninguna transacción con esa
      // referencia. Éste es el único `pending` que autoriza a tratar la factura
      // como no cobrada.
      return {
        status: 'pending',
        payment_status: payment.state,
        reason: 'no_transaction_for_reference',
      };
    }

    // Prefer an APPROVED txn if any; otherwise fall back to the most
    // recent terminal one (DECLINED/ERROR/VOIDED). PENDING ones leave
    // the caller polling.
    const approved = txns.find(
      (t) => String(t.status).toUpperCase() === 'APPROVED',
    );
    const terminalFailed = txns.find((t) => {
      const s = String(t.status).toUpperCase();
      return s === 'DECLINED' || s === 'ERROR' || s === 'VOIDED';
    });
    const txn = approved ?? terminalFailed ?? txns[0];
    const status = String(txn.status).toUpperCase();

    if (status === 'APPROVED') {
      // Se pone en true dentro de la transacción, sólo cuando la factura venía
      // `void` y el dedup no cortó: es decir, cuando esta corrida REABRIÓ de
      // verdad una factura que el cron había anulado. Si la transacción hace
      // rollback nunca llegamos al log de abajo, así que el flag no puede
      // mentir.
      let reopenApplied = false;

      // Idempotent dedup INSERT inside an atomic tx + reuse the webhook
      // success path so subscription promotion + auto-PM + outbox all run
      // identically to a real webhook. processor='wompi_sync' so a
      // subsequent real webhook (processor='wompi_platform') is NOT blocked
      // by this dedup row.
      await this.prisma.withoutScope().$transaction(
        async (tx) => {
          const dedupKey = String(txn.id);
          const inserted = await tx.$executeRaw<number>(
            Prisma.sql`
              INSERT INTO webhook_event_dedup (processor, event_id, event_type, received_at)
              VALUES ('wompi_sync', ${dedupKey}, 'pull_sync', NOW())
              ON CONFLICT (processor, event_id) DO NOTHING
            `,
          );
          if (inserted === 0) {
            this.logger.log(
              `syncInvoiceFromGateway: dedup hit for txn ${dedupKey}, invoice ${invoiceId}; skipping`,
            );
            return;
          }

          if (reopeningVoidedInvoice) {
            reopenApplied = true;
            await this.restorePendingChangeForReopenedInvoice(tx, invoice);
          }

          await this.markPaymentSucceededFromWebhook(
            {
              paymentId: payment.id,
              invoiceId,
              transactionId: txn.id,
              gatewayResponse: txn,
            },
            tx,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );

      if (reopenApplied) {
        // WARN a propósito: reabrir una factura anulada significa que algo
        // aguas arriba (el cron, un operador) la dio por muerta estando
        // cobrada. Es un evento que alguien debe mirar, no ruido.
        this.logger.warn(
          JSON.stringify({
            event: 'INVOICE_REOPENED_FROM_GATEWAY',
            invoice_id: invoiceId,
            transaction_id: txn.id,
            previous_state: 'void',
          }),
        );
      }

      // Post-commit side effects — mirror SubscriptionWebhookService.
      try {
        await this.enqueueCommissionAccrualPostCommit(invoiceId);
      } catch (e: any) {
        this.logger.warn(
          `syncInvoiceFromGateway: enqueueCommissionAccrual failed invoice=${invoiceId}: ${e?.message ?? e}`,
        );
      }

      try {
        this.eventEmitter.emit('subscription.payment.succeeded', {
          invoiceId,
          paymentId: payment.id,
          subscriptionId: invoice.store_subscription_id,
          storeId: invoice.store_id,
          source: 'pull_sync',
        });
      } catch (e: any) {
        this.logger.warn(
          `syncInvoiceFromGateway: emit failed invoice=${invoiceId}: ${e?.message ?? e}`,
        );
      }

      this.logger.log(
        `syncInvoiceFromGateway: APPROVED applied for invoice ${invoiceId} via pull (txn=${txn.id})`,
      );
      return {
        status: 'paid',
        transaction_id: txn.id,
        payment_status: 'succeeded',
      };
    }

    if (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED') {
      await this.markPaymentFailedFromWebhook({
        paymentId: payment.id,
        invoiceId,
        reason: txn.status_message ?? status,
      });
      return {
        status: 'failed',
        transaction_id: txn.id,
        payment_status: 'failed',
      };
    }

    // PENDING / unknown — caller continues polling. La transacción sigue VIVA
    // en la pasarela: todavía puede aprobar, así que nadie debe darla por
    // muerta ni anular la factura contra ella.
    return {
      status: 'pending',
      payment_status: payment.state,
      reason: 'gateway_pending',
    };
  }

  /**
   * Reconstruye los campos `pending_*` de la suscripción a partir de la propia
   * factura, justo antes de reabrirla.
   *
   * POR QUÉ existe. Cuando `reconcile-stuck-pending` anula una factura
   * (Escenario A) BORRA `pending_plan_id`, `pending_change_invoice_id`,
   * `pending_change_kind`, `pending_change_started_at` y `pending_revert_state`.
   * Si después resulta que la pasarela sí cobró y reabrimos la factura, el
   * camino de éxito llega a `confirmPendingChange`, cuya guarda del paso 2 exige
   * `sub.pending_plan_id === invoice.to_plan_id`. Con los campos en null esa
   * guarda cae en `CONFIRM_PENDING_MISMATCH` y hace NO-OP: el pago queda
   * `succeeded`, la factura `paid`… y la tienda sigue en `grace_soft` con el
   * plan viejo. Cobrado y degradado — el peor desenlace posible, y exactamente
   * lo que hubo que reparar a mano en producción.
   *
   * Restaurarlos DENTRO de la misma transacción y ANTES de
   * `markPaymentSucceededFromWebhook` es lo que hace que la reapertura sea
   * atómica: o promueve el plan o no cobra.
   *
   * `pending_revert_state` se rearma con el estado ACTUAL de la suscripción (no
   * con el que tenía antes de la anulación, que ya no existe en ninguna parte)
   * para que, si algo vuelve a fallar, el revertido siga siendo un salto legal
   * de la máquina de estados.
   *
   * Sólo se invoca en el camino de reapertura. En el camino normal los
   * `pending_*` ya están puestos por el checkout y reescribirlos sería pisar
   * estado vivo.
   */
  private async restorePendingChangeForReopenedInvoice(
    tx: Prisma.TransactionClient,
    invoice: Pick<
      subscription_invoices,
      | 'id'
      | 'store_subscription_id'
      | 'to_plan_id'
      | 'change_kind'
      | 'issued_at'
      | 'created_at'
    >,
  ): Promise<void> {
    // Sin `to_plan_id` no hay cambio de plan que confirmar: la factura es una
    // renovación/reactivación y `handleChargeSuccess` va por
    // `ensureOperationalInTx`, que no lee los `pending_*`. Nada que restaurar.
    if (invoice.to_plan_id == null) {
      return;
    }

    const sub = await tx.store_subscriptions.findUnique({
      where: { id: invoice.store_subscription_id },
      select: { id: true, state: true },
    });
    if (!sub) {
      return;
    }

    const data: Prisma.store_subscriptionsUncheckedUpdateInput = {
      pending_plan_id: invoice.to_plan_id,
      pending_change_invoice_id: invoice.id,
      pending_change_kind: invoice.change_kind,
      // `issued_at` es nullable; `created_at` sólo cubre el hueco para que la
      // columna no quede nula. No se usa para decidir nada, únicamente para que
      // el propio cron pueda volver a leer la fila si la confirmación fallara.
      pending_change_started_at: invoice.issued_at ?? invoice.created_at,
      pending_revert_state: sub.state,
      updated_at: new Date(),
    };

    await tx.store_subscriptions.update({ where: { id: sub.id }, data });
  }

  /**
   * Refund a payment for an invoice, optionally partially.
   * Calls the gateway refund and updates payment/invoice states.
   */
  async refundPayment(
    invoiceId: number,
    amount?: number,
  ): Promise<subscription_payments> {
    return this.refund(invoiceId, amount);
  }

  async getPaymentStatus(paymentId: number): Promise<PaymentStatus> {
    const payment = await this.prisma.subscription_payments.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Payment not found',
      );
    }

    if (!payment.gateway_reference) {
      return {
        status: payment.state as any,
        transactionId: payment.gateway_reference ?? undefined,
        amount: payment.amount.toNumber(),
        paidAt: payment.paid_at ?? undefined,
      };
    }

    return this.gateway.getPaymentStatus(payment.gateway_reference);
  }

  // ------------------------------------------------------------------
  // Public webhook entry-points
  //
  // These wrappers let SubscriptionWebhookService transition payment +
  // invoice state when an async Wompi callback arrives, without
  // duplicating the inline charge logic in handleChargeSuccess /
  // handleChargeFailure (which were private and reused across both
  // sync charge() and webhook). The wrapper resolves the invoice for the
  // webhook flow (the cron path already has it loaded) and short-circuits
  // when the payment is already in a terminal state — idempotent retries.
  // ------------------------------------------------------------------

  async markPaymentSucceededFromWebhook(
    input: {
      paymentId: number;
      invoiceId: number;
      transactionId?: string;
      gatewayResponse?: any;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<subscription_payments | null> {
    const { paymentId, invoiceId, transactionId, gatewayResponse } = input;

    const client = tx ?? this.prisma;

    const payment = await client.subscription_payments.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      this.logger.warn(
        `markPaymentSucceededFromWebhook: payment ${paymentId} not found`,
      );
      return null;
    }

    // Idempotency guard — terminal states never transition again from a
    // webhook. Webhooks can fire multiple times; the gateway retries on
    // non-2xx, and Wompi sometimes redelivers on its own.
    if (this.isTerminalState(payment.state)) {
      this.logger.log(
        `markPaymentSucceededFromWebhook: payment ${paymentId} already in ${payment.state}, skipping`,
      );
      return payment;
    }

    const invoice = await client.subscription_invoices.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      this.logger.warn(
        `markPaymentSucceededFromWebhook: invoice ${invoiceId} not found`,
      );
      return null;
    }

    const result = await this.handleChargeSuccess(
      paymentId,
      invoiceId,
      invoice,
      transactionId,
      gatewayResponse,
      tx,
    );

    // S3.5 — Reset consecutive_failures on the saved PM that authored this
    // charge. Run AFTER the success transaction so a rollback does not leave
    // the counter cleared for an un-paid invoice. When inside an external
    // transaction the caller (SubscriptionWebhookService) is responsible for
    // calling this post-commit; we still attempt it here best-effort because
    // the only side effect is an idempotent counter reset.
    const pmId = this.extractSavedPaymentMethodId(payment.metadata);
    if (pmId && !tx) {
      await this.resetPaymentMethodFailures(pmId);
    }

    return result;
  }

  async markPaymentFailedFromWebhook(
    input: {
      paymentId: number;
      invoiceId: number;
      reason: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<subscription_payments | null> {
    const { paymentId, invoiceId, reason } = input;

    const client = tx ?? this.prisma;

    const payment = await client.subscription_payments.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      this.logger.warn(
        `markPaymentFailedFromWebhook: payment ${paymentId} not found`,
      );
      return null;
    }

    if (this.isTerminalState(payment.state)) {
      this.logger.log(
        `markPaymentFailedFromWebhook: payment ${paymentId} already in ${payment.state}, skipping`,
      );
      return payment;
    }

    const result = await this.handleChargeFailure(
      paymentId,
      invoiceId,
      reason,
      tx,
    );

    // S3.5 — Bump consecutive_failures on the saved PM that authored this
    // charge. Like the success path, when inside an external tx the caller
    // owns the boundary and the bump is best-effort — the counter is
    // monotonic and idempotent enough to stomach a redelivery.
    const pmId = this.extractSavedPaymentMethodId(payment.metadata);
    if (pmId && !tx) {
      const inv = await this.prisma.subscription_invoices.findUnique({
        where: { id: invoiceId },
        select: { store_subscription_id: true },
      });
      if (inv) {
        await this.bumpPaymentMethodFailure(pmId, inv.store_subscription_id);
      }
    }

    return result;
  }

  private isTerminalState(state: subscription_payments['state']): boolean {
    return (
      state === 'succeeded' ||
      state === 'failed' ||
      state === 'refunded' ||
      state === 'partial_refund'
    );
  }

  // ------------------------------------------------------------------
  // ADR-2: Single confirmation point for pending plan changes
  // ------------------------------------------------------------------

  /**
   * ADR-2: Single confirmation point for all pending plan changes.
   * Called from: webhook APPROVED, free-plan synchronous path, Wompi polling.
   *
   * Invariant: after this method returns, state=active, plan_id=paid_plan_id,
   * all pending_* fields are null. The state half of that invariant is
   * ENFORCED, not assumed: `ensureOperationalInTx` re-reads the row and throws
   * (aborting this transaction) rather than let a confirmed collection commit
   * against a store that is still degraded.
   *
   * Note the returned row is the snapshot taken before the state promotion, so
   * its `state` / `current_period_*` are stale by design; callers use this for
   * the plan/pricing fields only.
   */
  async confirmPendingChange(
    invoice: {
      id: number;
      store_subscription_id: number;
      to_plan_id: number | null;
      from_plan_id: number | null;
      change_kind: string | null;
    },
    tx: Prisma.TransactionClient,
  ): Promise<any> {
    // 1. Read the sub with plan and partner_override included
    const sub = await tx.store_subscriptions.findUniqueOrThrow({
      where: { id: invoice.store_subscription_id },
      include: {
        plan: true,
        partner_override: { include: { base_plan: true } },
      },
    });

    // 2. Guard: stale webhook or mismatch
    if (
      sub.pending_plan_id == null ||
      invoice.to_plan_id == null ||
      sub.pending_plan_id !== invoice.to_plan_id
    ) {
      this.logger.warn(
        JSON.stringify({
          event: 'CONFIRM_PENDING_MISMATCH',
          sub_pending: sub.pending_plan_id,
          invoice_to: invoice.to_plan_id,
          invoice_id: invoice.id,
        }),
      );
      return sub;
    }

    // 3. Fetch target plan
    const targetPlan = await tx.subscription_plans.findUniqueOrThrow({
      where: { id: sub.pending_plan_id },
      include: { partner_overrides: false },
    });

    // 4. Compute new pricing using the target plan shape
    const pricingInput = {
      plan: {
        id: targetPlan.id,
        base_price: targetPlan.base_price,
        max_partner_margin_pct: targetPlan.max_partner_margin_pct,
      },
      partner_override: sub.partner_override as any,
    };
    const newPricing = this.billing.computePricing(pricingInput);

    // 5. Determine if period should reset.
    // Plan-change policy: every upgrade/downgrade also restarts the cycle so
    // the new plan starts with a fresh full window (matches the full-price
    // charge applied server-side by SubscriptionProrationService — no credit,
    // no carry-over of consumed days).
    const changeKind = String(
      invoice.change_kind ?? sub.pending_change_kind ?? '',
    );
    const shouldResetPeriod = [
      'initial',
      'resubscribe',
      'trial_conversion',
      'renewal',
      'upgrade',
      'downgrade',
    ].includes(changeKind);

    // 6. Calculate the period the caller WANTS, if the change kind resets it.
    // This is only the BASE handed to `ensureOperationalInTx` below — the seam
    // is the single writer of `current_period_*` / `next_billing_at` and
    // applies the consumed-grace discount on top of this value.
    const now = new Date();
    let newPeriodEnd: Date | undefined;
    if (shouldResetPeriod) {
      const cycleDays = this.billingCycleDays(targetPlan.billing_cycle);
      newPeriodEnd = new Date(now.getTime() + cycleDays * DAY_MS);
    }

    // 7. Update the subscription (use UncheckedUpdateInput for scalar FK fields)
    const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, 6);
    const resolvedFeaturesSnapshot =
      (targetPlan.ai_feature_flags ?? {}) as Prisma.InputJsonValue;
    const updateData: Prisma.store_subscriptionsUncheckedUpdateInput = {
      plan_id: sub.pending_plan_id,
      paid_plan_id: sub.pending_plan_id,
      effective_price: round2(newPricing.effective_price),
      vendix_base_price: round2(newPricing.base_price),
      partner_margin_amount: round2(newPricing.margin_amount),
      resolved_features: resolvedFeaturesSnapshot,
      resolved_at: now,
      // Clear pending fields
      pending_plan_id: null,
      pending_change_invoice_id: null,
      pending_change_kind: null,
      pending_change_started_at: null,
      pending_revert_state: null,
      // Clear scheduled downgrade (upgrade cancels deferred downgrade)
      scheduled_plan_id: null,
      scheduled_plan_change_at: null,
      updated_at: now,
      // NOTE: `scheduled_cancel_at`, `auto_renew`, `suspend_at`, `cancel_at`,
      // `grace_soft_until`, `grace_hard_until`, `lock_reason` and the
      // `current_period_*` / `next_billing_at` window are deliberately ABSENT
      // here. `ensureOperationalInTx` (step 8) owns all of them. They used to
      // be hand-written in this block AND recomputed inside the state service,
      // which is precisely how the two sites drifted into disagreeing about
      // when a store is really operational.
    };

    // `trial_ends_at` is the one field of the old hand-rolled cleanup the seam
    // does NOT cover: it is a plan-change concern (a trial converting to a paid
    // plan), not a reactivation concern, so it stays here.
    if (
      shouldResetPeriod &&
      sub.state === 'pending_payment' &&
      sub.pending_revert_state === 'trial'
    ) {
      updateData.trial_ends_at = null;
    }

    const updated = await tx.store_subscriptions.update({
      where: { id: sub.id },
      data: updateData,
    });

    // 8. Bring the store back to an operational state through the single
    // reactivation seam.
    //
    // This is the call-site that CONFIRMS THE COLLECTION, so it is the one that
    // must never report success on a store that stays degraded. The previous
    // `transitionInTx(tx, storeId, 'active', …)` asked for a single hop, which
    // is illegal from `cancelled` / `expired`: a store that had been cancelled
    // and then bought a plan got `SUBSCRIPTION_010` swallowed by the caller's
    // catch (see handleChargeSuccess), the charge went through, the response was
    // HTTP 200 — and the store stayed blocked.
    //
    // `ensureOperationalInTx` resolves the legal route instead of assuming one
    // (two hops via `pending_payment` for the terminal states), is a no-op when
    // the subscription is already operational, and re-reads the row before
    // returning: if the store is not `active`/`trial` it throws, which aborts
    // THIS transaction — a payment confirmation that cannot leave the store
    // operational must not commit.
    //
    // `tx` is the caller's transaction, not a new one: the state promotion has
    // to be atomic with the payment/invoice rows, and `ensureOperational`
    // (non-InTx) would open a second transaction that would deadlock against
    // the `FOR UPDATE` lock this one already holds on the subscription row.
    //
    // `periodEnd`/`planId` are passed when the change kind resets the cycle;
    // the seam takes them as the base window and discounts the grace days the
    // store already consumed.
    await this.stateService.ensureOperationalInTx(tx, sub.store_id, {
      reason: `plan_confirmed_invoice_${invoice.id}`,
      periodEnd: newPeriodEnd,
      planId: sub.pending_plan_id ?? undefined,
      payload: {
        from_plan_id: invoice.from_plan_id,
        to_plan_id: invoice.to_plan_id,
        change_kind: changeKind,
        invoice_id: invoice.id,
        ...(sub.scheduled_cancel_at
          ? {
              voided_scheduled_cancel_at:
                sub.scheduled_cancel_at.toISOString(),
              voided_scheduled_cancel_via: 'payment_confirmed',
            }
          : {}),
      },
    });

    // 9. Emit event
    try {
      this.eventEmitter.emit('subscription.plan.changed', {
        storeId: sub.store_id,
        subscriptionId: sub.id,
        fromPlanId: invoice.from_plan_id,
        toPlanId: invoice.to_plan_id,
        kind: changeKind,
        mode: 'committed',
        invoiceId: invoice.id,
      });
    } catch (e: any) {
      this.logger.warn(
        `subscription.plan.changed emit failed for invoice ${invoice.id}: ${e?.message ?? e}`,
      );
    }

    // 10. Invalidate Redis cache
    try {
      await this.resolver.invalidate(sub.store_id);
    } catch (e: any) {
      this.logger.warn(
        `resolver.invalidate failed for store ${sub.store_id}: ${e?.message ?? e}`,
      );
    }

    return updated;
  }

  // ------------------------------------------------------------------
  // Core charge / refund
  // ------------------------------------------------------------------

  async charge(invoiceId: number): Promise<subscription_payments> {
    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    if (invoice.state === 'paid' || invoice.state === 'void') {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'Invoice already resolved',
      );
    }

    const total = new Prisma.Decimal(invoice.total);

    if (total.lessThanOrEqualTo(DECIMAL_ZERO)) {
      return this.handleZeroInvoice(invoiceId, invoice);
    }

    // ── SaaS path: use platform-level Wompi credentials, NOT per-store
    // gateway registry. The store does not own the gateway used to charge
    // its own SaaS invoice — Vendix does.
    const wompiConfig = await this.platformGw.getActiveCredentials('wompi');
    if (!wompiConfig) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_003,
        'Credenciales de pasarela de plataforma no configuradas',
      );
    }

    // G11 — Resolve a usable stored payment method for this subscription.
    // Default tokenized card on the subscription is reused across renewals
    // when state='active' AND it has not expired AND it is not invalidated
    // by consecutive failures. If none exists or it is unusable, charge()
    // falls back to the legacy direct-call path (which will fail because
    // metadata.paymentMethod is required by WompiProcessor) and the caller
    // is expected to use prepareWidgetCharge() instead.
    const reusablePm = await this.resolveReusablePaymentMethod(
      invoice.store_subscription_id,
    );

    // Stable per-attempt idempotency key. Previous attempts for this
    // invoice are counted (any state) so retries always advance the counter,
    // making the key uniquely identify each logical attempt.
    const attemptCounter =
      (await this.prisma.subscription_payments.count({
        where: { invoice_id: invoiceId },
      })) + 1;
    const idempotencyKey = `sub_inv_${invoiceId}_att_${attemptCounter}`;

    // SaaS reference format — distinguishes SaaS billing transactions
    // from store/POS/eCommerce in Wompi reports and webhooks.
    const reference = `vendix_saas_${invoice.store_subscription_id}_${invoiceId}_${Date.now()}`;

    // Wompi Phase 6 — Build the per-attempt payment payload. Branching:
    //   • PM has provider_payment_source_id → COF / MIT (`payment_source_id`
    //     + `recurrent: true` inside WompiProcessor.processPayment). This is
    //     the production-grade flow: PCI-DSS compliant, MIT-flagged, eligible
    //     for Visa Account Updater.
    //   • Legacy PM (only `provider_token`, no `payment_source_id`) → inline
    //     `payment_method.token` flow. Preserved behind `legacyInlineTokenAllowed()`
    //     until Fase 7 wires the env-flag rampa. When the flag goes false,
    //     unmigrated PMs throw PAYMENT_METHOD_NOT_MIGRATED so the customer
    //     re-enters card data and gets re-tokenized via /payment_sources.
    //   • No reusable PM → standard SaaS flow (no PM metadata, falls through
    //     to processor's legacy branch which will fail without `paymentMethod`
    //     — caller is expected to use prepareWidgetCharge() instead).
    const baseMetadata: Record<string, unknown> = {
      subscription_payment: true,
      subscriptionId: invoice.store_subscription_id,
      invoiceId,
      invoice_number: invoice.invoice_number,
      reference,
      // Tells WompiProcessor to use these creds INSTEAD of looking up
      // store_payment_methods.custom_config (which doesn't apply for SaaS).
      wompiConfig: this.toProcessorWompiConfig(wompiConfig),
    };

    let chargeMetadata: Record<string, unknown>;
    if (reusablePm && reusablePm.provider_payment_source_id) {
      // ── Recurrent (COF/MIT) path — Wompi Phase 6 ──────────────────────
      chargeMetadata = {
        ...baseMetadata,
        payment_source_id: reusablePm.provider_payment_source_id,
        // SaaS internal contact mirrors what was registered with the COF.
        // Wompi requires `customer_email` on /transactions; processor falls
        // back to `cof-{storeId}@vendix.app` when absent.
        customerEmail: `saas-${invoice.store_id}@vendix.app`,
        saved_payment_method_id: reusablePm.id,
      };
    } else if (reusablePm) {
      if (!this.legacyInlineTokenAllowed()) {
        // Fase 7 enforce gate — unmigrated PMs are blocked. Customer must
        // re-tokenize via the widget so the next charge has a payment_source_id.
        throw new VendixHttpException(
          ErrorCodes.PAYMENT_METHOD_NOT_MIGRATED,
          'Payment method requires re-tokenization to Wompi payment_source',
          { paymentMethodId: reusablePm.id },
        );
      }
      // ── Legacy inline-token path (pre-Fase 6 PMs) ──────────────────────
      chargeMetadata = {
        ...baseMetadata,
        paymentMethod: {
          type: 'CARD',
          token: reusablePm.provider_token,
          installments: 1,
        },
        saved_payment_method_id: reusablePm.id,
        use_legacy_inline_token: true,
      };
    } else {
      // No reusable PM at all — pass-through. Processor will fail without
      // a paymentMethod, caller should have used prepareWidgetCharge().
      chargeMetadata = { ...baseMetadata };
    }

    // Telemetry — comparable approval-rate signal across the rollout (Fase 7
    // rampa). Logged on every attempt so ops can graph
    // success/failure-by-path without parsing structured payment metadata.
    this.logger.log(
      `WOMPI_CHARGE_PATH path=${
        reusablePm?.provider_payment_source_id
          ? 'recurrent'
          : reusablePm
            ? 'legacy'
            : 'no_pm'
      } subscriptionId=${invoice.store_subscription_id} invoiceId=${invoiceId} pmId=${reusablePm?.id ?? 'none'}`,
    );

    // Fase 7 — Structured warning to track legacy PMs still in use during
    // the rollout. Easy to grep / aggregate from logs while
    // `WOMPI_RECURRENT_ENFORCE=false`. Once the migration cohort is at
    // 100% and the warning rate is ~zero, the enforce flag can be flipped.
    if (reusablePm && !reusablePm.provider_payment_source_id) {
      this.logger.warn(
        `WOMPI_LEGACY_TOKEN_USED subscriptionId=${invoice.store_subscription_id} invoiceId=${invoiceId} pmId=${reusablePm.id} ` +
          `(re-tokenization required before WOMPI_RECURRENT_ENFORCE flip)`,
      );
    }

    const paymentData: PaymentData = {
      orderId: invoiceId,
      amount: total.toNumber(),
      currency: invoice.currency,
      // No per-store payment method on the SaaS path; the gateway is
      // resolved via PlatformGatewayService.
      storeId: invoice.store_id,
      idempotencyKey,
      metadata: chargeMetadata,
    };

    const payment = await this.prisma.subscription_payments.create({
      data: {
        invoice_id: invoiceId,
        state: 'pending',
        amount: total,
        currency: invoice.currency,
        payment_method: 'wompi',
        metadata: {
          idempotency_key: idempotencyKey,
          reference,
          attempt: attemptCounter,
          ...(reusablePm ? { saved_payment_method_id: reusablePm.id } : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      // Bypass PaymentGatewayService registry (which assumes per-store
      // credentials) and call the Wompi processor directly with platform
      // creds + SaaS metadata.
      const result = await this.wompiProcessor.processPayment(paymentData);

      if (result.success) {
        // G11 — On success, reset consecutive_failures to 0 on the saved
        // payment method (idempotent: NOOP if already 0).
        if (reusablePm) {
          await this.resetPaymentMethodFailures(reusablePm.id);
        }
        return this.handleChargeSuccess(
          payment.id,
          invoiceId,
          invoice,
          result.transactionId,
          result.gatewayResponse,
        );
      }

      // Wompi Phase 6 / Tactical Gap #4 — Issuer-revoked payment_source.
      // The processor surfaces `errorCode='PAYMENT_SOURCE_REVOKED'` for both
      // PAYMENT_SOURCE_REVOKED and INVALID_PAYMENT_SOURCE; the SaaS layer
      // also accepts the raw INVALID_PAYMENT_SOURCE shape defensively. This
      // is NOT a card-holder failure — bumping consecutive_failures would
      // incorrectly trigger dunning. Mark PM revoked, attempt failover.
      if (
        reusablePm &&
        (result.errorCode === 'PAYMENT_SOURCE_REVOKED' ||
          result.errorCode === 'INVALID_PAYMENT_SOURCE')
      ) {
        return this.handleRevokedPaymentSource({
          payment,
          invoice,
          invoiceId,
          revokedPm: reusablePm,
          errorCode: result.errorCode,
          failureMessage: result.message ?? 'Payment source revoked',
        });
      }

      // G11 — Track consecutive failures on the saved payment method.
      if (reusablePm) {
        await this.bumpPaymentMethodFailure(
          reusablePm.id,
          invoice.store_subscription_id,
        );
      }
      return this.handleChargeFailure(
        payment.id,
        invoiceId,
        result.message ?? 'Charge failed',
      );
    } catch (err) {
      // The gateway APPROVED and the bookkeeping AFTER it failed (state
      // promotion). This is not a decline: filing it as one would flip a
      // payment the customer really made to `failed`, mark the paid invoice
      // overdue and bump the card toward dunning. Propagate it untouched so the
      // caller gets a 5xx instead of a false success.
      if (isPostApprovalFailure(err)) {
        throw err;
      }
      if (reusablePm) {
        await this.bumpPaymentMethodFailure(
          reusablePm.id,
          invoice.store_subscription_id,
        );
      }
      return this.handleChargeFailure(
        payment.id,
        invoiceId,
        err instanceof Error ? err.message : 'Charge failed',
      );
    }
  }

  /**
   * Wompi Phase 6 / Tactical Gap #4 — Handle a charge attempt that was
   * rejected because the issuer revoked the stored `payment_source` (Wompi
   * `INVALID_PAYMENT_SOURCE` / `PAYMENT_SOURCE_REVOKED`).
   *
   * Policy:
   *   1. Mark the revoked PM as invalid with `consecutive_failures=0` and
   *      `replaced_at=now`. Counter is NOT bumped — this is an issuer event,
   *      not a card-holder dunning trigger.
   *      Note: enum has no `revoked` value; we use `invalid` and tag the
   *      semantic via `subscription_events.payload.reason='payment_source_revoked'`.
   *   2. Emit a `payment_method_revoked` audit event (subscription_events).
   *   3. Failover — if another active PM with `provider_payment_source_id`
   *      exists for the same subscription, promote it to default and retry
   *      the charge ONCE inline. If that also fails, leave the invoice in
   *      pending and let the reconciliation cron retry on the next dunning
   *      cycle.
   *   4. If no fallback PM, mark the payment as failed and return — the
   *      cron / customer flow will pick it up.
   */
  private async handleRevokedPaymentSource(input: {
    payment: subscription_payments;
    invoice: any;
    invoiceId: number;
    revokedPm: { id: number; provider_payment_source_id: string | null };
    errorCode: string;
    failureMessage: string;
  }): Promise<subscription_payments> {
    const { payment, invoice, invoiceId, revokedPm, errorCode, failureMessage } =
      input;
    const subscriptionId = invoice.store_subscription_id;
    const storeId = invoice.store_id;

    this.logger.warn(
      `WOMPI_PM_REVOKED subscriptionId=${subscriptionId} storeId=${storeId} pmId=${revokedPm.id} errorCode=${errorCode}`,
    );

    // 1+2. Atomic invalidate + audit event. We deliberately do NOT call
    // bumpPaymentMethodFailure here — that path increments the counter.
    let fallbackPmId: number | null = null;
    try {
      await this.prisma.$transaction(async (tx: any) => {
        await tx.subscription_payment_methods.update({
          where: { id: revokedPm.id },
          data: {
            // Enum has no `revoked` value (active|invalid|removed|replaced);
            // use `invalid` and rely on the event payload below to tag the
            // semantic as "revoked by issuer" for ops/dunning consumers.
            state: subscription_payment_method_state_enum.invalid,
            consecutive_failures: 0,
            is_default: false,
            replaced_at: new Date(),
            updated_at: new Date(),
          },
        });

        // Promote a sibling active PM with a payment_source_id (failover
        // requires the COF/MIT flow to work end-to-end without prompting
        // the user). Prefer payment_source-enabled candidates.
        //
        // El candidato tiene que ser APTO PARA RENOVAR con el mismo predicado
        // que todo lo demás: promover una tarjeta vencida o con el contador de
        // fallos agotado dejaba el default apuntando a algo que el cobrador no
        // puede usar y el gate iba a pausar el autopago acto seguido.
        const fallback = await tx.subscription_payment_methods.findFirst({
          where: {
            ...renewalEligiblePmWhere(subscriptionId),
            id: { not: revokedPm.id },
            provider_payment_source_id: { not: null },
          },
          orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
        });
        if (fallback) {
          await tx.subscription_payment_methods.updateMany({
            where: {
              store_id: fallback.store_id,
              is_default: true,
              state: subscription_payment_method_state_enum.active,
            },
            data: { is_default: false, updated_at: new Date() },
          });
          await tx.subscription_payment_methods.update({
            where: { id: fallback.id },
            data: { is_default: true, updated_at: new Date() },
          });
          fallbackPmId = fallback.id;
        }

        await tx.subscription_events.create({
          data: {
            store_subscription_id: subscriptionId,
            type: 'payment_method_revoked',
            payload: {
              reason: 'payment_source_revoked',
              payment_method_id: revokedPm.id,
              error_code: errorCode,
              fallback_promoted_id: fallbackPmId,
            } as Prisma.InputJsonValue,
            triggered_by_job: 'subscription-payment-service',
          },
        });
      });
    } catch (e: any) {
      this.logger.warn(
        `handleRevokedPaymentSource: failed to invalidate pm=${revokedPm.id}: ${e?.message ?? e}`,
      );
    }

    // Best-effort domain event (banner / cache bust).
    try {
      this.eventEmitter.emit('payment_method.revoked', {
        subscriptionId,
        storeId,
        paymentMethodId: revokedPm.id,
        errorCode,
        fallbackPromotedId: fallbackPmId,
      });
    } catch (e: any) {
      this.logger.warn(
        `payment_method.revoked emit failed pm=${revokedPm.id}: ${e?.message ?? e}`,
      );
    }

    // 3. Inline single-shot failover when a usable fallback is available.
    if (fallbackPmId) {
      const fallbackPm = await this.prisma.subscription_payment_methods.findUnique({
        where: { id: fallbackPmId },
      });
      if (fallbackPm?.provider_payment_source_id) {
        this.logger.log(
          `WOMPI_CHARGE_PATH path=recurrent_failover subscriptionId=${subscriptionId} invoiceId=${invoiceId} pmId=${fallbackPmId}`,
        );

        const wompiConfig = await this.platformGw.getActiveCredentials('wompi');
        if (wompiConfig) {
          const retryAttempt =
            (await this.prisma.subscription_payments.count({
              where: { invoice_id: invoiceId },
            })) + 1;
          const retryPaymentData: PaymentData = {
            orderId: invoiceId,
            amount: new Prisma.Decimal(invoice.total).toNumber(),
            currency: invoice.currency,
            storeId,
            idempotencyKey: `sub_inv_${invoiceId}_att_${retryAttempt}_failover`,
            metadata: {
              subscription_payment: true,
              subscriptionId,
              invoiceId,
              invoice_number: invoice.invoice_number,
              reference: `vendix_saas_${subscriptionId}_${invoiceId}_${Date.now()}_failover`,
              wompiConfig: this.toProcessorWompiConfig(wompiConfig),
              payment_source_id: fallbackPm.provider_payment_source_id,
              customerEmail: `saas-${storeId}@vendix.app`,
              saved_payment_method_id: fallbackPm.id,
              failover_from_pm_id: revokedPm.id,
            },
          };

          try {
            const retryResult =
              await this.wompiProcessor.processPayment(retryPaymentData);
            if (retryResult.success) {
              await this.resetPaymentMethodFailures(fallbackPm.id);
              return this.handleChargeSuccess(
                payment.id,
                invoiceId,
                invoice,
                retryResult.transactionId,
                retryResult.gatewayResponse,
              );
            }
            // Retry also failed — log and fall through to handleChargeFailure
            // (no second retry to keep the flow bounded; cron will pick up).
            this.logger.warn(
              `WOMPI_FAILOVER_FAILED subscriptionId=${subscriptionId} invoiceId=${invoiceId} fallbackPmId=${fallbackPmId} message=${retryResult.message ?? 'unknown'}`,
            );
          } catch (e: any) {
            // Same rule as `charge()`: the failover charge was APPROVED and only
            // the post-approval promotion failed. Do not fall through to
            // handleChargeFailure — that would record a decline for money the
            // customer already paid.
            if (isPostApprovalFailure(e)) {
              throw e;
            }
            this.logger.warn(
              `WOMPI_FAILOVER_THREW subscriptionId=${subscriptionId} invoiceId=${invoiceId} fallbackPmId=${fallbackPmId} error=${e?.message ?? e}`,
            );
          }
        }
      }
    }

    // 4. No (working) fallback — mark payment failed and let the cron retry.
    return this.handleChargeFailure(payment.id, invoiceId, failureMessage);
  }

  /**
   * Wompi Phase 7 — Returns whether legacy inline-token charges are still
   * allowed for PMs without `provider_payment_source_id`.
   *
   * Delegates to {@link isLegacyInlineTokenAllowed} (reads
   * `WOMPI_RECURRENT_ENFORCE`). Default is log-only (`true`); flipping the
   * env flag to `'true'` switches to enforce mode and legacy PMs are rejected
   * with `PAYMENT_METHOD_NOT_MIGRATED`.
   *
   * Exposed as a class method (not a constant) so tests can stub it via
   * `jest.spyOn(service as any, 'legacyInlineTokenAllowed')`.
   */
  private legacyInlineTokenAllowed(): boolean {
    return isLegacyInlineTokenAllowed();
  }

  /**
   * G11 / S3.5 — Medio de pago con el que ESTA suscripción puede renovarse.
   *
   * Ya NO reimplementa el criterio: delega en
   * `renewal-eligibility.contract.ts`, el mismo predicado que consultan el gate
   * (`disableAutoRenewForMissingCredential`), el `where` del cron de
   * renovación, la ventana de reactivación, el rearme al tokenizar y la lectura
   * del panel. Antes había dos versiones privadas divergentes y podían
   * contradecirse en ambos sentidos.
   *
   * Dos diferencias deliberadas respecto de la versión anterior:
   *   - `is_default` pasó de requisito a PREFERENCIA de orden. Una tienda con
   *     tarjeta apta pero sin default se cobra igual en vez de caer en dunning.
   *   - El tipo debe ser TARJETA y la credencial debe ser cobrable (COF, o el
   *     token heredado mientras `WOMPI_RECURRENT_ENFORCE` siga apagado), que es
   *     exactamente lo que `charge()` necesita para no cobrar contra el vacío.
   *
   * Devuelve null cuando no hay medio apto; el llamador cae al flujo del widget.
   */
  private async resolveReusablePaymentMethod(
    subscriptionId: number,
  ): Promise<RenewalEligiblePaymentMethod | null> {
    const now = new Date();
    const pm = await this.prisma.subscription_payment_methods.findFirst({
      where: renewalEligiblePmWhere(subscriptionId, now),
      orderBy: [
        { is_default: 'desc' },
        { cof_registered_at: 'desc' },
        { created_at: 'desc' },
      ],
    });
    if (!pm) return null;

    // Re-verificación en memoria: el `where` es un pre-filtro SQL del mismo
    // predicado, pero la función es la verdad. Si alguna vez divergen, el
    // resultado seguro es "no hay medio apto" → el gate pausa y avisa.
    const eligible = pickRenewalEligiblePaymentMethod([pm], now);
    if (!eligible) return null;

    return toRenewalEligiblePaymentMethod(eligible);
  }

  /**
   * `true` cuando la suscripción tiene al menos un medio apto para renovar,
   * leído DENTRO de la transacción del llamador.
   *
   * Mismo predicado que `resolveReusablePaymentMethod`, expresado como pregunta
   * booleana para el gate. Se lee en la tx del llamador a propósito: el registro
   * automático de la tarjeta ocurre en esa misma transacción y el gate tiene que
   * verla.
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
   * Versión pública sin transacción, para el cron de renovación y para
   * cualquier lector que solo necesite la respuesta.
   */
  async hasRenewalEligiblePaymentMethod(
    subscriptionId: number,
    now: Date = new Date(),
  ): Promise<boolean> {
    const rows = await this.prisma.subscription_payment_methods.findMany({
      where: renewalEligiblePmWhere(subscriptionId, now),
    });
    return pickRenewalEligiblePaymentMethod(rows, now) !== null;
  }

  /**
   * S3.5 — Reset consecutive_failures to 0 after a successful charge.
   * No-op if the counter is already 0 (idempotent).
   */
  private async resetPaymentMethodFailures(
    paymentMethodId: number,
  ): Promise<void> {
    try {
      const pm = await this.prisma.subscription_payment_methods.findUnique({
        where: { id: paymentMethodId },
      });
      if (!pm) return;
      if ((pm.consecutive_failures ?? 0) === 0) return;
      await this.prisma.subscription_payment_methods.update({
        where: { id: paymentMethodId },
        data: { consecutive_failures: 0, updated_at: new Date() },
      });
    } catch (e: any) {
      this.logger.warn(
        `resetPaymentMethodFailures failed pm=${paymentMethodId}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * S3.5 — Bump consecutive_failures on a saved payment method. When the
   * counter reaches MAX_CONSECUTIVE_FAILURES the PM is invalidated
   * (`state='invalid'`, `is_default=false`), a `state_transition` event is
   * persisted in `subscription_events`, the next active PM (if any) is
   * promoted to default, and a `subscription.payment-method-invalidated-failures.email`
   * job is enqueued.
   *
   * Mirrors the post-expiry sweep contract in
   * `PaymentMethodExpiryNotifierJob.invalidateExpiredCards` so banner UX,
   * timeline events, and dunning logic can treat both reasons uniformly.
   */
  private async bumpPaymentMethodFailure(
    paymentMethodId: number,
    subscriptionId: number,
  ): Promise<void> {
    try {
      const pm = await this.prisma.subscription_payment_methods.findUnique({
        where: { id: paymentMethodId },
      });
      if (!pm) return;
      if (pm.state !== 'active') return; // do not bump a PM already invalidated

      const next = (pm.consecutive_failures ?? 0) + 1;
      const isInvalid = next >= MAX_CONSECUTIVE_FAILURES;

      if (!isInvalid) {
        await this.prisma.subscription_payment_methods.update({
          where: { id: paymentMethodId },
          data: {
            consecutive_failures: next,
            updated_at: new Date(),
          },
        });
        this.logger.log(
          `PAYMENT_METHOD_FAILURE_BUMPED pm=${paymentMethodId} sub=${subscriptionId} consecutive_failures=${next}`,
        );
        return;
      }

      // Threshold reached → atomic invalidate + promote-default + event.
      const wasDefault = pm.is_default === true;
      const now = new Date();
      const txResult = await this.prisma.$transaction(async (tx: any) => {
        await tx.subscription_payment_methods.update({
          where: { id: paymentMethodId },
          data: {
            state: 'invalid',
            consecutive_failures: next,
            is_default: false,
            updated_at: now,
          },
        });

        let promotedId: number | null = null;
        if (wasDefault) {
          const candidate = await tx.subscription_payment_methods.findFirst({
            where: {
              store_id: pm.store_id,
              state: 'active',
              id: { not: pm.id },
            },
            orderBy: { created_at: 'desc' },
            select: { id: true },
          });
          if (candidate) {
            await tx.subscription_payment_methods.updateMany({
              where: { store_id: pm.store_id, is_default: true },
              data: { is_default: false, updated_at: now },
            });
            await tx.subscription_payment_methods.update({
              where: { id: candidate.id },
              data: { is_default: true, updated_at: now },
            });
            promotedId = candidate.id;
          }
        }

        await tx.subscription_events.create({
          data: {
            store_subscription_id: subscriptionId,
            type: 'state_transition',
            payload: {
              reason: 'consecutive_failures_threshold',
              payment_method_id: pm.id,
              store_id: pm.store_id,
              consecutive_failures: next,
              was_default: wasDefault,
              promoted_default_id: promotedId,
              last_four: pm.last4 ?? null,
              brand: pm.brand ?? null,
            } as Prisma.InputJsonValue,
            triggered_by_job: 'subscription-payment-service',
          },
        });

        return { promotedId };
      });

      // Structured log (matches post-expiry sweep format for parity).
      this.logger.warn(
        `PAYMENT_METHOD_AUTO_INVALIDATED payment_method_id=${pm.id} ` +
          `store_id=${pm.store_id} ` +
          `store_subscription_id=${subscriptionId} ` +
          `consecutive_failures=${next} ` +
          `reason=consecutive_failures ` +
          `was_default=${wasDefault} ` +
          `promoted_default_id=${txResult.promotedId ?? 'none'}`,
      );

      // Best-effort domain event for in-process listeners (banner cache bust).
      try {
        this.eventEmitter.emit('payment_method.invalidated', {
          subscriptionId,
          paymentMethodId,
          reason: 'consecutive_failures',
        });
      } catch (e: any) {
        this.logger.warn(
          `payment_method.invalidated emit failed pm=${paymentMethodId}: ${e?.message ?? e}`,
        );
      }

      // Notify customer.
      try {
        await this.emailQueue.add(
          'subscription.payment-method-invalidated-failures.email',
          {
            subscriptionId,
            storeId: pm.store_id,
            paymentMethodId: pm.id,
            last_four: pm.last4 ?? null,
            brand: pm.brand ?? null,
            consecutive_failures: next,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 50 },
          },
        );
      } catch (e: any) {
        this.logger.warn(
          `Failed to enqueue payment-method-invalidated-failures email pm=${paymentMethodId}: ${e?.message ?? e}`,
        );
      }
    } catch (e: any) {
      this.logger.warn(
        `bumpPaymentMethodFailure failed pm=${paymentMethodId}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Resolve the saved_payment_method_id stored in payment metadata. Used by
   * webhook flows where the payment row was created earlier (charge() or
   * prepareWidgetCharge) and the PM linkage lives in `metadata`.
   */
  private extractSavedPaymentMethodId(metadata: unknown): number | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const meta = metadata as Record<string, unknown>;
    const id = meta.saved_payment_method_id ?? meta.payment_method_id;
    const n = typeof id === 'number' ? id : Number(id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * Bridge platform gateway DecryptedCreds (env enum from
   * PlatformGatewayEnvironmentEnum) into the WompiConfig shape the processor
   * expects (env from WompiEnvironment).
   */
  private toProcessorWompiConfig(creds: DecryptedCreds) {
    return {
      public_key: creds.public_key,
      private_key: creds.private_key,
      events_secret: creds.events_secret,
      integrity_secret: creds.integrity_secret,
      environment:
        creds.environment === PlatformGatewayEnvironmentEnum.PRODUCTION
          ? WompiEnvironment.PRODUCTION
          : WompiEnvironment.SANDBOX,
    };
  }

  async refund(
    invoiceId: number,
    amount?: number,
  ): Promise<subscription_payments> {
    const existing = await this.prisma.subscription_payments.findFirst({
      where: { invoice_id: invoiceId, state: 'succeeded' },
    });

    if (!existing) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'No successful payment to refund',
      );
    }

    if (!existing.gateway_reference) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
        'No gateway reference on payment',
      );
    }

    const refundAmount =
      amount ?? new Prisma.Decimal(existing.amount).toNumber();

    const refundResult = await this.gateway.refundPayment(
      existing.gateway_reference,
      refundAmount,
      'Subscription refund',
    );

    const updatedPayment = await this.prisma.$transaction(async (tx: any) => {
      const isFullRefund =
        !amount ||
        new Prisma.Decimal(amount).greaterThanOrEqualTo(existing.amount);

      const updatedPayment = await tx.subscription_payments.update({
        where: { id: existing.id },
        data: {
          state: isFullRefund ? 'refunded' : ('partial_refund' as const),
          updated_at: new Date(),
          metadata: {
            ...(existing.metadata && typeof existing.metadata === 'object'
              ? (existing.metadata as Record<string, unknown>)
              : {}),
            refund_amount: refundAmount,
            refund_result: refundResult.success ? 'success' : 'failed',
          } as Prisma.InputJsonValue,
        },
      });

      if (refundResult.success && isFullRefund) {
        // RNC-10/RNC-11: only full refunds change invoice state to 'refunded'.
        // Partial refunds leave the invoice in 'paid'; the partial chargeback
        // is recorded only on the subscription_payments row (state='partial_refund').
        await tx.subscription_invoices.update({
          where: { id: invoiceId },
          data: {
            state: 'refunded',
            updated_at: new Date(),
          },
        });
      }

      return updatedPayment;
    });

    // RNC-MF-3: notify the platform accounting pipeline so Vendix's books
    // reverse the SaaS revenue (DR 4175 / CR 1110). Emit AFTER the
    // transaction commits and only when the gateway actually returned
    // money — a failed gateway refund must not produce a journal entry.
    if (refundResult.success) {
      try {
        this.eventEmitter.emit('subscription.payment.refunded', {
          refundEventId: updatedPayment.id,
          amount: refundAmount,
          entryDate: new Date(),
          userId: undefined,
        });
      } catch (e: any) {
        this.logger.warn(
          `subscription.payment.refunded emit failed for payment=${updatedPayment.id}: ${e?.message ?? e}`,
        );
      }
    }

    return updatedPayment;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async handleChargeSuccess(
    paymentId: number,
    invoiceId: number,
    invoice: any,
    transactionId?: string,
    gatewayResponse?: any,
    externalTx?: Prisma.TransactionClient,
  ): Promise<subscription_payments> {
    // Set when the state promotion failed on a self-owned transaction: the
    // money rows commit (they are true) and this is rethrown after the
    // post-commit side effects, so no caller sees a clean success.
    let promotionFailure: unknown = null;

    // Captured by the in-tx `disableAutoRenewForMissingCredential` so the
    // post-commit emit can pass it to the billing-warning listener. Stays
    // null when a recurring PM is already persisted (no gate fired → no
    // listener dedupe row).
    let noCredentialEventId: number | null = null;

    // Puesto en true cuando el pago con tarjeta rearmó el autopago dentro de esta
    // transacción. El aviso al comerciante se emite post-commit.
    let autoRenewRearmed = false;

    // If an external transaction is provided (e.g. from the atomic webhook
    // dedup flow), execute writes directly inside it — no nested $transaction.
    // Otherwise open a new transaction (charge() / handleZeroInvoice paths).
    const executeWrites = async (
      tx: Prisma.TransactionClient,
    ): Promise<subscription_payments> => {
      const now = new Date();
      const existingPayment = await tx.subscription_payments.findUnique({
        where: { id: paymentId },
        select: { metadata: true },
      });
      const existingMetadata =
        existingPayment?.metadata &&
        typeof existingPayment.metadata === 'object' &&
        !Array.isArray(existingPayment.metadata)
          ? (existingPayment.metadata as Record<string, unknown>)
          : {};

      const updatedPayment = await tx.subscription_payments.update({
        where: { id: paymentId },
        data: {
          state: 'succeeded',
          gateway_reference: transactionId ?? null,
          paid_at: now,
          metadata: {
            ...existingMetadata,
            ...(gatewayResponse ? { gateway_response: gatewayResponse } : {}),
          } as Prisma.InputJsonValue,
          updated_at: now,
        },
      });

      await tx.subscription_invoices.update({
        where: { id: invoiceId },
        data: {
          state: 'paid',
          amount_paid: invoice.total,
          updated_at: now,
        },
      });

      // ── Auto-register the card used for this charge as a saved
      // subscription_payment_method (implicit > explicit). This is the
      // canonical path: the user pays the real invoice via Wompi widget,
      // and the card used is persisted as the recurring PM with
      // is_default=true. No standalone "add card" flow is needed.
      //
      // Errors are swallowed (logged) — the payment is already approved by
      // the gateway and the invoice is paid; failing to persist the PM
      // must NOT roll back the success transaction. The user can re-pay
      // manually next renewal if the PM record is missing.
      try {
        await this.autoRegisterPaymentMethodFromGateway(
          tx,
          invoice.store_id,
          invoice.store_subscription_id,
          gatewayResponse,
          paymentId,
        );
      } catch (e: any) {
        this.logger.warn(
          `autoRegisterPaymentMethodFromGateway failed for invoice ${invoiceId}: ${e?.message ?? e}`,
        );
      }

      // ── Rearme del autopago (defecto 4). Pagar con TARJETA es guardar una
      // tarjeta: si el gate lo había pausado por falta de credencial y ahora hay
      // medio apto, el autopago vuelve solo y se avisa. Sin esto, una tienda ya
      // `active` (que no camina la ruta de reactivación) quedaba pausada para
      // siempre aunque acabara de pagar con tarjeta.
      //
      // Errores tragados a propósito: el cobro ya está aprobado y la factura
      // pagada; no rearmar es recuperable (el alta explícita de tarjeta también
      // cura), revertir el cobro no lo es.
      if (invoice.store_id) {
        try {
          const rearm = await this.stateService.rearmAutoRenewAfterCredentialInTx(
            tx,
            {
              storeId: invoice.store_id,
              subscriptionId: invoice.store_subscription_id,
              source: 'charge_auto_register',
            },
          );
          if (rearm.rearmed) {
            autoRenewRearmed = true;
          }
        } catch (e: any) {
          this.logger.warn(
            `rearmAutoRenewAfterCredentialInTx failed for invoice ${invoiceId}: ${e?.message ?? e}`,
          );
        }
      }

      // ── Billing-warning detection: if the gateway did NOT persist a
      // recurring credential, we cannot trust the next renewal — turn
      // `auto_renew` off and stamp a `subscription_events` audit row so
      // the store's renewal cron doesn't silently try to charge nothing.
      //
      // NOT wrapped in try/catch on purpose: a failure here rolls back the
      // entire transaction, taking the (already captured) payment with it.
      // The user constraint is "don't consume plan days silently" — a
      // captured charge with no recurring credential IS that failure mode,
      // so we refuse to commit it. The webhook will redeliver (caller-owned
      // tx) or the inline charge() will return non-2xx (self-owned tx),
      // and Wompi's idempotency makes that retry cheap.
      const insertedEventId = await this.disableAutoRenewForMissingCredential(
        tx,
        invoice,
        paymentId,
        transactionId,
        externalTx ? 'webhook' : 'checkout_commit',
      );
      if (insertedEventId != null) {
        noCredentialEventId = insertedEventId;
      }

      // Synchronous subscription-state promotion (root-cause fix for
      // pending_payment drift). The listener at
      // `SubscriptionStateListener.onPaymentSucceeded` is best-effort and
      // post-commit; if it fails or is delayed, subscriptions get stuck in
      // pending_payment despite the payment being approved. Doing the
      // promotion here, INSIDE the same tx that flips payment->succeeded
      // and invoice->paid, guarantees atomicity.
      //
      // ADR-2: When invoice.to_plan_id is set, this is a "pending-change flow"
      // (upgrade, initial, resubscribe, trial_conversion, renewal with plan
      // change). confirmPendingChange() handles plan promotion, period reset,
      // state transition and cache invalidation atomically.
      //
      // When invoice.to_plan_id is null, this is the renewal / reactivation
      // flow: no plan changes hands, the collection simply has to leave the
      // store operational.
      //
      // BOTH branches end in `ensureOperationalInTx`, and a failure there is
      // NOT swallowed any more — see the catch below.
      if (invoice.store_id) {
        try {
          if (invoice.to_plan_id != null) {
            // ── New pending-change flow (ADR-2) ──────────────────────────
            await this.confirmPendingChange(
              {
                id: invoiceId,
                store_subscription_id: invoice.store_subscription_id,
                to_plan_id: invoice.to_plan_id,
                from_plan_id: invoice.from_plan_id ?? null,
                change_kind: invoice.change_kind ?? null,
              },
              tx,
            );
          } else {
            // ── Renewal / reactivation flow (no plan change) ──────────────
            //
            // This was the LAST hand-rolled copy of the reactivation policy.
            // It gated the promotion on a local `PROMOTABLE_ON_PAYMENT_SUCCESS`
            // list which — like every other deleted copy — left out
            // `cancelled` / `expired`: a renewal payment collected against a
            // cancelled store promoted NOTHING, the invoice was marked paid,
            // and the store stayed terminal behind an HTTP 200. It also
            // recomputed the consumed-grace discount by hand (RNC-22), a
            // second implementation of arithmetic the seam already owns, which
            // is exactly how the two sites drift.
            //
            // `ensureOperationalInTx` replaces both: it resolves the legal
            // route from wherever the row actually sits (two hops via
            // `pending_payment` for the terminal states), no-ops on
            // active/trial so nothing is re-transitioned and no free time is
            // granted, discounts the grace days consumed past a lapsed
            // `current_period_end`, clears the stale dunning/cancellation
            // columns, and re-reads the row before returning.
            //
            // No state test belongs here any more: which states can reach
            // `active`, and how, is the seam's policy alone. `tx` is the
            // caller's transaction — the promotion must be atomic with the
            // payment/invoice rows, and `ensureOperational` (non-InTx) would
            // open a second transaction that deadlocks against the
            // `FOR UPDATE` lock this one already holds. The plan cycle and the
            // previous state are read from the locked row by the seam, so they
            // are deliberately not passed in.
            await this.stateService.ensureOperationalInTx(
              tx,
              invoice.store_id,
              {
                reason: `payment_${paymentId}_approved`,
                triggeredByJob: 'webhook',
                payload: {
                  invoice_id: invoiceId,
                  payment_id: paymentId,
                  source: 'handle_charge_success_sync',
                },
              },
            );
          }
        } catch (txStateErr: any) {
          // NOT swallowed any more. This used to log a warning and let the flow
          // return a clean success: payment committed as `succeeded`, invoice as
          // `paid`, store still degraded. That silence is the failure mode the
          // reactivation seam exists to remove and the one that buried both
          // production incidents — a 200 the customer only discovers while
          // trying to operate.
          //
          // Severity is `error`, with a greppable tag: this is an invariant
          // break (the seam only throws when no legal route exists or its exit
          // guard re-read a degraded row), not routine noise.
          this.logger.error(
            `PAYMENT_STATE_PROMOTION_FAILED invoice=${invoiceId} payment=${paymentId} ` +
              `store=${invoice.store_id} subscription=${invoice.store_subscription_id} ` +
              `tx_owner=${externalTx ? 'caller' : 'self'}: ` +
              `${txStateErr?.message ?? txStateErr}`,
            txStateErr?.stack,
          );

          markPostApprovalFailure(txStateErr);

          // WHO OWNS THE TRANSACTION decides what "not silent" costs here.
          //
          // Caller-owned tx (webhook): rethrow now. It aborts the caller's
          // transaction, so the payment/invoice rows roll back together with
          // the failed promotion, the webhook answers non-2xx and Wompi
          // REDELIVERS the same transaction — one capture, retried end to end,
          // promotion included. Rolling back is strictly better there.
          if (externalTx) {
            throw txStateErr;
          }

          // Self-owned tx (inline charge / zero invoice): nobody will redeliver.
          // Rolling back would leave the invoice unpaid with the money already
          // captured, and the renewal retry queue would then charge the card a
          // SECOND time (`charge()` only refuses an invoice that is already
          // `paid`). So the money rows — which are TRUE, we were paid — commit,
          // and the error is rethrown after the post-commit side effects so the
          // caller still cannot report success. The retry queue then short-
          // circuits on the paid invoice, and the listener's own
          // `ensureOperational` (fed by the emit below) gets a second chance at
          // the promotion.
          promotionFailure = txStateErr;
        }
      }

      // Outbox pattern: insert a commission_accrual_pending row inside the
      // SAME transaction as the invoice paid update. This guarantees
      // atomicity — if the tx fails, neither invoice paid nor outbox row
      // is committed. The asynchronous worker (commission-accrual BullMQ
      // processor) will later read this row and create/update the actual
      // partner_commissions record.
      if (invoice.partner_organization_id) {
        const splitBreakdown = invoice.split_breakdown as Record<
          string,
          unknown
        > | null;
        const partnerShare = splitBreakdown?.partner_share
          ? new Prisma.Decimal(splitBreakdown.partner_share as string)
          : DECIMAL_ZERO;

        if (partnerShare.greaterThan(DECIMAL_ZERO)) {
          try {
            await tx.commission_accrual_pending.upsert({
              where: { invoice_id: invoiceId },
              create: {
                invoice_id: invoiceId,
                partner_organization_id: invoice.partner_organization_id,
                amount: partnerShare,
                currency: invoice.currency,
                state: 'pending',
              },
              update: {}, // no-op if already exists
            });
          } catch (e: any) {
            if (e?.code !== 'P2002') {
              throw e;
            }
            this.logger.warn(
              `Commission accrual outbox hit P2002 for invoice ${invoiceId}; skipped`,
            );
          }
        }
      }

      return updatedPayment;
    };

    const result = externalTx
      ? await executeWrites(externalTx)
      : await this.prisma.$transaction(
          (tx: Prisma.TransactionClient) => executeWrites(tx),
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );

    // Post-commit side effects.
    //
    // When externalTx is present the caller (SubscriptionWebhookService) owns
    // the transaction boundary. These side effects must run AFTER the external
    // tx commits, so the webhook handler is responsible for triggering them.
    // Skip them here to avoid running before commit (race) or on rollback.
    if (!externalTx) {
      // Enqueue the commission-accrual worker so the outbox row is processed
      // asynchronously. If enqueue fails, the row stays pending and will be
      // picked up by reconciliation or manual retry.
      if (invoice.partner_organization_id) {
        const splitBreakdown = invoice.split_breakdown as Record<
          string,
          unknown
        > | null;
        const partnerShare = splitBreakdown?.partner_share
          ? new Prisma.Decimal(splitBreakdown.partner_share as string)
          : DECIMAL_ZERO;

        if (partnerShare.greaterThan(DECIMAL_ZERO)) {
          try {
            await this.commissionQueue.add(
              'accrual',
              { invoiceId },
              {
                attempts: 5,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { age: 3600, count: 100 },
                removeOnFail: { age: 86400 },
              },
            );
          } catch (e: any) {
            this.logger.warn(
              `Failed to enqueue commission accrual job for invoice ${invoiceId}: ${e?.message ?? e}`,
            );
          }
        }
      }

      // Emit `subscription.payment.succeeded` so the SubscriptionStateListener
      // can auto-promote the subscription from `pending_payment` (or
      // `grace_*`/`blocked`) to `active` immediately — without waiting for the
      // daily 03:00 dunning cron.
      //
      // Wrapped because emit() is sync but listener errors must NOT break
      // the caller (charge() returning to checkout commit). Listener also
      // wraps in try/catch as defense in depth.
      try {
        this.eventEmitter.emit('subscription.payment.succeeded', {
          invoiceId,
          paymentId,
          subscriptionId: invoice.store_subscription_id,
          storeId: invoice.store_id,
          source: 'charge_success',
        });
      } catch (e: any) {
        this.logger.warn(
          `subscription.payment.succeeded emit failed for invoice ${invoiceId}: ${e?.message ?? e}`,
        );
      }

      // Emit `subscription.payment.no_credential` when the gate flipped
      // auto_renew off in this very transaction. The
      // SubscriptionPaymentBillingWarningListener upserts a dedupe row
      // into `billing_warning_logs` keyed on the subscription_event id,
      // then broadcasts the bell + enqueues the email.
      //
      // Wrapped for the same reason as the success emit above; the
      // listener also swallows internally.
      if (noCredentialEventId != null) {
        try {
          this.eventEmitter.emit('subscription.payment.no_credential', {
            subscriptionEventId: noCredentialEventId,
            storeId: invoice.store_id,
            paymentId,
            source: 'self',
          });
        } catch (e: any) {
          this.logger.warn(
            `subscription.payment.no_credential emit failed for invoice ${invoiceId}: ${e?.message ?? e}`,
          );
        }
      }

      // Aviso simétrico al de la pausa: el comerciante también debe enterarse de
      // que el autopago volvió a quedar armado, en pantalla y por correo.
      if (autoRenewRearmed && invoice.store_id) {
        try {
          this.eventEmitter.emit('subscription.auto_renew.rearmed', {
            storeId: invoice.store_id,
            subscriptionId: invoice.store_subscription_id,
            paymentMethodId: null,
            source: 'charge_auto_register',
          });
        } catch (e: any) {
          this.logger.warn(
            `subscription.auto_renew.rearmed emit failed for invoice ${invoiceId}: ${e?.message ?? e}`,
          );
        }
      }
    }

    // The collection is recorded, the side effects fired — and the store is NOT
    // operational. Fail the call: a caller that got a `subscription_payments`
    // row back would answer 200 to a customer whose store is still locked.
    if (promotionFailure) {
      throw promotionFailure;
    }

    return result;
  }

  /**
   * Billing-warning gate — fired immediately after `autoRegisterPaymentMethodFromGateway`
   * inside `handleChargeSuccess.executeWrites`.
   *
   * If the gateway approved the charge but no `subscription_payment_methods`
   * row was persisted for this subscription (`cof_registered_at` not set on
   * any active row), the next renewal will have nothing to charge — silently
   * consume the plan window, then expire. We flip `store_subscriptions.auto_renew`
   * to false NOW and stamp a `subscription_events` audit row so:
   *   1. The renewal cron skips this store until the user tokenizes a card.
   *   2. The post-commit `subscription.payment.no_credential` emit can hand
   *      the event id to the billing-warning listener for bell + email.
   *
   * Idempotency: the check is "does any active PM exist for this subscription
   * with `cof_registered_at IS NOT NULL`?" — a re-delivered webhook or a
   * retry therefore short-circuits without flipping auto_renew twice.
   *
   * NOT wrapped in try/catch by the caller. The gate is the
   * "don't consume plan days silently" invariant — if THIS fails, the
   * charge is rolled back so the merchant can retry with a fresh
   * payment_source_id. Wompi's idempotency makes the retry cheap.
   *
   * Returns the new `subscription_events.id` when the gate flipped, or
   * null when a recurring PM was already on file (no-op).
   */
  private async disableAutoRenewForMissingCredential(
    tx: Prisma.TransactionClient,
    invoice: any,
    paymentId: number,
    transactionId: string | undefined,
    triggeredByJob: 'webhook' | 'checkout_commit',
  ): Promise<number | null> {
    const subscriptionId = invoice?.store_subscription_id as number | undefined;
    if (!subscriptionId || !Number.isInteger(subscriptionId)) {
      return null;
    }
    const storeId = invoice?.store_id as number | undefined;
    if (!storeId || !Number.isInteger(storeId)) {
      return null;
    }

    return this.pauseAutoRenewForMissingCredentialInTx(tx, {
      subscriptionId,
      storeId,
      source: triggeredByJob === 'webhook' ? 'webhook' : 'checkout_commit',
      triggeredByJob,
      auditSource: 'no_credential_post_register',
      eventKey: `no-cred-${paymentId}-${transactionId ?? 'no-tx'}`,
      payload: {
        transaction_id: transactionId ?? null,
        payment_id: paymentId,
      },
    });
  }

  /**
   * Núcleo del gate, compartido por el checkout/webhook, el cron de renovación
   * y el pago manual del administrador. Corre SIEMPRE dentro de la transacción
   * del llamador.
   *
   * Hace tres cosas y ninguna más:
   *   1. Consulta EL predicado (`hasRenewalEligiblePmInTx`). Si hay medio apto,
   *      no toca nada y devuelve null.
   *   2. Apaga `auto_renew` y RECUERDA LA INTENCIÓN en
   *      `store_subscriptions.metadata.auto_renew_intent` — mismo mecanismo que
   *      `metadata.pending_credit`, sin migración. La intención solo se guarda
   *      cuando `auto_renew` estaba encendido: si el cliente lo había apagado a
   *      mano, no inventamos que lo quiere.
   *   3. Estampa un `subscription_events` de tipo
   *      `auto_renew_disabled_no_credential` y devuelve su id para que el emit
   *      post-commit alimente al listener (campana + correo).
   *
   * IDEMPOTENCIA: si ya existe una fila de auditoría SIN `payload.resolved_at`,
   * no se estampa otra y se devuelve null. Sin esta guarda cada intento de cobro
   * y cada corrida del cron generaban un `subscription_events` nuevo, con un id
   * nuevo, y el UNIQUE de `billing_warning_logs` (store, type, source_event_id)
   * no colapsaba nada: el comerciante recibía una campana y un correo por
   * intento. `auto_renew` sí se re-asegura en false, que es idempotente.
   */
  private async pauseAutoRenewForMissingCredentialInTx(
    tx: Prisma.TransactionClient,
    args: {
      subscriptionId: number;
      storeId: number;
      source: AutoRenewPauseSource;
      triggeredByJob: string;
      auditSource: string;
      eventKey: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<number | null> {
    const { subscriptionId, storeId, source, triggeredByJob } = args;
    const now = new Date();

    // 1. EL predicado. Con medio apto no hay nada que pausar.
    if (await this.hasRenewalEligiblePmInTx(tx, subscriptionId, now)) {
      return null;
    }

    // 2. Apagar el autopago recordando la intención del cliente.
    const sub = await tx.store_subscriptions.findFirst({
      where: { id: subscriptionId },
      select: { id: true, auto_renew: true, metadata: true },
    });
    if (sub?.auto_renew === true) {
      await tx.store_subscriptions.update({
        where: { id: sub.id },
        data: {
          auto_renew: false,
          metadata: metadataWithPausedAutoRenewIntent(sub.metadata, {
            source,
            now,
          }) as Prisma.InputJsonValue,
          updated_at: now,
        },
      });
    } else if (!sub) {
      // Sin fila no hay nada que pausar ni a quién avisarle.
      return null;
    }

    // 3. Auditoría — una sola fila abierta por ciclo de pausa.
    const openWarning = await this.findUnresolvedNoCredentialEventInTx(
      tx,
      subscriptionId,
    );
    if (openWarning != null) {
      this.logger.log(
        `AUTO_RENEW_PAUSE_DEDUPED store=${storeId} sub=${subscriptionId} ` +
          `openEvent=${openWarning} source=${source} — aviso ya emitido, no se re-notifica`,
      );
      return null;
    }

    const event = await tx.subscription_events.create({
      data: {
        store_subscription_id: subscriptionId,
        type: 'auto_renew_disabled_no_credential',
        payload: {
          event_id: args.eventKey,
          transaction_id: null,
          payment_id: null,
          ...(args.payload ?? {}),
          store_subscription_id: subscriptionId,
          source: args.auditSource,
          paused_by: source,
          resolved_at: null,
        } as Prisma.InputJsonValue,
        triggered_by_job: triggeredByJob,
      },
      select: { id: true },
    });

    this.logger.warn(
      `AUTO_RENEW_PAUSED_NO_CREDENTIAL store=${storeId} sub=${subscriptionId} ` +
        `event=${event.id} source=${source} — el autopago solo funciona con tarjeta`,
    );

    return event.id;
  }

  /**
   * Id del `subscription_events.auto_renew_disabled_no_credential` más reciente
   * que sigue SIN resolver, o null.
   *
   * Mismo filtro SQL que usa `SubscriptionPaymentMethodsService` para curar el
   * aviso al tokenizar una tarjeta: el path JSON de Prisma es frágil entre
   * versiones menores, así que ambos lados leen `payload->>'resolved_at'` en SQL
   * crudo para que la pausa y la cura hablen del MISMO registro.
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
   * Entrada pública del gate para llamadores que NO están dentro de una
   * transacción: el cron de renovación y el pago manual del administrador.
   *
   * Abre su propia transacción, corre el gate y — si pausó — emite
   * `subscription.payment.no_credential` DESPUÉS del commit, para que el
   * listener no dispare campana ni correo sobre una escritura que se revirtió.
   *
   * Devuelve el id del evento de auditoría cuando pausó, o null.
   */
  async pauseAutoRenewForMissingCredential(args: {
    subscriptionId: number;
    storeId: number;
    source: AutoRenewPauseSource;
    triggeredByJob: string;
    auditSource: string;
    eventKey: string;
    payload?: Record<string, unknown>;
  }): Promise<number | null> {
    const eventId = await this.prisma.$transaction(
      (tx: Prisma.TransactionClient) =>
        this.pauseAutoRenewForMissingCredentialInTx(tx, args),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    if (eventId == null) {
      return null;
    }

    try {
      this.eventEmitter.emit('subscription.payment.no_credential', {
        subscriptionEventId: eventId,
        storeId: args.storeId,
        paymentId: 0,
        source: args.source,
      });
    } catch (e: any) {
      this.logger.warn(
        `subscription.payment.no_credential emit failed for sub ${args.subscriptionId}: ${e?.message ?? e}`,
      );
    }

    return eventId;
  }

  /**
   * Auto-register the card used in a successful Wompi charge as a
   * subscription_payment_methods row. This is the canonical "implicit PM
   * registration" path: when the user pays a real invoice via the Wompi
   * widget, the card used becomes the saved recurring PM (is_default=true).
   *
   * Idempotent — webhook redelivery or duplicate charge is safe:
   *   - A row with the same provider_token for this store is reused
   *     (only `last_used_at` / metadata gets refreshed; no new row).
   *   - If the card data is incomplete (e.g. payment_method_type !== 'CARD',
   *     no provider_token, no last_four), the call is a NO-OP. The user can
   *     still pay; we just won't persist a recurring PM. Next successful
   *     charge with full data will register it.
   *
   * Wompi `transaction.payment_method` shape for CARD:
   *   {
   *     type: 'CARD',
   *     installments: 1,
   *     extra: { last_four, name, brand, exp_year, exp_month, ... }
   *   }
   * The recurring token comes via `transaction.payment_method_token` (or
   * `payment_method.token` depending on widget version) — without it we
   * cannot reuse the card for renewals, so we skip persistence.
   */
  private async autoRegisterPaymentMethodFromGateway(
    tx: Prisma.TransactionClient,
    storeId: number | null | undefined,
    subscriptionId: number,
    gatewayResponse: any,
    paymentId: number,
  ): Promise<void> {
    if (!storeId) return;
    if (!gatewayResponse || typeof gatewayResponse !== 'object') return;

    // Wompi shape: `transaction.payment_method.type` (current API). The
    // legacy `payment_method_type` top-level key is also accepted.
    const paymentMethodType = String(
      gatewayResponse.payment_method?.type ??
        gatewayResponse.payment_method_type ??
        gatewayResponse.type ??
        '',
    ).toUpperCase();
    // Empty type => assume CARD (best-effort: the gateway response is
    // optional in some retry paths). Wallets like NEQUI / PSE are one-shot
    // per Wompi's contract — re-prompt the user each time.
    if (paymentMethodType && paymentMethodType !== 'CARD') {
      return;
    }

    // Wompi Phase 5 — extract `payment_source_id` (long-lived) instead of
    // the short-lived recurring token. Wompi exposes it on the transaction
    // body as `payment_source.id` when a card was saved server-side via
    // `/payment_sources` (or as the top-level `payment_source_id` field on
    // some webhook shapes).
    const rawPsId =
      gatewayResponse?.payment_source_id ??
      gatewayResponse?.payment_source?.id ??
      null;

    if (rawPsId == null) {
      // Legacy fallback path — happens when the SaaS charge ran via the
      // inline-token flow (no payment_source created server-side yet).
      // Should be 0 occurrences after Fase 7 enforce. Log so ops can see it.
      this.logger.warn(
        `auto-register PM: missing payment_source_id sub=${subscriptionId} payment=${paymentId} ` +
          `(legacy fallback path; should be 0 occurrences after Fase 7 enforce)`,
      );
      return;
    }

    const paymentSourceId = String(rawPsId);

    const paymentMethod = gatewayResponse.payment_method ?? {};
    const extra = paymentMethod.extra ?? {};

    const last4: string | null =
      typeof extra.last_four === 'string'
        ? extra.last_four
        : typeof paymentMethod.last_four === 'string'
          ? paymentMethod.last_four
          : null;

    const brand: string | null = (extra.brand ??
      paymentMethod.brand ??
      null) as string | null;
    const expMonthRaw = extra.exp_month ?? paymentMethod.exp_month ?? null;
    const expYearRaw = extra.exp_year ?? paymentMethod.exp_year ?? null;
    const expiry_month =
      expMonthRaw !== null && expMonthRaw !== undefined
        ? String(expMonthRaw).padStart(2, '0').slice(0, 2)
        : null;
    const expiry_year =
      expYearRaw !== null && expYearRaw !== undefined
        ? String(expYearRaw).slice(0, 4)
        : null;
    const cardHolder: string | null = (extra.name ??
      extra.card_holder ??
      paymentMethod.name ??
      null) as string | null;

    // Idempotency — keyed by (store_id, provider_payment_source_id). Webhook
    // re-delivery (or a widget callback racing with the webhook) hits this
    // branch and is a no-op. The advisory lock used by the manual tokenize
    // path is not needed here: the call site is already inside a
    // subscription_payments transaction.
    const existing = await tx.subscription_payment_methods.findFirst({
      where: {
        store_id: storeId,
        provider_payment_source_id: paymentSourceId,
        state: subscription_payment_method_state_enum.active,
      },
    });

    const nowDate = new Date();

    if (existing) {
      await tx.subscription_payment_methods.update({
        where: { id: existing.id },
        data: { updated_at: nowDate },
      });
      this.logger.log(
        `auto-register PM dedup sub=${subscriptionId} reused pm=${existing.id} psid=${paymentSourceId}`,
      );
      return;
    }

    // First-PM-for-store ⇒ default. Otherwise demote any previous default
    // and promote the freshly-paid card as default — RNC-25 failover relies
    // on `is_default=true` pointing at the most-recently-charged card.
    await tx.subscription_payment_methods.updateMany({
      where: {
        store_id: storeId,
        is_default: true,
        state: subscription_payment_method_state_enum.active,
      },
      data: { is_default: false, updated_at: nowDate },
    });

    const created = await tx.subscription_payment_methods.create({
      data: {
        store_id: storeId,
        store_subscription_id: subscriptionId,
        type: 'card',
        provider: 'wompi',
        // Legacy mirror — readers that still consult provider_token (eg.
        // Fase 5 reusable-PM lookup before Fase 6 swaps to payment_source_id)
        // keep working with the new shape.
        provider_token: paymentSourceId,
        provider_payment_source_id: paymentSourceId,
        acceptance_token_used:
          (gatewayResponse?.acceptance_token as string | undefined) ?? null,
        cof_registered_at: nowDate,
        last4,
        brand,
        expiry_month,
        expiry_year,
        card_holder: cardHolder,
        is_default: true,
        state: subscription_payment_method_state_enum.active,
        metadata: {
          source: 'auto_register_from_payment',
          payment_id: paymentId,
          registered_at: nowDate.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    // Audit row so the timeline reflects "card auto-saved".
    await tx.subscription_events.create({
      data: {
        store_subscription_id: subscriptionId,
        type: 'state_transition',
        payload: {
          reason: 'payment_method_auto_registered',
          payment_method_id: created.id,
          payment_id: paymentId,
          payment_source_id: paymentSourceId,
          last_four: last4,
          brand,
        } as Prisma.InputJsonValue,
        triggered_by_job: 'subscription-payment-service',
      },
    });

    this.logger.log(
      `PAYMENT_METHOD_AUTO_REGISTERED sub=${subscriptionId} pm=${created.id} psid=${paymentSourceId} last4=${last4 ?? 'n/a'} brand=${brand ?? 'unknown'}`,
    );
  }

  private async handleChargeFailure(
    paymentId: number,
    invoiceId: number,
    reason: string,
    tx?: Prisma.TransactionClient,
  ): Promise<subscription_payments> {
    const client = tx ?? this.prisma;

    const updatedPayment = await client.subscription_payments.update({
      where: { id: paymentId },
      data: {
        state: 'failed',
        failure_reason: reason,
        updated_at: new Date(),
      },
    });

    // ADR-2: If there's an active pending change on the subscription, revert it.
    // This clears pending_* fields and transitions the sub back to the state
    // it was in before the change was initiated (pending_revert_state).
    try {
      const subForRevert = await client.store_subscriptions.findFirst({
        where: { pending_change_invoice_id: invoiceId },
        select: {
          id: true,
          store_id: true,
          state: true,
          pending_revert_state: true,
        },
      });

      if (
        subForRevert &&
        subForRevert.state === 'pending_payment' &&
        subForRevert.pending_revert_state
      ) {
        await client.store_subscriptions.update({
          where: { id: subForRevert.id },
          data: {
            pending_plan_id: null,
            pending_change_invoice_id: null,
            pending_change_kind: null,
            pending_change_started_at: null,
            pending_revert_state: null,
            updated_at: new Date(),
          },
        });
        await this.stateService.transitionInTx(
          client as Prisma.TransactionClient,
          subForRevert.store_id,
          subForRevert.pending_revert_state as any,
          {
            reason: `payment_failed_invoice_${invoiceId}`,
            payload: { invoice_id: invoiceId },
          },
        );
      }
    } catch (revertErr: any) {
      this.logger.warn(
        `ADR-2 pending-change revert failed on payment failure invoice=${invoiceId}: ${revertErr?.message ?? revertErr}`,
      );
    }

    // Emit AFTER the write (whether inside external tx or standalone).
    // When called with an external tx, the emit fires before tx commits —
    // this is safe because subscription.payment.failed is best-effort
    // observability. When called standalone (charge() path), emits immediately.
    //
    // RNC-MF-3: `amount` + `entryDate` are added for the platform accounting
    // listener (saas_bad_debt auto-entry). They are strictly additive — the
    // existing SubscriptionStateListener only reads invoiceId/paymentId/
    // subscriptionId/storeId and ignores unknown fields.
    this.eventEmitter.emit('subscription.payment.failed', {
      invoiceId,
      paymentId,
      reason,
      amount: updatedPayment.amount,
      entryDate: new Date(),
    });

    return updatedPayment;
  }

  /**
   * ADR-2 helper — billing cycle duration in days.
   * Mirrors SubscriptionProrationService.billingCycleDays().
   */
  private billingCycleDays(cycle: string): number {
    return Math.ceil(this.billingCycleMs(cycle) / DAY_MS);
  }

  /**
   * RNC-22 helper — billing cycle duration in milliseconds.
   * Mirrors the table in SubscriptionBillingService.billingCycleMs() so the
   * grace-discount path computes the same period length the renewal cron
   * would have used.
   */
  private billingCycleMs(cycle: string): number {
    switch (cycle) {
      case 'monthly':
        return 30 * DAY_MS;
      case 'quarterly':
        return 90 * DAY_MS;
      case 'semiannual':
        return 180 * DAY_MS;
      case 'annual':
        return 365 * DAY_MS;
      case 'lifetime':
        return 100 * 365 * DAY_MS;
      default:
        return 30 * DAY_MS;
    }
  }

  private async handleZeroInvoice(
    invoiceId: number,
    invoice: any,
  ): Promise<subscription_payments> {
    const now = new Date();
    const payment = await this.prisma.subscription_payments.create({
      data: {
        invoice_id: invoiceId,
        state: 'succeeded',
        amount: DECIMAL_ZERO,
        currency: invoice.currency,
        payment_method: 'zero',
        paid_at: now,
        metadata: { zero_price_skip: true } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.prisma.subscription_invoices.update({
      where: { id: invoiceId },
      data: {
        state: 'paid',
        amount_paid: DECIMAL_ZERO,
        updated_at: now,
      },
    });

    return payment;
  }
}
