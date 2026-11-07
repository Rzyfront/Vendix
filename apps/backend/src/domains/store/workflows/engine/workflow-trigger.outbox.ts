import { WorkflowTriggerEvent } from '@common/workflows/contract';
import { extractTriggerEvent } from './workflow-trigger.events';

/** Outbox row holding one business fact, written by the domain transaction. */
export const BUSINESS_EVENT_OUTBOX_KIND = 'business_event';

export interface BusinessEventOutboxPayload {
  event: WorkflowTriggerEvent;
  business_id: string;
  context: Record<string, string | number | boolean | null>;
}

/** The only delegates needed; any transaction client of any Prisma scope fits. */
export interface TriggerOutboxClient {
  workflow_definitions: {
    findFirst(args: {
      where: {
        store_id: number;
        status: 'active';
        published_version_id: { not: null };
      };
      select: { id: true };
    }): Promise<{ id: number } | null>;
  };
  workflow_outbox: {
    create(args: {
      data: {
        store_id: number;
        instance_id: null;
        kind: string;
        payload: object;
        status: 'pending';
        available_at: Date;
      };
    }): Promise<unknown>;
  };
}

/**
 * Durable half of a workflow trigger. Call it with the DOMAIN transaction: the
 * row commits or rolls back with the business fact, so a crash right after the
 * commit cannot lose the event and a rollback cannot start a flow. The
 * dispatcher fans it out later; the start is idempotent, so the flow starts
 * once.
 *
 * Stores with no active flow write nothing, which keeps POS and order
 * transactions free of outbox rows they will never use. A database error here
 * aborts the domain transaction on purpose: that is what makes it atomic.
 */
export async function recordTriggerEvent(
  tx: TriggerOutboxClient,
  event: WorkflowTriggerEvent,
  payload: unknown,
): Promise<boolean> {
  const info = extractTriggerEvent(event, payload);
  if (!info) return false;
  const active = await tx.workflow_definitions.findFirst({
    where: {
      store_id: info.store_id,
      status: 'active',
      published_version_id: { not: null },
    },
    select: { id: true },
  });
  if (!active) return false;
  const row: BusinessEventOutboxPayload = {
    event,
    business_id: info.business_id,
    context: info.context,
  };
  await tx.workflow_outbox.create({
    data: {
      store_id: info.store_id,
      instance_id: null,
      kind: BUSINESS_EVENT_OUTBOX_KIND,
      payload: row,
      status: 'pending',
      available_at: new Date(),
    },
  });
  return true;
}
