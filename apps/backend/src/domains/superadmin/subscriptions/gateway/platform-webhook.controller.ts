import { Body, Controller, Headers, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../common/decorators/public.decorator';
import { SkipSubscriptionGate } from '../../../store/subscriptions/decorators/skip-subscription-gate.decorator';
import { SubscriptionWebhookService } from '../../../store/subscriptions/services/subscription-webhook.service';
import { PlatformWebhookLogService } from './platform-webhook-log.service';
import { PlatformWompiWebhookValidatorService } from './platform-wompi-webhook-validator.service';

/**
 * Endpoint for SaaS-billing Wompi webhooks (platform → store invoices).
 *
 * Strict separation from `POST /store/webhooks/wompi`:
 *  - That endpoint validates with PER-STORE credentials read from
 *    store_payment_methods.custom_config.
 *  - This endpoint validates with PLATFORM credentials from
 *    platform_settings (PlatformGatewayService.getActiveCredentials).
 *  - That endpoint always returns 200 (Wompi retry compliance for store flows).
 *  - This endpoint ALSO always returns 200. Bad references / signatures and
 *    processing errors are ACKed (logged at warn/error) instead of 400.
 *    Rationale: a 400 makes Wompi retry with backoff and, after repeated
 *    failures, can flag the endpoint as unhealthy. Validation failures
 *    (bad signature, `reference_not_saas` misrouting) are permanent — retries
 *    never succeed — so ACKing stops the noise; the operator notices via logs
 *    and reroutes the gateway config. Transient processing errors are healed
 *    by SubscriptionWebhookReconcilerJob + the checkout polling fallback, so
 *    losing the Wompi retry is safe.
 *
 * Operational rollout:
 *  - SAAS_WEBHOOK_ENABLED env flag (default 'true'). When 'false', the
 *    handler ACKs every body without processing — useful while Wompi is
 *    being switched from the legacy reference shape to the new SaaS shape
 *    in production, or while debugging. Logs the skip for observability.
 *
 * ── Bitácora (incidente 17/08/2026) ────────────────────────────────────────
 * Los CUATRO caminos de este handler ACKean, y hasta el 17/08/2026 los cuatro
 * lo hacían sin persistir absolutamente nada: la única huella era el stdout del
 * contenedor. Ese día Wompi aprobó un pago SaaS de $69.900, entregó el webhook,
 * el endpoint respondió 201 `{"received":true}` — y a las 15:57 un despliegue
 * se llevó los logs por delante. La causa raíz del ACK vacío jamás pudo
 * probarse porque no quedaba evidencia que examinar; a las 15:45 un cron anuló
 * la factura de un cliente que sí había pagado.
 *
 * Desde entonces cada camino escribe una fila en `platform_webhook_log` ANTES
 * de tocar el negocio y en su PROPIA conexión (nunca dentro del
 * `$transaction`), porque una evidencia que un rollback puede borrar no es
 * evidencia. Que la bitácora falle nunca tumba el ACK: `PlatformWebhookLogService`
 * se traga sus propios errores y devuelve `null`.
 *
 * El camino que procesa nace PESIMISTA (`outcome='acked_error'`) y sólo se
 * sella a `processed` cuando el negocio confirma. Así, si el proceso muere a
 * mitad —o si el propio sellado falla— la fila queda diciendo la verdad
 * («entró y nunca se supo que saliera») en vez de mentir con un `processed`
 * que nadie llegó a confirmar. Corolario para quien lea la tabla: el `outcome`
 * sólo es definitivo cuando `processed_at IS NOT NULL`.
 */
@Public()
@SkipSubscriptionGate()
@ApiTags('Platform Webhooks')
@Controller('platform/webhooks')
export class PlatformWebhookController {
  private readonly logger = new Logger(PlatformWebhookController.name);

  /**
   * Discriminador de la bitácora. Comparte valor con el `processor` de
   * `webhook_event_dedup` a propósito: cruzar ambas tablas por
   * (processor, transaction_id) es la consulta que reconstruye qué pasó con
   * una transacción concreta.
   */
  private static readonly PROCESSOR = 'wompi_platform';

  constructor(
    private readonly validator: PlatformWompiWebhookValidatorService,
    private readonly subscriptionWebhook: SubscriptionWebhookService,
    private readonly webhookLog: PlatformWebhookLogService,
  ) {}

  @Post('wompi')
  @ApiOperation({
    summary: 'Handle Wompi webhooks for platform-level (SaaS) billing',
  })
  @ApiResponse({
    status: 200,
    description:
      'Always ACKed. Processed when valid; invalid/processing failures are logged and reconciled out-of-band.',
  })
  async handleWompi(
    @Body() body: any,
    @Headers() _headers: Record<string, string>,
  ): Promise<{ received: boolean }> {
    if (!this.isEnabled()) {
      // Log enough context to reconstruct the discarded event later
      // (event type, Wompi reference, amount, transaction id). Wompi
      // does NOT replay events on demand, so when SAAS_WEBHOOK_ENABLED
      // is flipped back on we want to know what we missed and decide
      // if a manual reconciliation is needed.
      const event = body?.event ?? 'unknown';
      const txn = body?.data?.transaction ?? {};
      const reference = txn?.reference ?? null;
      const amountInCents = txn?.amount_in_cents ?? null;
      const transactionId = txn?.id ?? null;
      const status = txn?.status ?? null;
      this.logger.warn(
        `SAAS_WEBHOOK_ENABLED=false — discarded Wompi platform webhook ` +
          `[event=${event} reference=${reference} txn=${transactionId} ` +
          `status=${status} amount_cents=${amountInCents}]`,
      );
      // El camino del flag apagado es el que MÁS necesita fila: es un descarte
      // deliberado y silencioso de un evento que Wompi no volverá a entregar a
      // petición. Se sella `processed_at` de una vez porque aquí no hay negocio
      // posterior que pueda cambiar el desenlace.
      const logId = await this.webhookLog.record({
        processor: PlatformWebhookController.PROCESSOR,
        body,
        outcome: 'acked_disabled',
        // La firma ni se miró: `false` afirmaría algo que no se comprobó.
        signatureValid: null,
        validationReason: 'saas_webhook_disabled',
      });
      await this.webhookLog.finalize(logId, { outcome: 'acked_disabled' });
      return { received: true };
    }

    const result = await this.validator.validate(body);
    if (!result.valid) {
      // ACK with 200 (do NOT 400). Validation failures are permanent — a bad
      // signature or a `reference_not_saas` misroute will fail identically on
      // every Wompi retry, so retrying only adds noise and risks Wompi marking
      // the endpoint unhealthy. The operator notices via this log and reroutes
      // the gateway config to /store/webhooks/wompi when the reference isn't SaaS.
      this.logger.warn(
        `ACK (not processed) platform Wompi webhook: reason=${result.reason ?? 'unknown'}`,
      );
      // Un ACK a un evento que NO se procesó es indistinguible desde fuera de
      // un ACK a un evento que sí. La fila es lo único que los separa después,
      // y `validation_reason` es lo que le dice al operador si tiene que
      // rerutear la pasarela (`reference_not_saas`) o revisar credenciales
      // (`bad_signature`, `no_platform_creds`).
      const logId = await this.webhookLog.record({
        processor: PlatformWebhookController.PROCESSOR,
        body,
        outcome: 'acked_invalid',
        // Sólo `bad_signature` prueba que la firma es inválida. En los demás
        // motivos la validación se abortó antes de comprobarla, y afirmar
        // `false` ahí sería inventar un hallazgo forense.
        signatureValid: result.reason === 'bad_signature' ? false : null,
        validationReason: result.reason ?? 'unknown',
      });
      await this.webhookLog.finalize(logId, { outcome: 'acked_invalid' });
      return { received: true };
    }

    // Firma válida: el evento es genuino. La fila nace ANTES de abrir el
    // negocio y con el outcome pesimista — si `handleWompiEvent` lanza, el
    // rollback no puede tocarla porque vive en otra conexión, y si el proceso
    // muere entero la fila sigue diciendo que el evento llegó.
    const logId = await this.webhookLog.record({
      processor: PlatformWebhookController.PROCESSOR,
      body,
      outcome: 'acked_error',
      signatureValid: true,
    });

    try {
      await this.subscriptionWebhook.handleWompiEvent({
        subscriptionId: result.subscriptionId!,
        invoiceId: result.invoiceId!,
        body,
      });
      await this.webhookLog.finalize(logId, { outcome: 'processed' });
      return { received: true };
    } catch (error: any) {
      this.logger.error(
        `Error processing platform Wompi webhook for invoice ${result.invoiceId}: ${error?.message ?? error}`,
        error?.stack,
      );
      await this.webhookLog.finalize(logId, {
        outcome: 'acked_error',
        errorMessage: this.describeError(error),
      });
      // ACK with 200 even on processing failure. The signature already passed,
      // so the event is genuine; SubscriptionWebhookReconcilerJob + the
      // checkout polling fallback will re-confirm the invoice, making the lost
      // Wompi retry safe and avoiding endpoint-health penalties from repeated 4xx.
      return { received: true };
    }
  }

  /**
   * Mensaje + stack recortado para `error_message`. El stack es lo que el
   * 17/08/2026 habría dicho POR QUÉ el ACK salió vacío, así que se guarda; se
   * recorta a 4000 caracteres para que un stack patológico no convierta la
   * bitácora en el problema.
   */
  private describeError(error: any): string {
    const message = error?.message ?? String(error);
    const stack = typeof error?.stack === 'string' ? `\n${error.stack}` : '';
    return `${message}${stack}`.slice(0, 4000);
  }

  private isEnabled(): boolean {
    const raw = process.env.SAAS_WEBHOOK_ENABLED;
    if (raw === undefined || raw === null || raw === '') return true;
    return raw.toLowerCase() === 'true';
  }
}
