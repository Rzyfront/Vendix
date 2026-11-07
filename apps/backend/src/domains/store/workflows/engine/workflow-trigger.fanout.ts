import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { triggerIdempotencyKey } from './workflow-trigger.events';
import { BusinessEventOutboxPayload } from './workflow-trigger.outbox';

export const START_INSTANCE_OUTBOX_KIND = 'start_instance';

/** Order events that must not start a flow once the order was compensated away. */
const ORDER_EVENTS = new Set(['order.created', 'order.paid']);

/**
 * `business_event` row → one `start_instance` row per matching definition, so a
 * definition that fails to start retries on its own without holding the others.
 * All rows go in one transaction. Delivery is at-least-once: a repeated run
 * finds the keys already written, and the start itself is idempotent.
 */
@Injectable()
export class WorkflowTriggerFanout {
  private readonly logger = new Logger(WorkflowTriggerFanout.name);

  constructor(private readonly prisma: StorePrismaService) {}

  /** Returns how many `start_instance` rows were written. Throws to retry. */
  async fanOut(
    storeId: number,
    payload: BusinessEventOutboxPayload,
  ): Promise<number> {
    const { event, business_id: businessId, context } = payload;
    const db = this.prisma.withoutScope();
    if (await this.isCancelledOrder(storeId, event, businessId)) {
      this.logger.warn(
        `${event} ${businessId} skipped: the order was cancelled before dispatch`,
      );
      return 0;
    }
    const definitions: Array<{
      id: number;
      published_version_id: number | null;
    }> = await db.workflow_definitions.findMany({
      where: {
        store_id: storeId,
        status: 'active',
        published_version_id: { not: null },
      },
      select: { id: true, published_version_id: true },
    });
    if (definitions.length === 0) return 0;
    const versions: Array<{ id: number; definition: unknown }> =
      await db.workflow_versions.findMany({
        where: {
          store_id: storeId,
          id: { in: definitions.map((d) => d.published_version_id as number) },
        },
        select: { id: true, definition: true },
      });
    const byVersion = new Map(versions.map((v) => [v.id, v.definition]));
    const matching = definitions.filter((def) => {
      const published = byVersion.get(def.published_version_id as number) as
        | WorkflowDefinitionV1
        | undefined;
      return (published?.triggers ?? []).some(
        (t) => t.kind === 'event' && t.event === event,
      );
    });
    if (matching.length === 0) return 0;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let written = 0;
      for (const def of matching) {
        const key = triggerIdempotencyKey(def.id, event, businessId);
        const existing = await tx.workflow_outbox.findFirst({
          where: {
            store_id: storeId,
            kind: START_INSTANCE_OUTBOX_KIND,
            payload: { path: ['idempotency_key'], equals: key },
          },
          select: { id: true },
        });
        if (existing) continue;
        await tx.workflow_outbox.create({
          data: {
            store_id: storeId,
            instance_id: null,
            kind: START_INSTANCE_OUTBOX_KIND,
            payload: {
              definition_id: def.id,
              event,
              event_context: context,
              idempotency_key: key,
            },
            status: 'pending',
            available_at: new Date(),
          },
        });
        written++;
      }
      return written;
    });
  }

  /**
   * Checkout writes the order first and compensates by cancelling it when a
   * later step fails, so the event committed with the order can outlive it.
   */
  private async isCancelledOrder(
    storeId: number,
    event: string,
    businessId: string,
  ): Promise<boolean> {
    if (!ORDER_EVENTS.has(event)) return false;
    const order = await this.prisma.withoutScope().orders.findFirst({
      where: { id: Number(businessId), store_id: storeId },
      select: { state: true },
    });
    return order?.state === 'cancelled';
  }
}
