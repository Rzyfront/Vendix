import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface CommissionAccrualData {
  invoiceId: number;
}

/**
 * Processes commission_accrual_pending outbox rows idempotently.
 *
 * Design:
 * - PK is `invoice_id` — exactly one worker run can succeed per invoice.
 * - The worker uses a Prisma transaction to lock the outbox row, create/update
 *   the partner_commissions record, and mark the outbox as `completed`.
 * - If the commission row already exists (e.g. from a prior run or from the
 *   billing service), the upsert is a no-op and the outbox is still marked
 *   completed.
 * - On unhandled errors, the outbox row is marked `failed` with the error
 *   message so operators can inspect and retry manually.
 */
@Processor('commission-accrual')
export class CommissionAccrualJob extends WorkerHost {
  private readonly logger = new Logger(CommissionAccrualJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly gateConfig: SubscriptionGateConfig,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<CommissionAccrualData>): Promise<{
    success: boolean;
    commissionId?: number;
    skipped?: boolean;
    reason?: string;
  }> {
    const { invoiceId } = job.data;

    this.logger.log(
      `Processing commission accrual for invoice ${invoiceId} (job ${job.id})`,
    );

    const result = await this.prisma.$transaction(
      async (tx: any) => {
        // 1. Lock and read the outbox row.
        const pending = await tx.commission_accrual_pending.findUnique({
          where: { invoice_id: invoiceId },
        });

        if (!pending) {
          this.logger.error({
            msg: 'commission_accrual_outbox_lost',
            invoiceId,
            jobId: job.id,
            description:
              'Outbox row missing before processing — possible manual deletion or data corruption',
          });
          this.eventEmitter.emit('subscription.commission.accrual.lost', {
            invoice_id: invoiceId,
            job_id: job.id,
            detected_at: new Date().toISOString(),
          });
          return { skipped: true, reason: 'outbox_not_found' };
        }

        if (pending.state === 'completed') {
          this.logger.log(
            `Commission accrual already completed for invoice ${invoiceId}`,
          );
          return { skipped: true, reason: 'already_completed' };
        }

        if (pending.state === 'failed' && pending.attempts >= 5) {
          this.logger.warn(
            `Commission accrual permanently failed for invoice ${invoiceId} (max attempts)`,
          );
          return { skipped: true, reason: 'max_attempts_exceeded' };
        }

        // 2. Mark as processing (increments attempt counter).
        await tx.commission_accrual_pending.update({
          where: { invoice_id: invoiceId },
          data: {
            state: 'processing',
            attempts: { increment: 1 },
          },
        });

        // 3. Resolve the invoice to sanity-check partner data.
        const invoice = await tx.subscription_invoices.findUnique({
          where: { id: invoiceId },
        });

        if (!invoice) {
          await tx.commission_accrual_pending.update({
            where: { invoice_id: invoiceId },
            data: {
              state: 'failed',
              error_message: 'Invoice not found',
            },
          });
          return { success: false, reason: 'invoice_not_found' };
        }

        const DECIMAL_ZERO = new Prisma.Decimal(0);
        const partnerShare = new Prisma.Decimal(pending.amount);

        if (partnerShare.greaterThan(DECIMAL_ZERO)) {
          try {
            // Step A: ensure the commission row exists. If a concurrent
            // writer (e.g. billing service) already created it, upsert
            // update branch is a no-op.
            await tx.partner_commissions.upsert({
              where: { invoice_id: invoiceId },
              create: {
                partner_organization_id: pending.partner_organization_id,
                invoice_id: invoiceId,
                amount: partnerShare,
                currency: pending.currency,
                state: 'pending_payout',
                accrued_at: new Date(),
              },
              update: {}, // preserve existing state
            });

            // Step B: promote any pre-existing `accrued` row to
            // `pending_payout`. Idempotent — if already promoted, WHERE
            // clause matches zero rows and this is a no-op.
            await tx.partner_commissions.updateMany({
              where: { invoice_id: invoiceId, state: 'accrued' },
              data: { state: 'pending_payout' },
            });
          } catch (e: any) {
            if (e?.code !== 'P2002') {
              await tx.commission_accrual_pending.update({
                where: { invoice_id: invoiceId },
                data: {
                  state: 'failed',
                  error_message:
                    e?.message ?? 'Unknown error during commission upsert',
                },
              });
              throw e;
            }
            this.logger.warn(
              `Commission upsert hit P2002 for invoice ${invoiceId}; continuing`,
            );
          }
        }

        // 4. Mark outbox as completed (skip in dry-run mode).
        if (this.gateConfig.isCronDryRun()) {
          this.logger.log({
            msg: 'DRY_RUN_SKIP',
            job: 'commission-accrual',
            wouldProcess: {
              invoiceId,
              partnerOrgId: pending.partner_organization_id,
              hasPartnerShare: partnerShare.greaterThan(DECIMAL_ZERO),
            },
          });
          return { skipped: true, reason: 'dry_run' };
        }

        await tx.commission_accrual_pending.update({
          where: { invoice_id: invoiceId },
          data: {
            state: 'completed',
            processed_at: new Date(),
          },
        });

        this.logger.log(
          `Commission accrual completed for invoice ${invoiceId}`,
        );

        return { success: true, commissionId: invoiceId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    if (result.success && !result.skipped) {
      try {
        this.eventEmitter.emit('partner.commission.available', {
          invoiceId,
          source: 'commission_accrual_worker',
        });
      } catch (e: any) {
        this.logger.warn(
          `partner.commission.available emit failed for invoice ${invoiceId}: ${e?.message ?? e}`,
        );
      }
    }

    return result;
  }
}
