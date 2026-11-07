import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { WorkflowTx } from '../engine/workflow-engine.types';
import { WEBHOOK_OUTBOX_KIND, WebhookBody } from './workflow-webhook.constants';

/**
 * Enqueues webhook deliveries inside the engine transaction: one
 * `workflow_webhook_deliveries` row plus one `workflow_outbox` row (kind
 * `webhook`) per active endpoint subscribed to the event. Same transaction as
 * the state change, so an event is delivered if and only if it happened. The
 * dispatcher does the HTTP call and the outbox owns retries/backoff.
 *
 * `event_id` is one uuid per business event (shared by every endpoint) and is
 * stable across retries, so receivers can dedupe on it.
 */
@Injectable()
export class WorkflowWebhookEmitter {
  async emit(
    tx: WorkflowTx,
    args: {
      store_id: number;
      instance_id?: number | null;
      type: string;
      data: Record<string, unknown>;
    },
  ): Promise<number> {
    const endpoints: Array<{ id: number }> =
      await tx.workflow_webhook_endpoints.findMany({
        where: {
          store_id: args.store_id,
          is_active: true,
          event_types: { has: args.type },
        },
        select: { id: true },
      });
    if (endpoints.length === 0) return 0;
    const body: WebhookBody = {
      event_id: randomUUID(),
      occurred_at: new Date().toISOString(),
      store_id: args.store_id,
      type: args.type,
      data: args.data,
    };
    for (const endpoint of endpoints) {
      await this.enqueueDelivery(
        tx,
        args.store_id,
        endpoint.id,
        body,
        args.instance_id ?? null,
      );
    }
    return endpoints.length;
  }

  /** One delivery + its outbox row (also used by `test` and `retry`). */
  async enqueueDelivery(
    tx: WorkflowTx,
    storeId: number,
    endpointId: number,
    body: WebhookBody,
    instanceId: number | null = null,
  ): Promise<number> {
    const delivery = await tx.workflow_webhook_deliveries.create({
      data: {
        store_id: storeId,
        endpoint_id: endpointId,
        event_id: body.event_id,
        event_type: body.type,
        payload: body as unknown as Record<string, unknown>,
        status: 'pending',
      },
    });
    await this.enqueueOutbox(tx, storeId, Number(delivery.id), instanceId);
    return Number(delivery.id);
  }

  async enqueueOutbox(
    tx: WorkflowTx,
    storeId: number,
    deliveryId: number,
    instanceId: number | null = null,
  ) {
    await tx.workflow_outbox.create({
      data: {
        store_id: storeId,
        instance_id: instanceId,
        kind: WEBHOOK_OUTBOX_KIND,
        payload: { delivery_id: deliveryId },
        status: 'pending',
        available_at: new Date(),
      },
    });
  }
}
