import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

const FRAUD_THRESHOLD = 2;

@Injectable()
export class SubscriptionFraudService {
  private readonly logger = new Logger(SubscriptionFraudService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handleChargeback(
    organizationId: number,
    opts: {
      storeId: number;
      invoiceId: number;
      chargebackReason?: string;
      chargebackAmount?: Prisma.Decimal;
    },
  ): Promise<void> {
    const now = new Date();

    // Resolve the subscription id from store_id so the
    // `chargeback_received` event row is keyed against the SUBSCRIPTION
    // (the FK target), not the store id (was a bug — they happen to agree
    // when ids align but FKs would fail otherwise).
    const subscription = await this.prisma
      .withoutScope()
      .store_subscriptions.findUnique({
        where: { store_id: opts.storeId },
        select: { id: true },
      });

    const txResult = await this.prisma.$transaction(async (tx: any) => {
      const org = await tx.organizations.findUnique({
        where: { id: organizationId },
        select: { id: true, chargeback_count: true, fraud_blocked: true },
      });
      if (!org) {
        return { newCount: 0, isFraudBlocked: false, found: false };
      }

      const newCount = (org.chargeback_count ?? 0) + 1;
      const isFraudBlocked = newCount >= FRAUD_THRESHOLD;

      await tx.organizations.update({
        where: { id: organizationId },
        data: {
          chargeback_count: newCount,
          fraud_blocked: isFraudBlocked ? true : undefined,
          fraud_blocked_at: isFraudBlocked ? now : undefined,
          fraud_blocked_reason: isFraudBlocked
            ? `Auto-blocked after ${newCount} chargebacks`
            : undefined,
          updated_at: now,
        },
      });

      if (subscription) {
        await tx.subscription_events.create({
          data: {
            store_subscription_id: subscription.id,
            type: 'chargeback_received',
            payload: {
              organization_id: organizationId,
              invoice_id: opts.invoiceId,
              store_id: opts.storeId,
              chargeback_reason: opts.chargebackReason ?? null,
              chargeback_amount: opts.chargebackAmount?.toFixed(2) ?? null,
              chargeback_count: newCount,
              fraud_blocked: isFraudBlocked,
            } as Prisma.InputJsonValue,
          },
        });
      }

      return { newCount, isFraudBlocked, found: true };
    });

    if (!txResult.found) {
      this.logger.warn(
        `handleChargeback called for unknown organization ${organizationId} (invoice ${opts.invoiceId})`,
      );
      return;
    }

    this.logger.warn(
      `Chargeback recorded for org ${organizationId} (count=${txResult.newCount}, fraud_blocked=${txResult.isFraudBlocked})`,
    );

    this.eventEmitter.emit('chargeback.recorded', {
      organizationId,
      storeId: opts.storeId,
      invoiceId: opts.invoiceId,
      chargebackCount: txResult.newCount,
      fraudBlocked: txResult.isFraudBlocked,
    });
  }
}
