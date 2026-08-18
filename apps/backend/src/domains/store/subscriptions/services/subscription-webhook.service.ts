import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { SubscriptionPaymentService } from './subscription-payment.service';
import { SubscriptionFraudService } from './subscription-fraud.service';
import { SubscriptionStateService } from './subscription-state.service';

/**
 * Wompi transaction.updated payload statuses we care about.
 * Documented at https://docs.wompi.co/docs/colombia/eventos/.
 */
type WompiTransactionStatus = 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';

export interface SubscriptionWebhookInput {
  subscriptionId: number;
  invoiceId: number;
  body: any;
}

/**
 * Routes validated platform Wompi webhooks into the subscription payment
 * state machine. Sits between PlatformWebhookController (HTTP entry) and
 * SubscriptionPaymentService (state-mutation logic).
 *
 * Idempotency invariant: if the most-recent payment row for the invoice is
 * already in a terminal state (succeeded/failed/refunded), the call is a
 * no-op. SubscriptionPaymentService.markPayment*FromWebhook() ALSO short-
 * circuits on terminal states — defense in depth so a redelivered webhook
 * never double-promotes a partner_commission to pending_payout (which would
 * silently inflate the next monthly batch).
 */
@Injectable()
export class SubscriptionWebhookService {
  private readonly logger = new Logger(SubscriptionWebhookService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly paymentService: SubscriptionPaymentService,
    private readonly fraudService: SubscriptionFraudService,
    private readonly stateService: SubscriptionStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * ── RECLAMO + CONFIRMACIÓN ────────────────────────────────────────────────
   *
   * El INSERT en `webhook_event_dedup` era el paso 1 DENTRO de la transacción
   * de negocio. Se cambió porque esa forma tenía un agujero que sólo se ve
   * cuando algo falla: si cualquier paso posterior lanzaba, el rollback
   * borraba la fila de dedup — es decir, borraba **la única evidencia de que
   * el evento había llegado**. El sistema quedaba indistinguible de uno al que
   * el webhook nunca le llegó.
   *
   * Eso es exactamente lo que se vio el 17/08/2026: Wompi aprobó un pago de
   * $69.900, entregó el webhook, el endpoint respondió 201 `{"received":true}`
   * y no quedó ni una fila ni un log. Sin evidencia no se pudo probar la causa
   * raíz, y es la hipótesis que explica que fallaran a la vez el webhook y el
   * reconciliador, ambos sin dejar rastro. A las 15:45 un cron anuló la factura
   * de un cliente que ya había pagado.
   *
   * De ahí las dos mitades:
   *
   *   · El RECLAMO se escribe antes de abrir la transacción y en su propia
   *     conexión, porque la fila tiene que sobrevivir al rollback: es la
   *     evidencia de que el evento existió, no el resultado de haberlo
   *     procesado.
   *   · Y por eso mismo el reclamo SOLO no puede significar «procesado». Un
   *     reclamo sin `processed_at` es un intento que no terminó, y lo correcto
   *     ante un intento que no terminó es REPROCESAR, no descartar. Sólo el
   *     sello `processed_at`, escrito después del commit, convierte el reclamo
   *     en un duplicado descartable.
   *
   * Lo que se cede a cambio, conscientemente: el INSERT dentro de la
   * transacción serializaba dos entregas concurrentes (la segunda esperaba el
   * lock de fila y salía con 0 filas). Fuera de la transacción esa
   * serialización desaparece y dos entregas simultáneas pueden entrar las dos.
   * Es aceptable porque la idempotencia real nunca vivió aquí: vive en
   * `markPayment*FromWebhook`, que cortan en estado terminal
   * (succeeded/failed/refunded) — la defensa en profundidad que esta misma
   * clase ya documenta como invariante para que una reentrega no promueva dos
   * veces una `partner_commission`. Preferimos procesar de más a perder la
   * prueba de que el evento llegó.
   *
   * ── Los otros dos usuarios de `webhook_event_dedup` ──────────────────────
   *
   * Sólo este camino (`processor='wompi_platform'`, `event_type='transaction.
   * updated'`) lee `processed_at`. Los otros dos se revisaron y se dejan con
   * la semántica vieja —«la fila sola ya descarta»— a propósito:
   *
   *   · `handleChargebackEvent` (más abajo, `event_type='chargeback'`): su
   *     trabajo pasa por `fraudService.handleChargeback`, que incrementa
   *     `organizations.chargeback_count`, un contador NO idempotente con un
   *     umbral que bloquea la organización (RNC-30). Reprocesar ahí no es
   *     inocuo: inflaría el contador y podría bloquear a un cliente por un
   *     contracargo que sólo ocurrió una vez. Además su reclamo YA sobrevive
   *     al fallo, porque la tx del dedup se cierra antes de los pasos de
   *     negocio y éstos van en try/catch que no propagan. Sí sella
   *     `processed_at` al terminar, pero como dato de observabilidad: la
   *     decisión de duplicado allí sigue siendo «existe la fila».
   *   · `SubscriptionPaymentService.syncInvoiceFromGateway`
   *     (`processor='wompi_sync'`): ahí el reclamo SÍ debe morir con el
   *     rollback, y por eso no se toca. No es una entrega irrepetible de un
   *     tercero sino un pull que el frontend repite en cada ciclo de polling
   *     mientras la suscripción siga en `pending_payment`; si el intento
   *     falla, lo que hace falta es que la siguiente pasada pueda reintentar,
   *     y el reclamo borrado es justamente lo que se lo permite. No se pierde
   *     evidencia porque nadie «entregó» nada: la transacción sigue estando en
   *     Wompi, consultable. Ese archivo pertenece a otro frente de trabajo y
   *     no se modificó.
   */
  async handleWompiEvent(input: SubscriptionWebhookInput): Promise<void> {
    const { subscriptionId, invoiceId, body } = input;
    const txn = body?.data?.transaction;

    if (!txn) {
      this.logger.warn(
        `Webhook missing transaction body for invoice ${invoiceId} (sub ${subscriptionId})`,
      );
      return;
    }

    // RNC-29 — Chargeback / dispute detection. Wompi signals chargebacks via
    // dedicated event types (`nu.dispute.*`, `chargeback.*`) and/or via
    // `transaction.updated` with a status_message indicating a forced refund.
    // Both shapes route to the fraud service which:
    //   - increments `organizations.chargeback_count`,
    //   - flips the subscription to `suspended` with `lock_reason='chargeback'`,
    //   - reverses the partner_commission for that invoice (ledger row).
    // Event is deduped via the same `webhook_event_dedup` table the
    // transaction.updated path uses, keyed by Wompi event id (or
    // `cb_<txnId>` when the dispute payload re-uses the original transaction id).
    if (this.isChargebackEvent(body, txn)) {
      await this.handleChargebackEvent({
        subscriptionId,
        invoiceId,
        body,
        txn,
      });
      return;
    }

    const dedupTxnId = txn?.id ? String(txn.id) : undefined;
    const txnReference: string | undefined = txn?.reference;
    const txnId: string | undefined = txn?.id ? String(txn.id) : undefined;
    const wompiStatus = (txn.status ?? '').toString().toUpperCase() as
      | WompiTransactionStatus
      | string;

    // Fast-path for statuses that require no writes — no need to open a TX.
    if (wompiStatus === 'PENDING' || wompiStatus === '') {
      this.logger.log(
        `Wompi transaction still pending for invoice ${invoiceId}; ignoring webhook`,
      );
      return;
    }
    if (
      wompiStatus !== 'APPROVED' &&
      wompiStatus !== 'DECLINED' &&
      wompiStatus !== 'ERROR' &&
      wompiStatus !== 'VOIDED'
    ) {
      this.logger.warn(
        `Unhandled Wompi status '${wompiStatus}' for invoice ${invoiceId}`,
      );
      return;
    }

    // ── Paso 1: RECLAMO, fuera de la transacción ─────────────────────────
    //
    // El reclamo es una escritura autónoma, en su propia conexión, ANTES de
    // abrir la transacción de negocio. Ver el bloque «RECLAMO + CONFIRMACIÓN»
    // en la cabecera de handleWompiEvent: la fila es la evidencia de que el
    // evento existió y por eso tiene que sobrevivir al rollback.
    //
    // `duplicate` corta aquí. `retry` NO corta: es un intento previo que no
    // llegó a sellarse, y descartarlo sería repetir el fallo del 17/08/2026 —
    // dar por procesado un evento que nadie procesó.
    if (dedupTxnId) {
      const claim = await this.claimWebhookEvent(
        dedupTxnId,
        'transaction.updated',
      );
      if (claim === 'duplicate') {
        this.logger.log(
          `Duplicate Wompi webhook detected for transaction ${dedupTxnId} (invoice ${invoiceId}), returning 200`,
        );
        return;
      }
      if (claim === 'retry') {
        this.logger.warn(
          `Reprocesando webhook Wompi ${dedupTxnId} (invoice ${invoiceId}): ` +
            `existe reclamo sin sellar, el intento anterior no terminó`,
        );
      }
    }

    // ── Paso 2: proceso de negocio, dentro de una única transacción ──────
    //
    // Todas las escrituras de estado de pago siguen viajando en una sola
    // transacción ReadCommitted: lo que salió de ella es el reclamo, no el
    // negocio.
    //
    // NOTE: eventEmitter.emit calls are intentionally placed OUTSIDE the
    // transaction block so they fire only after the commit succeeds.
    // ──────────────────────────────────────────────────────────────────────
    type TxResult = {
      paymentNotFound: boolean;
      updatedPayment: Awaited<
        ReturnType<typeof this.paymentService.markPaymentSucceededFromWebhook>
      >;
      paymentId: number | null;
    };

    const txResult = await this.prisma.withoutScope().$transaction(
      async (tx) => {
        // Resolve the payment row this webhook refers to.
        //
        // Lookup priority (most specific -> fallback):
        //  1. `gateway_reference` matches `txn.reference`
        //  2. `gateway_reference` matches `txn.id`
        //  3. `metadata->>'reference'` matches `txn.reference`
        //  4. Latest pending row for this invoice
        //  5. Any row for this invoice (absolute last resort)
        let payment: Awaited<
          ReturnType<typeof tx.subscription_payments.findFirst>
        > = null;

        if (txnReference) {
          payment = await tx.subscription_payments.findFirst({
            where: { invoice_id: invoiceId, gateway_reference: txnReference },
            orderBy: { id: 'desc' },
          });
        }

        if (!payment && txnId) {
          payment = await tx.subscription_payments.findFirst({
            where: { invoice_id: invoiceId, gateway_reference: txnId },
            orderBy: { id: 'desc' },
          });
        }

        if (!payment && txnReference) {
          payment = await tx.subscription_payments.findFirst({
            where: {
              invoice_id: invoiceId,
              metadata: { path: ['reference'], equals: txnReference },
            },
            orderBy: { id: 'desc' },
          });
        }

        if (!payment) {
          payment = await tx.subscription_payments.findFirst({
            where: { invoice_id: invoiceId, state: 'pending' },
            orderBy: { id: 'desc' },
          });
        }

        if (!payment) {
          payment = await tx.subscription_payments.findFirst({
            where: { invoice_id: invoiceId },
            orderBy: { id: 'desc' },
          });
        }

        if (!payment) {
          this.logger.warn(
            `No subscription_payments row found for invoice ${invoiceId} (sub ${subscriptionId})`,
          );
          return {
            paymentNotFound: true,
            updatedPayment: null,
            paymentId: null,
          } satisfies TxResult;
        }

        // Mutate payment state — pass `tx` so all writes stay
        // inside THIS transaction (no nested $transaction opened).
        let updatedPayment: Awaited<
          ReturnType<typeof this.paymentService.markPaymentSucceededFromWebhook>
        > = null;

        switch (wompiStatus) {
          case 'APPROVED': {
            updatedPayment =
              await this.paymentService.markPaymentSucceededFromWebhook(
                {
                  paymentId: payment.id,
                  invoiceId,
                  transactionId: txn.id,
                  gatewayResponse: txn,
                },
                tx,
              );
            break;
          }
          case 'DECLINED':
          case 'ERROR': {
            updatedPayment =
              await this.paymentService.markPaymentFailedFromWebhook(
                {
                  paymentId: payment.id,
                  invoiceId,
                  reason: txn.status_message ?? wompiStatus,
                },
                tx,
              );
            break;
          }
          case 'VOIDED': {
            this.logger.log(
              `Wompi VOIDED webhook for invoice ${invoiceId}; mapping to failure`,
            );
            updatedPayment =
              await this.paymentService.markPaymentFailedFromWebhook(
                {
                  paymentId: payment.id,
                  invoiceId,
                  reason: 'voided',
                },
                tx,
              );
            break;
          }
        }

        return {
          paymentNotFound: false,
          updatedPayment,
          paymentId: payment.id,
        } satisfies TxResult;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    // ── Post-commit side effects ──────────────────────────────────────────
    // All side effects below run AFTER the transaction commits so they always
    // observe the committed state and are not executed on rollback.
    if (txResult.paymentNotFound) {
      // Deliberadamente SIN sellar. «No encontré a qué pago aplicarlo» no es
      // un negocio terminado: es un evento que quedó sin aplicar. Dejar el
      // reclamo abierto permite que una reentrega de Wompi —o el
      // reconciliador, una vez exista la fila de pago— lo vuelva a intentar,
      // en vez de enterrarlo como duplicado para siempre.
      return;
    }

    // ── Paso 3: CONFIRMACIÓN ─────────────────────────────────────────────
    // La transacción commiteó, así que el evento sí quedó aplicado: recién
    // ahora el reclamo pasa a significar «procesado». Va aquí y no dentro de
    // la tx precisamente para que un rollback no se lo lleve.
    if (dedupTxnId) {
      await this.sealWebhookEvent(dedupTxnId, invoiceId);
    }

    if (
      wompiStatus === 'APPROVED' &&
      txResult.updatedPayment?.state === 'succeeded'
    ) {
      // Enqueue the commission-accrual BullMQ job post-commit.
      // The outbox row (commission_accrual_pending) was inserted inside the tx;
      // the job will process it asynchronously.
      await this.paymentService.enqueueCommissionAccrualPostCommit(invoiceId);

      // Best-effort observability event. The internal accrual->pending_payout
      // transition lives inside SubscriptionPaymentService.handleChargeSuccess
      // and ran inside the tx above; this is just a notification hook.
      this.eventEmitter.emit('subscription.payment.succeeded', {
        invoiceId,
        paymentId: txResult.paymentId,
        subscriptionId,
        source: 'webhook',
      });
    }
  }

  /**
   * Reclama el evento en `webhook_event_dedup` SIN abrir transacción de
   * negocio, y responde qué hacer con él:
   *
   *   · `fresh`     — no existía: primera vez que se ve este evento.
   *   · `retry`     — existe con `processed_at` NULL: alguien lo reclamó y no
   *                   llegó a sellarlo. Se reprocesa.
   *   · `duplicate` — existe con `processed_at` puesto: llegó y terminó.
   *
   * El INSERT y la lectura van en un único statement (CTE) para no necesitar
   * dos viajes ni una transacción: si el INSERT prospera, la rama del UNION se
   * apaga sola por el `NOT EXISTS (SELECT 1 FROM claim)`; si choca contra el
   * único (processor, event_id), `claim` queda vacío y se devuelve la fila que
   * ya estaba.
   *
   * Casos límite, ambos resueltos hacia REPROCESAR, que es el lado seguro
   * dado que `markPayment*FromWebhook` cortan en estado terminal:
   *   · Cero filas (una entrega concurrente insertó después de nuestro
   *     snapshot y antes de nuestro SELECT).
   *   · Fallo de la consulta: no se puede decidir «duplicado» sin dato, y
   *     tragarse un evento genuino por un error de infraestructura es
   *     precisamente el fallo que este cambio persigue.
   */
  private async claimWebhookEvent(
    eventId: string,
    eventType: string,
  ): Promise<'fresh' | 'retry' | 'duplicate'> {
    try {
      const rows = await this.prisma.withoutScope().$queryRaw<
        Array<{ processed_at: Date | null; claimed: boolean }>
      >(
        Prisma.sql`
          WITH claim AS (
            INSERT INTO webhook_event_dedup (processor, event_id, event_type, received_at)
            VALUES ('wompi_platform', ${eventId}, ${eventType}, NOW())
            ON CONFLICT (processor, event_id) DO NOTHING
            RETURNING processed_at
          )
          SELECT processed_at, TRUE AS claimed FROM claim
          UNION ALL
          SELECT d.processed_at, FALSE AS claimed
            FROM webhook_event_dedup d
           WHERE d.processor = 'wompi_platform'
             AND d.event_id = ${eventId}
             AND NOT EXISTS (SELECT 1 FROM claim)
        `,
      );

      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) return 'retry';
      if (row.claimed) return 'fresh';
      return row.processed_at ? 'duplicate' : 'retry';
    } catch (error: any) {
      this.logger.error(
        `Fallo al reclamar el evento Wompi ${eventId} en webhook_event_dedup; ` +
          `se procesa igual para no perderlo: ${error?.message ?? error}`,
        error?.stack,
      );
      return 'retry';
    }
  }

  /**
   * Sella el reclamo: a partir de aquí el evento cuenta como duplicado.
   *
   * El `WHERE ... processed_at IS NULL` mantiene el primer sello como el
   * bueno y hace el UPDATE idempotente. Si el sellado falla no se propaga: el
   * negocio YA commiteó, así que lo peor que pasa es que una reentrega vuelva
   * a entrar y se corte contra el estado terminal del pago. Tumbar el turno
   * aquí sería peor que un reproceso inocuo.
   */
  private async sealWebhookEvent(
    eventId: string,
    invoiceId: number,
  ): Promise<void> {
    try {
      await this.prisma.withoutScope().$executeRaw(
        Prisma.sql`
          UPDATE webhook_event_dedup
             SET processed_at = NOW()
           WHERE processor = 'wompi_platform'
             AND event_id = ${eventId}
             AND processed_at IS NULL
        `,
      );
    } catch (error: any) {
      this.logger.warn(
        `No se pudo sellar processed_at del evento ${eventId} ` +
          `(invoice ${invoiceId}); una reentrega se reprocesará y cortará ` +
          `contra el estado terminal del pago: ${error?.message ?? error}`,
      );
    }
  }

  /**
   * RNC-29 — Detect chargeback / dispute / forced-refund webhook bodies.
   *
   * Wompi shapes we accept:
   *   - body.event starts with `nu.dispute.`, `dispute.`, or `chargeback.`
   *   - body.event === 'transaction.updated' AND status is REFUNDED/VOIDED
   *     AND status_message contains 'chargeback' or 'dispute' (case-insensitive)
   *
   * The signal must be unambiguous — voluntary refunds DO NOT enter this
   * branch. Per RNC-11 Vendix never issues voluntary refunds; any refund
   * arriving here is bank-forced (a real chargeback) and must be treated as
   * one.
   */
  private isChargebackEvent(body: any, txn: any): boolean {
    const eventName = (body?.event ?? '').toString().toLowerCase();
    if (
      eventName.startsWith('nu.dispute.') ||
      eventName.startsWith('dispute.') ||
      eventName.startsWith('chargeback.')
    ) {
      return true;
    }

    // Fallback path: `transaction.updated` carrying a chargeback hint.
    const statusMessage = (txn?.status_message ?? '').toString().toLowerCase();
    if (
      eventName === 'transaction.updated' &&
      (statusMessage.includes('chargeback') ||
        statusMessage.includes('dispute') ||
        statusMessage.includes('contracargo'))
    ) {
      return true;
    }

    return false;
  }

  /**
   * RNC-29 — Process a chargeback webhook. Idempotent via `webhook_event_dedup`
   * keyed on the Wompi event id (or a derived id for dispute payloads that
   * re-reference the original transaction). All writes happen inside a single
   * ReadCommitted transaction; the post-commit emit is best-effort.
   */
  private async handleChargebackEvent(args: {
    subscriptionId: number;
    invoiceId: number;
    body: any;
    txn: any;
  }): Promise<void> {
    const { subscriptionId, invoiceId, body, txn } = args;

    // Stable dedup id. Prefer the dispute envelope id; fall back to the
    // transaction id with a `cb_` prefix so a regular `transaction.updated`
    // and its chargeback don't collide on the same dedup key.
    const eventEnvelopeId =
      body?.id ??
      body?.data?.id ??
      body?.data?.dispute?.id ??
      (txn?.id ? `cb_${txn.id}` : undefined);

    const dedupKey = eventEnvelopeId ? String(eventEnvelopeId) : undefined;

    // Resolve the subscription -> store -> organization needed by the fraud
    // service. Read outside the tx because it is a read-only lookup; the
    // critical writes (dedup insert + fraud-service writes) happen inside.
    const sub = await this.prisma
      .withoutScope()
      .store_subscriptions.findUnique({
        where: { id: subscriptionId },
        select: {
          id: true,
          store_id: true,
          state: true,
          store: { select: { organization_id: true } },
        },
      });

    if (!sub || !sub.store) {
      this.logger.warn(
        `Chargeback webhook for unknown subscription ${subscriptionId} (invoice ${invoiceId})`,
      );
      return;
    }

    const organizationId = sub.store.organization_id;

    // Idempotent dedup INSERT inside a transaction so concurrent redeliveries
    // serialize on (processor, event_id).
    //
    // DECISIÓN — este camino NO adopta el reclamo+confirmación de
    // `handleWompiEvent`, y no es un olvido:
    //
    //   1. Aquí «existe la fila» sigue significando duplicado. Un
    //      `processed_at` NULL NO habilita reproceso, porque el trabajo de
    //      abajo pasa por `fraudService.handleChargeback`, que incrementa
    //      `organizations.chargeback_count` — un contador no idempotente con
    //      umbral de bloqueo (RNC-30). Reprocesar inflaría el contador y
    //      podría bloquear a un cliente por un contracargo que ocurrió una
    //      sola vez. Aquí perder un reintento es más barato que duplicar un
    //      castigo.
    //   2. No hace falta sacar el INSERT de la transacción: esta tx sólo
    //      contiene el INSERT y commitea ANTES de los pasos de negocio, que
    //      además van en try/catch que no propagan. El reclamo ya sobrevive a
    //      cualquier fallo posterior — que es la propiedad que faltaba en
    //      `handleWompiEvent`.
    //
    // Lo que sí se adopta es el sello final, pero como observabilidad: al
    // cerrar se escribe `processed_at` para poder distinguir en la base un
    // contracargo que llegó y terminó de uno que llegó y murió a mitad. La
    // decisión de duplicado de arriba no lo lee.
    const dedupResult = await this.prisma.withoutScope().$transaction(
      async (tx) => {
        if (dedupKey) {
          const inserted = await tx.$executeRaw<number>(
            Prisma.sql`
                INSERT INTO webhook_event_dedup (processor, event_id, event_type, received_at)
                VALUES ('wompi_platform', ${dedupKey}, 'chargeback', NOW())
                ON CONFLICT (processor, event_id) DO NOTHING
              `,
          );
          if (inserted === 0) {
            return { duplicate: true };
          }
        }
        return { duplicate: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    if (dedupResult.duplicate) {
      this.logger.log(
        `Duplicate chargeback webhook detected for invoice ${invoiceId} (event ${dedupKey}); skipping`,
      );
      return;
    }

    // Suspend the subscription with lock_reason='chargeback'. Done in a short
    // tx so the fraud-service writes (counter bump + event row) and the state
    // transition share a consistent committed view.
    try {
      if (sub.state !== 'suspended' && sub.state !== 'cancelled') {
        await this.stateService.transition(sub.store_id, 'suspended', {
          reason: 'chargeback',
          // `reason` above is audit payload only (it lands in
          // `subscription_events.payload.reason`). `lockReason` is what gets
          // persisted to `store_subscriptions.lock_reason` — the column the
          // access gate reads to tell the customer WHY its store is degraded.
          // Omitting it made the column fall back to the `'admin_manual'`
          // default for suspensions, so a real chargeback was reported to the
          // customer as a manual admin action. Both are required.
          lockReason: 'chargeback',
          triggeredByJob: 'webhook',
          payload: {
            invoice_id: invoiceId,
            subscription_id: subscriptionId,
            wompi_event: body?.event ?? 'unknown',
            wompi_txn_id: txn?.id ?? null,
            source: 'chargeback_webhook',
          },
        });
      }
    } catch (e: any) {
      // Do not abort: chargeback bookkeeping must still run. The cron
      // reconciler will re-attempt the suspension on the next sweep.
      this.logger.warn(
        `Failed to transition sub ${subscriptionId} to suspended on chargeback: ${e?.message ?? e}`,
      );
    }

    // Bump organization-level chargeback counter + log subscription_event
    // (org block at threshold per RNC-30 happens inside fraudService).
    try {
      const txnAmount =
        typeof txn?.amount_in_cents === 'number'
          ? new Prisma.Decimal(txn.amount_in_cents).dividedBy(100)
          : undefined;
      const reason =
        (txn?.status_message as string | undefined) ??
        (body?.event as string | undefined) ??
        'wompi_chargeback';

      await this.fraudService.handleChargeback(organizationId, {
        storeId: sub.store_id,
        invoiceId,
        chargebackReason: reason,
        chargebackAmount: txnAmount,
      });
    } catch (e: any) {
      // Surface in logs; the dedup row already prevents replay so a manual
      // retry path is safe.
      this.logger.error(
        `fraudService.handleChargeback failed for org ${organizationId} ` +
          `(invoice ${invoiceId}): ${e?.message ?? e}`,
      );
    }

    // Post-commit emit — listeners (commission reversal, super-admin notif)
    // pick up from here. Wrapped because emit() is synchronous but listener
    // errors must not propagate to the webhook controller.
    try {
      this.eventEmitter.emit('subscription.chargeback.received', {
        organizationId,
        storeId: sub.store_id,
        subscriptionId,
        invoiceId,
        wompiEvent: body?.event ?? 'unknown',
        wompiTxnId: txn?.id ?? null,
      });
    } catch (e: any) {
      this.logger.warn(
        `subscription.chargeback.received emit failed for invoice ${invoiceId}: ${e?.message ?? e}`,
      );
    }

    // Sello de observabilidad, no de semántica (ver la DECISIÓN del bloque de
    // dedup): permite leer en la base qué contracargos cerraron su turno y
    // cuáles se quedaron a mitad. El descarte por duplicado de este camino
    // sigue decidiéndose por la mera existencia de la fila.
    if (dedupKey) {
      await this.sealWebhookEvent(dedupKey, invoiceId);
    }
  }
}
