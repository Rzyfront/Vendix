import { Injectable, Logger } from '@nestjs/common';
import {
  WorkflowAssigneeDef,
  WorkflowVendixActionName,
} from '@common/workflows/contract';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  CRM_TASKS_PERMISSION,
  CrmTasksService,
} from '../../customers/crm/tasks/crm-tasks.service';
import { resolveUserStorePermissions } from '../../../../common/utils/user-store-permissions.util';
import { PurchaseOrdersService } from '../../orders/purchase-orders/purchase-orders.service';
import { CreatePurchaseOrderDto } from '../../orders/purchase-orders/dto/create-purchase-order.dto';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import { WorkflowEventsService } from './workflow-events.service';
import { systemIdempotencyKey } from './workflow-idempotency';
import {
  WorkflowIdempotencyConflict,
  WorkflowInstanceRow,
  WorkflowNonRetryableError,
  WorkflowTx,
} from './workflow-engine.types';
import { storeAllowsFlows } from './workflow-industry';

export interface ActionOutboxRow {
  id: number;
  store_id: number;
  instance_id: number | null;
  payload: Record<string, any>;
}

const DAY_MS = 86_400_000;
/** Same permission the HTTP route of each operation requires. */
const PURCHASE_ORDER_CREATE_PERMISSION = 'store:orders:purchase_orders:create';

/** The publisher must really hold what the route would ask of a person. */
function requirePermission(held: string[], needed: string, what: string) {
  if (!held.includes(needed)) {
    throw new WorkflowNonRetryableError(
      `El publicador del flujo ya no tiene el permiso ${needed} necesario para ${what}.`,
    );
  }
}
const POSITIVE_INT = /^\d{1,12}$/;

function positiveInt(raw: unknown, name: string): number {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!POSITIVE_INT.test(text) || Number(text) < 1) {
    throw new Error(
      `"${name}" must be a positive integer (got "${String(raw ?? '')}")`,
    );
  }
  return Number(text);
}

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Runs the `vendix.*` actions the engine wrote to the outbox (kind `action`).
 *
 * Each one goes through the SAME domain service the UI uses (purchase orders,
 * CRM tasks), so every business rule and validation applies. The effect runs
 * under the instance's store, acting as the person who published the version
 * (they authorized the automation); the history records actor `system`.
 *
 * Retries are safe: the created id is saved in the outbox payload right after
 * the effect, so a retry after a later failure never creates a second record.
 */
@Injectable()
export class WorkflowActionsExecutor {
  private readonly logger = new Logger(WorkflowActionsExecutor.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly assignment: WorkflowAssignmentService,
    private readonly events: WorkflowEventsService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly crmTasks: CrmTasksService,
  ) {}

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

    let createdId: number | undefined = row.payload.created_id;
    if (createdId === undefined) {
      const version = await this.prisma.workflow_versions.findFirst({
        where: { id: instance.version_id, store_id: row.store_id },
        select: { published_by_user_id: true },
      });
      if (!version) throw new Error('Workflow version not found');
      const actingUserId = version.published_by_user_id;

      if (action === 'vendix.purchase_order.create_draft') {
        createdId = await this.createPurchaseOrder(instance, map, actingUserId);
      } else if (action === 'vendix.crm_task.create') {
        createdId = await this.createCrmTask(instance, map, actingUserId);
      } else {
        throw new Error(`Unsupported action: ${String(action)}`);
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

  /** Same store/org, acting as `userId` for the services that need a user. */
  private asUser<T>(
    instance: WorkflowInstanceRow,
    userId: number,
    permissions: string[],
    fn: () => Promise<T>,
  ): Promise<T> {
    return RequestContextService.runIsolated(
      {
        store_id: instance.store_id,
        organization_id: instance.organization_id,
        user_id: userId,
        is_super_admin: false,
        is_owner: false,
        permissions,
      },
      fn,
    );
  }

  private async createPurchaseOrder(
    instance: WorkflowInstanceRow,
    map: Record<string, unknown>,
    userId: number,
  ): Promise<number> {
    const unitPrice = Number(text(map.unit_price));
    if (
      !Number.isFinite(unitPrice) ||
      unitPrice < 0 ||
      text(map.unit_price) === ''
    ) {
      throw new Error(
        `"unit_price" must be a number >= 0 (got "${text(map.unit_price)}")`,
      );
    }
    const dto = {
      supplier_id: positiveInt(map.supplier_id, 'supplier_id'),
      location_id: positiveInt(map.location_id, 'location_id'),
      items: [
        {
          product_id: positiveInt(map.product_id, 'product_id'),
          quantity: positiveInt(map.quantity, 'quantity'),
          unit_price: Math.round(unitPrice * 100) / 100,
        },
      ],
      ...(text(map.notes) && { notes: text(map.notes).slice(0, 2000) }),
      ...(text(map.expected_date) && {
        expected_date: text(map.expected_date),
      }),
      internal_notes: `Creada por el flujo ${instance.reference}`,
    } as unknown as CreatePurchaseOrderDto;
    const poPermissions = await resolveUserStorePermissions(
      this.prisma.withoutScope() as never,
      userId,
      instance.store_id,
    );
    requirePermission(
      poPermissions,
      PURCHASE_ORDER_CREATE_PERMISSION,
      'crear la orden de compra',
    );
    const created = await this.asUser(instance, userId, poPermissions, () =>
      this.purchaseOrders.create(dto),
    );
    const id = Number((created as { id?: unknown })?.id);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error('Purchase order service returned no id');
    }
    return id;
  }

  private async createCrmTask(
    instance: WorkflowInstanceRow,
    map: Record<string, unknown>,
    userId: number,
  ): Promise<number> {
    const title = text(map.title).slice(0, 200);
    if (!title) throw new Error('"title" resolved to an empty text');
    const dueRaw = text(map.due_in_days);
    let dueAt: string | undefined;
    if (dueRaw !== '') {
      if (!/^\d{1,3}$/.test(dueRaw) || Number(dueRaw) > 365) {
        throw new Error(
          `"due_in_days" must be an integer between 0 and 365 (got "${dueRaw}")`,
        );
      }
      dueAt = new Date(Date.now() + Number(dueRaw) * DAY_MS).toISOString();
    }
    let assignee: number | undefined;
    const def = map.assignee as WorkflowAssigneeDef | undefined;
    if (def && typeof def === 'object') {
      const ids = await this.assignment.resolveUserIds(
        this.prisma,
        { title: '', message: '', def },
        instance,
      );
      assignee = ids[0];
    }
    const dto: Record<string, unknown> = {
      title,
      ...(text(map.description) && {
        description: text(map.description).slice(0, 5000),
      }),
      ...(dueAt && { due_at: dueAt }),
      ...(assignee !== undefined && { assigned_user_id: assignee }),
      ...(instance.subject_type === 'customer' &&
        instance.subject_id && { customer_id: instance.subject_id }),
    };
    // The action runs with the publisher's REAL store permissions: handing a
    // task to someone else needs the CRM see-all permission, and the flow
    // never grants it when the publisher does not hold it (the CRM service
    // then refuses and the outbox records `action_failed`).
    const permissions = await resolveUserStorePermissions(
      this.prisma.withoutScope() as never,
      userId,
      instance.store_id,
    );
    requirePermission(permissions, CRM_TASKS_PERMISSION, 'crear la tarea CRM');
    const created = await this.asUser(instance, userId, permissions, () =>
      this.crmTasks.create(dto as never),
    );
    const id = Number((created as { id?: unknown })?.id);
    if (!Number.isInteger(id) || id < 1)
      throw new Error('CRM service returned no id');
    return id;
  }
}
