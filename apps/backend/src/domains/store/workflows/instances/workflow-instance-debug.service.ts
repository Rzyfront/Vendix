import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

export interface DebugChange {
  key: string;
  before: unknown;
  after: unknown;
}

export interface DebugEvent {
  seq: number;
  type: string;
  from_stage_key: string | null;
  to_stage_key: string | null;
  actor_type: string;
  actor_id: number | null;
  occurred_at: Date;
  payload: unknown;
  /** `null` for events recorded before the capture existed. */
  data_snapshot: Record<string, unknown> | null;
  /** Keys that differ from the previous event that has a snapshot. */
  changes: DebugChange[];
}

export interface InstanceDebugResult {
  instance_id: number;
  events: DebugEvent[];
  current_data: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Keys added, removed or modified from `before` to `after`, in key order. */
export function diffData(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): DebugChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys
    .filter((key) => !sameValue(before[key], after[key]))
    .map((key) => ({ key, before: before[key] ?? null, after: after[key] ?? null }));
}

/** Admin-only read model: variables of an instance at every event. */
@Injectable()
export class WorkflowInstanceDebugService {
  constructor(private readonly prisma: StorePrismaService) {}

  async debug(instanceId: number): Promise<InstanceDebugResult> {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    // The route requires `manage`, which sees every request of the store.
    const instance = await this.prisma.workflow_instances.findFirst({
      where: { id: instanceId, store_id: storeId },
      select: { id: true, data: true },
    });
    if (!instance) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    const rows = await this.prisma.workflow_instance_events.findMany({
      where: { store_id: storeId, instance_id: instanceId },
      orderBy: { seq: 'asc' },
    });
    let previous: Record<string, unknown> | null = null;
    const events = rows.map((row): DebugEvent => {
      const snapshot = asRecord(row.data_snapshot);
      const changes = snapshot && previous ? diffData(previous, snapshot) : [];
      if (snapshot) previous = snapshot;
      return {
        seq: row.seq,
        type: row.type,
        from_stage_key: row.from_stage_key,
        to_stage_key: row.to_stage_key,
        actor_type: row.actor_type,
        actor_id: row.actor_id,
        occurred_at: row.occurred_at,
        payload: row.payload,
        data_snapshot: snapshot,
        changes,
      };
    });
    return {
      instance_id: instance.id,
      events,
      current_data: asRecord(instance.data) ?? {},
    };
  }
}
