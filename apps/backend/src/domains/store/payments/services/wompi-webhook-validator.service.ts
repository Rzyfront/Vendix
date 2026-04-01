import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WompiClient } from '../processors/wompi/wompi.client';
import { PaymentEncryptionService } from './payment-encryption.service';
import {
  WompiWebhookEvent,
  WompiEnvironment,
} from '../processors/wompi/wompi.types';

@Injectable()
export class WompiWebhookValidatorService {
  private readonly logger = new Logger(WompiWebhookValidatorService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly wompiClient: WompiClient,
    private readonly encryptionService: PaymentEncryptionService,
  ) {}

  /**
   * Extract storeId from a Vendix payment reference.
   * Expected format: vendix_{storeId}_{orderId}_{timestamp}
   */
  extractStoreIdFromReference(reference: string): number | null {
    try {
      const parts = reference.split('_');
      if (parts.length < 3 || parts[0] !== 'vendix') return null;
      const storeId = parseInt(parts[1], 10);
      return isNaN(storeId) ? null : storeId;
    } catch {
      return null;
    }
  }

  /**
   * Validate a Wompi webhook event by:
   * 1. Extracting storeId from the transaction reference
   * 2. Looking up the store's Wompi credentials (unscoped)
   * 3. Decrypting the events_secret
   * 4. Verifying the webhook signature using WompiClient
   */
  async validate(
    body: any,
  ): Promise<{ valid: boolean; storeId: number | null }> {
    try {
      const reference = body?.data?.transaction?.reference;
      if (!reference) {
        this.logger.warn('Wompi webhook missing transaction reference');
        return { valid: false, storeId: null };
      }

      const storeId = this.extractStoreIdFromReference(reference);
      if (!storeId) {
        this.logger.warn(
          `Could not extract storeId from reference: ${reference}`,
        );
        return { valid: false, storeId: null };
      }

      // Unscoped query — webhooks arrive without tenant context
      const baseClient = this.prisma.withoutScope();
      const storePaymentMethod =
        await (baseClient as any).store_payment_methods.findFirst({
          where: {
            store_id: storeId,
            state: 'enabled',
            system_payment_method: { type: 'wompi' },
          },
          include: { system_payment_method: true },
        });

      if (!storePaymentMethod?.custom_config) {
        this.logger.warn(`No Wompi config found for store ${storeId}`);
        return { valid: false, storeId };
      }

      // Decrypt sensitive fields (events_secret, private_key, etc.)
      const rawConfig = storePaymentMethod.custom_config as Record<
        string,
        any
      >;
      const config = this.encryptionService.decryptConfig(rawConfig, 'wompi');

      const eventsSecret = config.events_secret;
      if (!eventsSecret) {
        this.logger.warn(
          `No events_secret in Wompi config for store ${storeId}`,
        );
        return { valid: false, storeId };
      }

      // Configure client with the store's decrypted credentials
      this.wompiClient.configure({
        public_key: config.public_key || '',
        private_key: config.private_key || '',
        events_secret: eventsSecret,
        integrity_secret: config.integrity_secret || '',
        environment:
          (config.environment as WompiEnvironment) || WompiEnvironment.SANDBOX,
      });

      const isValid = this.wompiClient.validateWebhookSignature(
        body as WompiWebhookEvent,
      );
      this.logger.log(
        `Webhook signature validation for store ${storeId}: ${isValid ? 'PASSED' : 'FAILED'}`,
      );

      return { valid: isValid, storeId };
    } catch (error) {
      this.logger.error(`Webhook validation error: ${error.message}`);
      return { valid: false, storeId: null };
    }
  }
}
