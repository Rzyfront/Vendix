import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowWebhookEmitter } from '../webhooks/workflow-webhook-emitter.service';
import { WorkflowWebhookEvent } from '../webhooks/workflow-webhook.constants';
import {
  WorkflowActor,
  WorkflowCommandResult,
  WorkflowIdempotencyConflict,
  WorkflowTx,
} from './workflow-engine.types';

export interface AppendEventInput {
  store_id: number;
  instance_id: number;
  type: string;
  from_stage_key?: string | null;
  to_stage_key?: string | null;
  actor: WorkflowActor;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
}

export interface EnqueueInput {
  store_id: number;
  instance_id: number | null;
  kind: 'notify' | 'advance' | 'start_instance' | 'action';
  payload: Record<string, unknown>;
  available_at?: Date;
}

export interface ReplayExpectation {
  actor: WorkflowActor;
  /** Event types the original command can have written. */
  types: string[];
}

/** Append-only history (`seq`) and the transactional outbox. */
@Injectable()
export class WorkflowEventsService {
  constructor(private readonly webhooks: WorkflowWebhookEmitter) {}

  /**
   * Outgoing webhook for something that just happened to `instance` (same
   * transaction). `data` always carries the instance reference, never form data.
   */
  async emitWebhook(
    tx: WorkflowTx,
    instance: { id: number; store_id: number; reference: string },
    type: WorkflowWebhookEvent,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.webhooks.emit(tx, {
      store_id: instance.store_id,
      instance_id: instance.id,
      type,
      data: { instance_id: instance.id, reference: instance.reference, ...data },
    });
  }

  /**
   * Serializes writers of one instance without bumping `row_version`, so a
   * form open elsewhere stays valid. For commands that append an event without
   * a CAS on the instance. Take it before touching tasks: the engine always
   * locks the instance first, and the same order rules out deadlocks.
   */
  async lockInstance(tx: WorkflowTx, storeId: number, instanceId: number) {
    await tx.workflow_instances.updateMany({
      where: { id: instanceId, store_id: storeId },
      data: { updated_at: new Date() },
    });
  }

  /**
   * Appends `seq = last + 1`. `@@unique([instance_id, seq])` is the second
   * lock: a concurrent writer collides and becomes `WORKFLOW_STALE`; a reused
   * `(store_id, idempotency_key)` becomes {@link WorkflowIdempotencyConflict},
   * which the engine turns into a replay of the original result.
   */
  async append(tx: WorkflowTx, input: AppendEventInput) {
    const last = await tx.workflow_instance_events.findFirst({
      where: { store_id: input.store_id, instance_id: input.instance_id },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    try {
      return await tx.workflow_instance_events.create({
        data: {
          store_id: input.store_id,
          instance_id: input.instance_id,
          seq: (last?.seq ?? 0) + 1,
          type: input.type,
          from_stage_key: input.from_stage_key ?? null,
          to_stage_key: input.to_stage_key ?? null,
          actor_type: input.actor.type,
          actor_id: input.actor.id,
          payload: input.payload ?? {},
          idempotency_key: input.idempotencyKey ?? null,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const target: string[] = Array.isArray(e?.meta?.target)
          ? e.meta.target
          : [];
        if (target.includes('idempotency_key') && input.idempotencyKey) {
          throw new WorkflowIdempotencyConflict(input.idempotencyKey);
        }
        throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
      }
      throw e;
    }
  }

  async enqueue(tx: WorkflowTx, input: EnqueueInput) {
    return tx.workflow_outbox.create({
      data: {
        store_id: input.store_id,
        instance_id: input.instance_id,
        kind: input.kind,
        payload: input.payload,
        status: 'pending',
        available_at: input.available_at ?? new Date(),
      },
    });
  }

  /**
   * Original result for a (namespaced) idempotency key, or null when never
   * used. The stored event must belong to the same caller and the same kind of
   * command; otherwise the key was used by someone else / for something else
   * and the request is rejected without revealing anything about it.
   */
  async replay(
    db: WorkflowTx,
    key: string,
    expect: ReplayExpectation,
  ): Promise<WorkflowCommandResult | null> {
    const storeId = RequestContextService.getStoreId();
    const ev = await db.workflow_instance_events.findFirst({
      where: { idempotency_key: key, store_id: storeId },
    });
    if (!ev) return null;
    if (
      ev.actor_type !== expect.actor.type ||
      (ev.actor_id ?? null) !== (expect.actor.id ?? null) ||
      !expect.types.includes(ev.type)
    ) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_IDEMPOTENCY_KEY_CONFLICT);
    }
    const instance = await db.workflow_instances.findFirst({
      where: { id: ev.instance_id, store_id: storeId },
    });
    if (!instance) return null;
    const taskId = (ev.payload as { task_id?: number } | null)?.task_id;
    const task = taskId
      ? await db.workflow_tasks.findFirst({ where: { id: taskId, store_id: storeId } })
      : null;
    const advanced = (ev.payload as { advanced?: boolean } | null)?.advanced !== false;
    return {
      instance,
      task,
      advanced,
      replayed: true,
      from_stage_key: ev.from_stage_key,
      to_stage_key: ev.to_stage_key,
    };
  }
}
