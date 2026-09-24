import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalGateService } from '../../../../common/services/fiscal-gate.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { AutoEntryService } from './auto-entry.service';
import { AccountingEntryFailureService } from './accounting-entry-failure.service';
import { buildManualRefundFiscalPayload } from './manual-refund-accounting.util';

export const MANUAL_REFUND_DELIVERY_KEY = 'manual_refund_delivery_v1';
export const MANUAL_REFUND_DELIVERY_SOURCE = 'manual_refund.delivery';

export interface ManualRefundDeliveryPayload {
  version: 1;
  refund_id: number;
  order_id: number;
  store_id: number;
  organization_id: number;
  user_id: number;
  payout_channel: 'cash' | 'bank_transfer' | 'store_credit' | 'gateway';
  prior_refund_ids: number[];
}

/** A semantic outbox on the existing unresolved-accounting table. */
@Injectable()
export class ManualRefundDeliveryService {
  private readonly logger = new Logger(ManualRefundDeliveryService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly autoEntry: AutoEntryService,
    private readonly failures: AccountingEntryFailureService,
    private readonly fiscalGate: FiscalGateService,
  ) {}

  /** Re-enqueue stranded rows after a crash between the business commit and dispatch. */
  @Interval(60_000)
  async enqueueStranded(): Promise<void> {
    const rows = await this.prisma.withoutScope().accounting_entry_failures.findMany({
      where: { handler_key: MANUAL_REFUND_DELIVERY_KEY, resolved_at: null,
        attempt_count: { lte: 2 },
        NOT: { error_message: { startsWith: 'SKIPPED' } } },
      select: { id: true }, take: 50, orderBy: { created_at: 'asc' },
    });
    for (const row of rows) {
      try { await this.enqueue(row.id); }
      catch (error) { this.logger.error(`Could not enqueue refund delivery #${row.id}: ${error}`); }
    }
  }

  async enqueue(failureId: number): Promise<void> {
    await this.failures.enqueueRetry(failureId);
  }

  async deliver(failureId: number): Promise<void> {
    try {
      await this.prisma.withoutScope().$transaction(async (tx) => {
        // PostgreSQL row lock serializes queue, manual retry, and request dispatch.
        // Journal creation and resolved_at share this transaction: no false ack.
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM accounting_entry_failures WHERE id = ${failureId} FOR UPDATE`;
        if (locked.length !== 1) return;
        const row = await tx.accounting_entry_failures.findFirst({
          where: { id: failureId, handler_key: MANUAL_REFUND_DELIVERY_KEY },
        });
        if (!row || row.resolved_at) return;
        const payload = row.event_payload as unknown as ManualRefundDeliveryPayload;
        if (payload.version !== 1 || payload.refund_id !== row.source_id ||
            payload.organization_id !== row.organization_id || payload.store_id !== row.store_id ||
            payload.prior_refund_ids.some((id) => !Number.isInteger(id) || id === payload.refund_id)) {
          throw new Error(`Invalid semantic refund delivery #${failureId}`);
        }
        const order = await tx.orders.findFirst({
          where: { id: payload.order_id, store_id: payload.store_id,
            stores: { organization_id: payload.organization_id } },
          select: {
            grand_total: true, tip_amount: true, tax_amount: true, shipping_cost: true,
            shipping_tax_amount: true, shipping_tax_type: true,
            order_items: { select: { order_item_taxes: {
              select: { tax_type: true, tax_amount: true },
            } } },
          },
        });
        const refundSelect = {
          id: true, amount: true, subtotal_refund: true, tax_refund: true, shipping_refund: true, notes: true,
          refund_items: { select: { tax_amount: true, order_items: {
            select: { order_item_taxes: { select: { tax_type: true, tax_amount: true } } },
          } } },
        } as const;
        const refund = await tx.refunds.findFirst({
          where: { id: payload.refund_id, order_id: payload.order_id, state: 'completed' },
          select: refundSelect,
        });
        if (!order || !refund) throw new Error(`Refund #${payload.refund_id} is not a completed in-scope refund`);
        const prior = payload.prior_refund_ids.length
          ? await tx.refunds.findMany({
              where: { id: { in: payload.prior_refund_ids }, order_id: payload.order_id, state: 'completed' },
              select: refundSelect,
            }) : [];
        if (prior.length !== payload.prior_refund_ids.length) {
          throw new Error(`Refund #${payload.refund_id} prior snapshot is incomplete`);
        }
        const fiscal = buildManualRefundFiscalPayload(order, refund, prior);
        if (!(await this.fiscalGate.isSubflowEnabled(payload.organization_id, payload.store_id, 'returns'))) {
          await tx.accounting_entry_failures.update({ where: { id: failureId },
            data: { error_message: 'SKIPPED_FLOW_DISABLED: returns accounting subflow is inactive' } });
          return;
        }
        const entry = await RequestContextService.run({
          is_super_admin: false, is_owner: false, store_id: payload.store_id,
          organization_id: payload.organization_id, user_id: payload.user_id,
          request_id: `manual-refund-delivery-${failureId}`,
        }, () => this.autoEntry.onRefundCompleted({
          refund_id: payload.refund_id,
          order_id: payload.order_id,
          organization_id: payload.organization_id,
          store_id: payload.store_id,
          user_id: payload.user_id,
          refund_method: payload.payout_channel,
          effective_channel: payload.payout_channel,
          ...fiscal,
        }, tx));
        if (!entry) {
          await tx.accounting_entry_failures.update({ where: { id: failureId },
            data: { error_message: 'SKIPPED_NO_ENTRY: fiscal gate or mapping did not post a journal' } });
          return;
        }
        if ('skipped' in entry && entry.skipped && entry.reason !== 'sale_reversal_already_posted_by_credit_note') {
          throw new Error(`Unrecognized refund accounting skip for #${payload.refund_id}`);
        }
        await tx.accounting_entry_failures.update({ where: { id: failureId },
          data: { resolved_at: new Date(), error_message: 'DELIVERED: journal posted or covered by posted credit note' } });
      }, { timeout: 30_000 });
    } catch (error) {
      await this.failures.recordAttempt(failureId, error as Error);
      throw error;
    }
  }
}
