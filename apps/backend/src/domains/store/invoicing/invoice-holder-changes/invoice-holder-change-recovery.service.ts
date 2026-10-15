import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { StoreContextRunner } from '../../../../common/context/store-context-runner.service';
import { InvoiceHolderChangesService } from './invoice-holder-changes.service';

@Injectable()
export class InvoiceHolderChangeRecoveryService {
  private readonly logger = new Logger(InvoiceHolderChangeRecoveryService.name);
  private running = false;
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly context: StoreContextRunner,
    private readonly changes: InvoiceHolderChangesService,
  ) {}
  @Interval(60000)
  async recoverBatch() {
    if (process.env.VENDIX_PROCESS_ROLE === 'api' || this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const rows = await this.prisma.invoice_holder_changes.findMany({
        where: {
          run_status: {
            in: ['ready', 'running', 'waiting', 'retryable_error'],
          },
          phase: { notIn: ['completed', 'awaiting_customer'] },
          AND: [
            { OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }] },
            {
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: [
          { next_retry_at: { sort: 'asc', nulls: 'first' } },
          { id: 'asc' },
        ],
        take: 25,
        select: { id: true, store_id: true },
      });
      const legacy = await this.prisma.invoice_data_requests.findMany({
        where: {
          status: 'submitted',
          submitted_at: { not: null },
          invoice_holder_changes_request_id: null,
        },
        take: 25,
        orderBy: { id: 'asc' },
        select: { id: true, store_id: true },
      });
      for (const request of legacy)
        await this.context
          .runInStoreContext(request.store_id, () =>
            this.changes.adoptLegacySubmittedRequest(request.id),
          )
          .catch(async () => {
            await this.prisma.invoice_data_requests.updateMany({
              where: {
                id: request.id,
                store_id: request.store_id,
                status: 'submitted',
              },
              data: { status: 'failed' },
            });
            this.logger.warn(
              `Legacy invoice request #${request.id} requires complete fiscal capture`,
            );
          });
      for (const op of rows)
        await this.context
          .runInStoreContext(op.store_id, () => this.changes.resume(op.id))
          .catch(() =>
            this.logger.warn(
              `Holder change #${op.id} requires recovery review`,
            ),
          );
    } finally {
      this.running = false;
    }
  }
  @OnEvent('invoice.accepted', { async: true })
  async accepted(event: {
    invoice_id: number;
    store_id?: number;
    organization_id: number;
  }) {
    const op = await this.prisma.invoice_holder_changes.findFirst({
      where: {
        organization_id: event.organization_id,
        ...(event.store_id ? { store_id: event.store_id } : {}),
        active_order_key: { not: null },
        OR: [
          { original_invoice_id: event.invoice_id },
          { credit_note_id: event.invoice_id },
          { new_invoice_id: event.invoice_id },
        ],
      },
      select: { id: true, store_id: true },
    });
    if (op)
      await this.context.runInStoreContext(op.store_id, () =>
        this.changes.resume(op.id),
      );
  }
}
