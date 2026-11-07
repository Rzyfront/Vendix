import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  extractTriggerEvent,
  triggerIdempotencyKey,
} from './workflow-trigger.events';

export const START_INSTANCE_OUTBOX_KIND = 'start_instance';

/**
 * Business events → flow starts. The listener only WRITES an outbox row
 * (`start_instance`) per matching definition and returns; the dispatcher starts
 * the instance with retries. It never throws into the emitter.
 *
 * KNOWN RISK (accepted by design, §5.4): `EventEmitter2` is in-memory and
 * fire-and-forget. If the process dies between the business commit and this
 * handler writing the outbox row, that event is lost and no instance starts;
 * nothing replays it. Rows already in the outbox are durable (retry/backoff,
 * idempotent start). Business emitters are not changed to be transactional.
 */
@Injectable()
export class WorkflowTriggerListener {
  private readonly logger = new Logger(WorkflowTriggerListener.name);

  constructor(private readonly prisma: StorePrismaService) {}

  @OnEvent('order.created', { async: true })
  onOrderCreated(payload: unknown) {
    return this.handle('order.created', payload);
  }

  @OnEvent('order.paid', { async: true })
  onOrderPaid(payload: unknown) {
    return this.handle('order.paid', payload);
  }

  @OnEvent('purchase_order.received', { async: true })
  onPurchaseOrderReceived(payload: unknown) {
    return this.handle('purchase_order.received', payload);
  }

  @OnEvent('expense.approved', { async: true })
  onExpenseApproved(payload: unknown) {
    return this.handle('expense.approved', payload);
  }

  @OnEvent('customer.created', { async: true })
  onCustomerCreated(payload: unknown) {
    return this.handle('customer.created', payload);
  }

  @OnEvent('pqr.created', { async: true })
  onPqrCreated(payload: unknown) {
    return this.handle('pqr.created', payload);
  }

  /** Returns how many outbox rows were written. Never throws. */
  async handle(event: string, payload: unknown): Promise<number> {
    try {
      const info = extractTriggerEvent(event, payload);
      if (!info) return 0;
      const db = this.prisma.withoutScope();
      const definitions: Array<{
        id: number;
        published_version_id: number | null;
      }> = await db.workflow_definitions.findMany({
        where: {
          store_id: info.store_id,
          status: 'active',
          published_version_id: { not: null },
        },
        select: { id: true, published_version_id: true },
      });
      if (definitions.length === 0) return 0;
      const versions: Array<{ id: number; definition: unknown }> =
        await db.workflow_versions.findMany({
          where: {
            store_id: info.store_id,
            id: {
              in: definitions.map((d) => d.published_version_id as number),
            },
          },
          select: { id: true, definition: true },
        });
      const byVersion = new Map(versions.map((v) => [v.id, v.definition]));
      let written = 0;
      for (const def of definitions) {
        const published = byVersion.get(def.published_version_id as number) as
          | WorkflowDefinitionV1
          | undefined;
        const matches = (published?.triggers ?? []).some(
          (t) => t.kind === 'event' && t.event === event,
        );
        if (!matches) continue;
        const key = triggerIdempotencyKey(def.id, event, info.business_id);
        const existing = await db.workflow_outbox.findFirst({
          where: {
            store_id: info.store_id,
            kind: START_INSTANCE_OUTBOX_KIND,
            payload: { path: ['idempotency_key'], equals: key },
          },
          select: { id: true },
        });
        if (existing) continue;
        await db.workflow_outbox.create({
          data: {
            store_id: info.store_id,
            instance_id: null,
            kind: START_INSTANCE_OUTBOX_KIND,
            payload: {
              definition_id: def.id,
              event,
              event_context: info.context,
              idempotency_key: key,
            },
            status: 'pending',
            available_at: new Date(),
          },
        });
        written++;
      }
      return written;
    } catch (e) {
      this.logger.error(
        `Workflow trigger for ${event} failed: ${(e as Error)?.message}`,
      );
      return 0;
    }
  }
}
