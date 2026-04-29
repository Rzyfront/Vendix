import { Injectable, Logger } from '@nestjs/common';
import { WompiClientFactory } from '../../../store/payments/processors/wompi/wompi.factory';
import {
  WompiConfig,
  WompiEnvironment,
  WompiWebhookEvent,
} from '../../../store/payments/processors/wompi/wompi.types';
import {
  PlatformGatewayService,
  DecryptedCreds,
} from './platform-gateway.service';
import { PlatformGatewayEnvironmentEnum } from './dto/upsert-gateway.dto';

export type PlatformWompiValidationReason =
  | 'no_reference'
  | 'reference_not_saas'
  | 'no_platform_creds'
  | 'bad_signature'
  | 'validation_error';

export interface PlatformWompiValidationResult {
  valid: boolean;
  subscriptionId?: number;
  invoiceId?: number;
  reason?: PlatformWompiValidationReason;
}

/**
 * Validates Wompi webhooks targeting platform-level (SaaS) charges.
 *
 * Differs from the per-store WompiWebhookValidatorService in two important
 * ways:
 *  1. Reads the reference as `vendix_saas_{subscriptionId}_{invoiceId}_{ts}`
 *     instead of `vendix_{storeId}_{orderId}_{ts}`. A reference that doesn't
 *     match the SaaS shape returns `reason: 'reference_not_saas'` so the
 *     caller can return 4xx instead of silently swallowing eCommerce traffic
 *     that was misrouted.
 *  2. Loads credentials from PlatformGatewayService (platform_settings),
 *     NOT from store_payment_methods.custom_config. The store does not own
 *     the gateway used to charge its own SaaS invoice — Vendix does.
 *
 * NOTE: WompiClient is a singleton with a mutable `configure()`. The
 * mitigation followed everywhere in the codebase (see
 * SubscriptionPaymentService.toProcessorWompiConfig and
 * WompiWebhookValidatorService.validate) is to call `configure()` immediately
 * before any usage. Same pattern here. If concurrent webhook delivery becomes
 * a real risk, promote WompiClient to Scope.REQUEST.
 */
@Injectable()
export class PlatformWompiWebhookValidatorService {
  private readonly logger = new Logger(
    PlatformWompiWebhookValidatorService.name,
  );

  // Match `vendix_saas_{subId}_{invoiceId}_{ts}`. The regex is anchored on
  // both sides so the eCommerce reference (`vendix_{storeId}_...`) doesn't
  // accidentally match.
  private static readonly REFERENCE_REGEX = /^vendix_saas_(\d+)_(\d+)_\d+$/;

  constructor(
    private readonly platformGw: PlatformGatewayService,
    private readonly wompiClientFactory: WompiClientFactory,
  ) {}

  async validate(body: any): Promise<PlatformWompiValidationResult> {
    try {
      const reference: string | undefined = body?.data?.transaction?.reference;
      if (!reference || typeof reference !== 'string') {
        this.logger.warn(
          'Platform Wompi webhook missing transaction reference',
        );
        return { valid: false, reason: 'no_reference' };
      }

      const match = reference.match(
        PlatformWompiWebhookValidatorService.REFERENCE_REGEX,
      );
      if (!match) {
        // Likely an eCommerce/POS webhook misrouted to the platform endpoint.
        // Caller should return 4xx so the operator notices the misconfig.
        this.logger.warn(
          `Platform Wompi webhook reference is not SaaS-shaped: ${reference}`,
        );
        return { valid: false, reason: 'reference_not_saas' };
      }

      const subscriptionId = parseInt(match[1], 10);
      const invoiceId = parseInt(match[2], 10);
      if (!Number.isFinite(subscriptionId) || !Number.isFinite(invoiceId)) {
        return { valid: false, reason: 'reference_not_saas' };
      }

      const creds = await this.platformGw.getActiveCredentials('wompi');
      if (!creds) {
        this.logger.warn(
          `Platform Wompi webhook arrived but no active credentials configured ` +
            `(subscriptionId=${subscriptionId}, invoiceId=${invoiceId})`,
        );
        return { valid: false, reason: 'no_platform_creds' };
      }

      const wompiConfig = this.toWompiConfig(creds);
      const client = this.wompiClientFactory.getClient(
        'platform-webhook',
        wompiConfig,
      );

      const isValid = client.validateWebhookSignature(
        body as WompiWebhookEvent,
      );

      if (!isValid) {
        this.logger.warn(
          `Platform Wompi webhook signature INVALID ` +
            `(subscriptionId=${subscriptionId}, invoiceId=${invoiceId})`,
        );
        return { valid: false, reason: 'bad_signature' };
      }

      this.logger.log(
        `Platform Wompi webhook validated (subscriptionId=${subscriptionId}, invoiceId=${invoiceId})`,
      );
      return { valid: true, subscriptionId, invoiceId };
    } catch (error: any) {
      this.logger.error(
        `Platform Wompi webhook validation error: ${error?.message ?? error}`,
        error?.stack,
      );
      return { valid: false, reason: 'validation_error' };
    }
  }

  private toWompiConfig(creds: DecryptedCreds): WompiConfig {
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
}
