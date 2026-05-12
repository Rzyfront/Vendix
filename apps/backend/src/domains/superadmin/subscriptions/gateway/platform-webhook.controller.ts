import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Logger,
  Post,
} from '@nestjs/common';
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
 *  - This endpoint returns 400 on bad references / signatures so the
 *    operator notices misrouting; Wompi will still retry (which is desired
 *    for transient validation issues).
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
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 400, description: 'Invalid signature or reference' })
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
      this.logger.warn(
        `Rejecting platform Wompi webhook: reason=${result.reason ?? 'unknown'}`,
      );
      // 400 — Wompi will retry with backoff. For 'reference_not_saas' the
      // operator should reroute the gateway config to /store/webhooks/wompi.
      throw new BadRequestException({
        received: false,
        reason: result.reason ?? 'unknown',
      });
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
      // Surface a 4xx so Wompi retries; the validator already passed so
      // the next retry has a chance of succeeding once the underlying issue
      // (e.g. transient DB error) is resolved.
      throw new BadRequestException({
        received: false,
        reason: 'processing_error',
      });
    }
  }

  private isEnabled(): boolean {
    const raw = process.env.SAAS_WEBHOOK_ENABLED;
    if (raw === undefined || raw === null || raw === '') return true;
    return raw.toLowerCase() === 'true';
  }
}
