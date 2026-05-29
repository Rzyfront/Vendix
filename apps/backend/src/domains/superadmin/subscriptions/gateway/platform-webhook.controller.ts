import { Body, Controller, Headers, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../common/decorators/public.decorator';
import { SkipSubscriptionGate } from '../../../store/subscriptions/decorators/skip-subscription-gate.decorator';
import { SubscriptionWebhookService } from '../../../store/subscriptions/services/subscription-webhook.service';
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
 */
@Public()
@SkipSubscriptionGate()
@ApiTags('Platform Webhooks')
@Controller('platform/webhooks')
export class PlatformWebhookController {
  private readonly logger = new Logger(PlatformWebhookController.name);

  constructor(
    private readonly validator: PlatformWompiWebhookValidatorService,
    private readonly subscriptionWebhook: SubscriptionWebhookService,
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
      return { received: true };
    }

    try {
      await this.subscriptionWebhook.handleWompiEvent({
        subscriptionId: result.subscriptionId!,
        invoiceId: result.invoiceId!,
        body,
      });
      return { received: true };
    } catch (error: any) {
      this.logger.error(
        `Error processing platform Wompi webhook for invoice ${result.invoiceId}: ${error?.message ?? error}`,
        error?.stack,
      );
      // ACK with 200 even on processing failure. The signature already passed,
      // so the event is genuine; SubscriptionWebhookReconcilerJob + the
      // checkout polling fallback will re-confirm the invoice, making the lost
      // Wompi retry safe and avoiding endpoint-health penalties from repeated 4xx.
      return { received: true };
    }
  }

  private isEnabled(): boolean {
    const raw = process.env.SAAS_WEBHOOK_ENABLED;
    if (raw === undefined || raw === null || raw === '') return true;
    return raw.toLowerCase() === 'true';
  }
}
