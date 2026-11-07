import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { WorkflowEventsService } from '../../workflows/engine/workflow-events.service';

export type SignatureFlowEventType =
  | 'signature_requested'
  | 'signature_completed'
  | 'signature_declined'
  | 'signature_cancelled'
  | 'signature_expired';

/**
 * Puts a line in the timeline of the workflow request a document belongs to
 * and, when asked, queues the engine tick so an automatic stage re-evaluates
 * and moves on by itself. Runs in the caller's transaction.
 */
@Injectable()
export class SignatureFlowNotifier {
  // `WorkflowsModule` imports `DocumentsModule`: the engine's event writer is
  // resolved by token to avoid a module cycle.
  constructor(private readonly moduleRef: ModuleRef) {}

  async notify(
    tx: any,
    storeId: number,
    instanceId: number | null,
    event: { type: SignatureFlowEventType; payload: Record<string, unknown>; advance?: boolean },
  ): Promise<void> {
    if (!instanceId) return;
    const events = this.moduleRef.get(WorkflowEventsService, { strict: false });
    const instance = await tx.workflow_instances.findFirst({
      where: { id: instanceId, store_id: storeId },
      select: { id: true, status: true, current_stage_key: true, stage_entry_seq: true },
    });
    if (!instance) return;
    await events.lockInstance(tx, storeId, instanceId);
    await events.append(tx, {
      store_id: storeId,
      instance_id: instanceId,
      type: event.type,
      from_stage_key: instance.current_stage_key,
      to_stage_key: instance.current_stage_key,
      actor: { type: 'system', id: null },
      payload: event.payload,
    });
    if (event.advance && instance.status === 'active') {
      await events.enqueue(tx, {
        store_id: storeId,
        instance_id: instanceId,
        kind: 'advance',
        payload: {
          instance_id: instanceId,
          stage_key: instance.current_stage_key,
          stage_entry_seq: instance.stage_entry_seq,
        },
      });
    }
  }
}
