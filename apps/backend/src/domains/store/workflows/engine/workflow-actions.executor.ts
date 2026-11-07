import { Injectable, Logger } from '@nestjs/common';
import {
  WORKFLOW_ACTION_CATALOG,
  WorkflowVendixActionName,
} from '@common/workflows/contract';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { resolveUserStorePermissions } from '../../../../common/utils/user-store-permissions.util';
import { WorkflowEventsService } from './workflow-events.service';
import { systemIdempotencyKey } from './workflow-idempotency';
import {
  WorkflowIdempotencyConflict,
  WorkflowInstanceRow,
  WorkflowNonRetryableError,
  WorkflowTx,
} from './workflow-engine.types';
import { storeAllowsFlows } from './workflow-industry';
import {
  WorkflowActionHandlerMap,
  WorkflowActionInputError,
} from './actions/workflow-action.types';
import { WorkflowPeopleActions } from './actions/people.actions';
import { WorkflowOperationsActions } from './actions/operations.actions';
import { WorkflowPurchasingActions } from './actions/purchasing.actions';

export interface ActionOutboxRow {
  id: number;
  store_id: number;
  instance_id: number | null;
  payload: Record<string, any>;
}

/** The publisher must really hold what the route would ask of a person. */
function requirePermission(held: string[], needed: string, what: string) {
  if (!held.includes(needed)) {
    throw new WorkflowNonRetryableError(
      `El publicador del flujo ya no tiene el permiso ${needed} necesario para ${what}.`,
    );
  }
}

