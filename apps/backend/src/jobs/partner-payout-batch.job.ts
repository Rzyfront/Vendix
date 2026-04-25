import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class PartnerPayoutBatchJob {
  private readonly logger = new Logger(PartnerPayoutBatchJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron('0 4 5 * *')
  async handlePartnerPayoutBatch(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Partner payout batch already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      const now = new Date();
      const periodStart = new Date(
        now.getUTCFullYear(),
        now.getUTCMonth() - 1,
        1,
      );
      const periodEnd = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);

      const partners = await this.prisma.partner_commissions.findMany({
        where: {
          state: 'accrued',
          accrued_at: { gte: periodStart, lt: periodEnd },
        },
        select: { partner_organization_id: true },
        distinct: ['partner_organization_id'],
      });

      if (partners.length === 0) {
        this.logger.log('No partners with accrued commissions for previous month');
        return;
      }

      this.logger.log(
        `Processing payouts for ${partners.length} partners for period ${periodStart.toISOString()} - ${periodEnd.toISOString()}`,
      );

      for (const partner of partners) {
        try {
          await this.processPartnerPayout(
            partner.partner_organization_id,
            periodStart,
            periodEnd,
          );
        } catch (error) {
          this.logger.error(
            `Failed to process payout for partner ${partner.partner_organization_id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Partner payout batch failed: ${error.message}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async processPartnerPayout(
    partnerOrgId: number,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      const commissions = await tx.partner_commissions.findMany({
        where: {
          partner_organization_id: partnerOrgId,
          state: 'accrued',
          accrued_at: { gte: periodStart, lt: periodEnd },
        },
      });

      if (commissions.length === 0) return;

      let totalAmount = new Prisma.Decimal(0);
      for (const c of commissions) {
        totalAmount = totalAmount.plus(c.amount);
      }

      const existingBatch = await tx.partner_payout_batches.findFirst({
        where: {
          partner_organization_id: partnerOrgId,
          period_start: periodStart,
          period_end: periodEnd,
        },
      });

      if (existingBatch) {
        this.logger.log(
          `Payout batch already exists for partner ${partnerOrgId}, skipping`,
        );
        return;
      }

      const batch = await tx.partner_payout_batches.create({
        data: {
          partner_organization_id: partnerOrgId,
          period_start: periodStart,
          period_end: periodEnd,
          total_amount: totalAmount,
          currency: commissions[0].currency,
          state: 'draft',
          payout_method: 'manual',
        },
      });

      await tx.partner_commissions.updateMany({
        where: {
          id: { in: commissions.map((c: any) => c.id) },
        },
        data: {
          payout_batch_id: batch.id,
          state: 'pending_payout',
        },
      });

      this.eventEmitter.emit('partner.commission.available', {
        partnerOrganizationId: partnerOrgId,
        batchId: batch.id,
        totalAmount: totalAmount.toString(),
        currency: commissions[0].currency,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        commissionCount: commissions.length,
      });

      this.logger.log(
        `Created payout batch ${batch.id} for partner ${partnerOrgId}: ${totalAmount.toString()} (${commissions.length} commissions)`,
      );
    });
  }
}