/** 4xx from a domain service: the same input fails again, do not retry. */
function isPermanent(e: unknown): boolean {
  if (e instanceof WorkflowActionInputError) return true;
  if (e instanceof VendixHttpException) return e.getStatus() < 500;
  const status = (e as { getStatus?: () => number })?.getStatus?.();
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Runs the `vendix.*` actions the engine wrote to the outbox (kind `action`).
 *
 * Registry (P1.2): every action of `WORKFLOW_ACTION_CATALOG` has a handler in
 * one of the action groups, which goes through the SAME domain service the UI
 * uses, so every business rule applies. The effect runs under the instance's
 * store, acting as the person who published the version (they authorized the
 * automation) with their REAL permissions, and only if they hold the
 * permission the registry names (the one of the UI route); the history
 * records actor `system`.
 *
 * Retries are safe: the touched record id is saved in the outbox payload right
 * after the effect, so a retry after a later failure never repeats it. Wrong
 * input or a business rejection (4xx) fails at once, without retries.
 */
@Injectable()
export class WorkflowActionsExecutor {
  private readonly logger = new Logger(WorkflowActionsExecutor.name);
  private readonly handlers: WorkflowActionHandlerMap;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly events: WorkflowEventsService,
    people: WorkflowPeopleActions,
    purchasing: WorkflowPurchasingActions,
    operations: WorkflowOperationsActions,
  ) {
    this.handlers = {
      ...people.handlers,
      ...purchasing.handlers,
      ...operations.handlers,
    };
  }

  /** Actions of the registry with a handler (the registry spec checks all). */
  registered(): WorkflowVendixActionName[] {
    return Object.keys(this.handlers) as WorkflowVendixActionName[];
  }

  /** Throws on failure (the dispatcher retries by backoff). */
  async execute(row: ActionOutboxRow): Promise<void> {
    if (!row.instance_id) return;
    const action = row.payload.action as WorkflowVendixActionName;
    const map = (row.payload.map_resolved ?? {}) as Record<string, unknown>;
    const instance = (await this.prisma.workflow_instances.findFirst({
      where: { id: row.instance_id, store_id: row.store_id },
    })) as WorkflowInstanceRow | null;
    if (!instance) return;
    if (!(await storeAllowsFlows(this.prisma.withoutScope() as never, row.store_id))) {
      this.logger.warn(
        `Action ${row.id} skipped: store ${row.store_id} no longer has the administration industry`,
      );
      return;
    }

    let createdId: number | null | undefined = row.payload.created_id;
    if (createdId === undefined) {
      const spec = WORKFLOW_ACTION_CATALOG[action];
      const handler = this.handlers[action];
      if (!spec || !handler) {
        throw new WorkflowNonRetryableError(`Unsupported action: ${String(action)}`);
      }
      const version = await this.prisma.workflow_versions.findFirst({
        where: { id: instance.version_id, store_id: row.store_id },
        select: { published_by_user_id: true },
      });
      if (!version) throw new Error('Workflow version not found');
      const actingUserId = version.published_by_user_id;
      const permissions = await resolveUserStorePermissions(
        this.prisma.withoutScope() as never,
        actingUserId,
        instance.store_id,
      );
      requirePermission(permissions, spec.permission, spec.label.toLowerCase());
      const claimed = spec.idempotency === 'at_most_once';
      if (claimed) await this.claimEffect(row);
      try {
        const result = await handler({
          instance,
          map,
          actingUserId,
          permissions,
          asPublisher: (fn) =>
            RequestContextService.runIsolated(
              {
                store_id: instance.store_id,
                organization_id: instance.organization_id,
                user_id: actingUserId,
                is_super_admin: false,
                is_owner: false,
                permissions,
              },
              fn,
            ),
        });
        createdId = result.record_id;
      } catch (e) {
        // The domain transaction rolled back: the effect did not happen, so a
        // retry may run it.
        if (claimed) await this.releaseEffect(row);
        if (isPermanent(e)) {
          throw new WorkflowNonRetryableError(
            (e as Error)?.message ?? String(e),
          );
        }
        throw e;
      }
      await this.prisma.withoutScope().workflow_outbox.updateMany({
        where: { id: row.id },
        data: { payload: { ...row.payload, created_id: createdId } },
      });
    }

    await this.record(row, instance, 'action_executed', {
      action,
      created_id: createdId,
      stage_key: row.payload.stage_key ?? null,
    });
  }

  /**
   * `at_most_once` actions: marks the row as started BEFORE the effect. A row
   * that already carries the mark and no result was interrupted between the
   * effect and saving its result (worker crash, outbox write failure): the
   * effect may have happened, so it is not repeated and the timeline says
   * why.
   */
  private async claimEffect(row: ActionOutboxRow): Promise<void> {
    if (row.payload.effect_started_at) {
      throw new WorkflowNonRetryableError(
        'La acción se interrumpió después de empezar y no se pudo confirmar si se ejecutó; revisa el registro antes de repetirla.',
      );
    }
    row.payload = { ...row.payload, effect_started_at: new Date().toISOString() };
    await this.prisma.withoutScope().workflow_outbox.updateMany({
      where: { id: row.id },
      data: { payload: row.payload },
    });
  }

  private async releaseEffect(row: ActionOutboxRow): Promise<void> {
    const payload = { ...row.payload };
    delete payload.effect_started_at;
    row.payload = payload;
    await this.prisma.withoutScope().workflow_outbox.updateMany({
      where: { id: row.id },
      data: { payload },
    });
  }

  /** Called by the dispatcher when the row is dead (retries exhausted). */
  async recordFailure(row: ActionOutboxRow, message: string): Promise<void> {
    if (!row.instance_id) return;
    const instance = (await this.prisma.workflow_instances.findFirst({
      where: { id: row.instance_id, store_id: row.store_id },
    })) as WorkflowInstanceRow | null;
    if (!instance) return;
    await this.record(row, instance, 'action_failed', {
      action: row.payload.action,
      stage_key: row.payload.stage_key ?? null,
      error: message.slice(0, 500),
    });
  }

  private async record(
    row: ActionOutboxRow,
    instance: WorkflowInstanceRow,
    type: 'action_executed' | 'action_failed',
    payload: Record<string, unknown>,
  ) {
    try {
      await this.prisma.$transaction(async (tx: WorkflowTx) => {
        await this.events.lockInstance(tx, row.store_id, instance.id);
        await this.events.append(tx, {
          store_id: row.store_id,
          instance_id: instance.id,
          type,
          from_stage_key: instance.current_stage_key,
          to_stage_key: instance.current_stage_key,
          actor: { type: 'system', id: null },
          payload,
          idempotencyKey: systemIdempotencyKey(`${type}:${row.id}`),
        });
      });
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) return; // already recorded
      throw e;
    }
  }
}
