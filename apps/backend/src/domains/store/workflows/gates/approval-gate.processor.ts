import { Injectable, Logger } from '@nestjs/common';
import {
  WORKFLOW_GATE_OPERATIONS,
  WorkflowGateOperation,
} from '@common/workflows/contract';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { resolveUserStorePermissions } from '../../../../common/utils/user-store-permissions.util';
import { NotificationsService } from '../../notifications/notifications.service';
import { PurchaseOrdersService } from '../../orders/purchase-orders/purchase-orders.service';
import { ExpenseFlowService } from '../../expenses/expense-flow/expense-flow.service';
import { PayrollFlowService } from '../../payroll/payroll-runs/payroll-flow.service';
import { InventoryAdjustmentsService } from '../../inventory/adjustments/inventory-adjustments.service';
import { CreditNotesService } from '../../invoicing/credit-notes/credit-notes.service';
import { InvoiceFlowService } from '../../invoicing/invoice-flow/invoice-flow.service';
import { OrdersService } from '../../orders/orders.service';
import { AccountsPayableService } from '../../accounts-payable/accounts-payable.service';
import { WorkflowEngineService } from '../engine/workflow-engine.service';
import { WorkflowEventsService } from '../engine/workflow-events.service';
import { systemIdempotencyKey } from '../engine/workflow-idempotency';
import {
  WorkflowIdempotencyConflict,
  WorkflowNonRetryableError,
  WorkflowTx,
} from '../engine/workflow-engine.types';
import { storeAllowsFlows } from '../engine/workflow-industry';
import {
  GATE_RESOLVED_OUTBOX_KIND,
  GateDeferredRequest,
  GateRow,
} from './approval-gate';

export interface GateOutboxRow {
  id: number;
  store_id: number;
  instance_id: number | null;
  payload: Record<string, unknown>;
}

const NOTIFICATION_TYPE = 'workflow_task';

/**
 * A deferred operation the processor may run once approved: a closed
 * whitelist (method name → the domain call and the permission of its UI
 * route). The request JSON never names arbitrary code.
 */
interface Replayer {
  permission: string;
  run(args: unknown[], userId: number): Promise<unknown>;
}

const recordId = (r: unknown): number | null => {
  const id = Number((r as { id?: unknown } | null)?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/**
 * Applies approval gates (P1.3) from the outbox, in the worker:
 *
 * - `gate_start`: opens the request of a new gate. If the definition stopped
 *   governing the operation meanwhile, the gate is cancelled (the next attempt
 *   is evaluated again) and the requester is told.
 * - `gate_resolved`: tells the requester and applies the effect. A rejected
 *   `hold` gate voids the record (purchase order cancelled with the reason,
 *   expense rejected, payroll run cancelled) acting as the publisher of the
 *   flow, who must hold the permission of that route. An approved `defer`
 *   gate runs the deferred operation through the same domain service, acting
 *   as the requester with their CURRENT permissions; the service's own gate
 *   check finds the approval and consumes it, so it runs once.
 *
 * Every effect is recorded on the request's timeline. Outcomes are saved in
 * the outbox payload, so a retry never repeats an effect.
 */
@Injectable()
export class ApprovalGateProcessor {
  private readonly logger = new Logger(ApprovalGateProcessor.name);
  private readonly replayers: Record<string, Replayer>;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly engine: WorkflowEngineService,
    private readonly events: WorkflowEventsService,
    private readonly notifications: NotificationsService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly expenseFlow: ExpenseFlowService,
    private readonly payrollFlow: PayrollFlowService,
    adjustments: InventoryAdjustmentsService,
    creditNotes: CreditNotesService,
    invoiceFlow: InvoiceFlowService,
    orders: OrdersService,
    payables: AccountsPayableService,
  ) {
    const num = (v: unknown) => Number(v);
    this.replayers = {
      'inventory_adjustment.create:createAdjustment': {
        permission: 'store:inventory:adjustments:create',
        run: ([dto]) => adjustments.createAdjustment(dto as never),
      },
      'credit_note.create:createCreditNote': {
        permission: 'invoicing:write',
        run: ([dto]) => creditNotes.createCreditNote(dto as never),
      },
      'invoice.void:void': {
        permission: 'invoicing:write',
        run: ([id]) => invoiceFlow.void(num(id)),
      },
      'order.discount:updateOrderFromEditor': {
        permission: 'store:orders:update',
        run: ([id, dto]) => orders.updateOrderFromEditor(num(id), dto as never),
      },
      'supplier_payment.register:registerPurchaseOrderPayment': {
        permission: 'store:orders:purchase_orders:pay',
        run: ([id, dto]) => this.purchaseOrders.registerPayment(num(id), dto as never),
      },
      'supplier_payment.register:configurePurchaseOrderPaymentPlan': {
        permission: 'store:orders:purchase_orders:update',
        run: ([id, dto], userId) =>
          this.purchaseOrders.configurePaymentPlan(num(id), dto as never, userId),
      },
      'supplier_payment.register:registerPayablePayment': {
        permission: 'store:accounts_payable:payment',
        run: ([id, dto], userId) => payables.registerPayment(num(id), dto as never, userId),
      },
    };
  }

  /** `gate_start` row. Throws to retry. */
  async start(row: GateOutboxRow): Promise<void> {
    const gateId = Number(row.payload.gate_id);
    const gate = await this.gate(row.store_id, gateId);
    if (!gate || gate.status !== 'pending' || gate.instance_id !== null) return;
    if (!(await storeAllowsFlows(this.prisma.withoutScope() as never, row.store_id))) {
      await this.cancelUnstarted(gate, 'La tienda ya no tiene la industria Administración.');
      return;
    }
    const started = await this.engine.startGate(gateId);
    if (!started) {
      await this.cancelUnstarted(
        gate,
        'El flujo que gobernaba esta operación ya no está activo; vuelve a intentarla.',
      );
    }
  }

  /** `gate_resolved` row. Throws to retry. */
  async resolved(row: GateOutboxRow): Promise<void> {
    const gate = await this.gate(row.store_id, Number(row.payload.gate_id));
    if (!gate) return;
    const op = gate.operation as WorkflowGateOperation;
    const spec = WORKFLOW_GATE_OPERATIONS[op];
    if (!spec) return;
    const progress = { ...row.payload } as Record<string, unknown>;
    const save = () =>
      this.prisma.withoutScope().workflow_outbox.updateMany({
        where: { id: row.id },
        data: { payload: progress as object },
      });

    if (progress.effect_done !== true) {
      if (spec.mode === 'hold' && gate.status === 'rejected') {
        progress.effect = await this.voidHeld(gate);
      } else if (spec.mode === 'defer' && gate.status === 'approved') {
        progress.effect = await this.replay(gate);
      }
      progress.effect_done = true;
      await save();
    }
    if (progress.notified !== true) {
      await this.notifyRequester(gate, progress.effect as GateEffect | undefined);
      progress.notified = true;
      await save();
    }
  }

  /**
   * `gate_start` died (retries exhausted): without this the operation would
   * wait for a request that never opens. The gate is cancelled so the next
   * attempt asks again, and the requester is told.
   */
  async abandonStart(row: GateOutboxRow, error: string): Promise<void> {
    const gate = await this.gate(row.store_id, Number(row.payload.gate_id));
    if (!gate || gate.status !== 'pending' || gate.instance_id !== null) return;
    this.logger.error(`Gate ${gate.id} could not open its request: ${error}`);
    await this.cancelUnstarted(
      gate,
      'No se pudo crear la solicitud de aprobación; vuelve a intentar la operación.',
    );
  }

  // ---- effects ------------------------------------------------------------

  private async voidHeld(gate: GateRow): Promise<GateEffect> {
    const reason = gate.reason?.trim() || 'Rechazada en su solicitud de aprobación';
    const publisher = await this.publisherOf(gate);
    if (publisher === null) {
      return this.recordEffect(gate, 'gate_effect_failed', { error: 'Sin publicador' });
    }
    const permissions = await this.permissionsOf(gate, publisher);
    const voids: Record<string, { permission: string | null; run: () => Promise<unknown> }> = {
      'purchase_order.approve': {
        permission: 'store:orders:purchase_orders:cancel',
        run: () => this.purchaseOrders.cancel(gate.entity_id, reason),
      },
      'expense.approve': {
        permission: 'store:expenses:reject',
        run: () => this.expenseFlow.reject(gate.entity_id, reason),
      },
      // Payroll run routes carry no permission of their own: designing the
      // governing flow (store:workflows:design) is the authority here.
      'payroll_run.approve': {
        permission: null,
        run: () => this.payrollFlow.cancel(gate.entity_id),
      },
    };
    const v = voids[gate.operation];
    if (!v) return { kind: 'none' };
    if (v.permission && !permissions.includes(v.permission)) {
      return this.recordEffect(gate, 'gate_effect_failed', {
        error: `El publicador del flujo no tiene el permiso ${v.permission}; el registro queda bloqueado sin anular.`,
      });
    }
    try {
      await this.asUser(gate, publisher, permissions, v.run);
    } catch (e) {
      if (!this.isPermanent(e)) throw e;
      return this.recordEffect(gate, 'gate_effect_failed', { error: this.message(e) });
    }
    return this.recordEffect(gate, 'gate_voided', { reason });
  }

  private async replay(gate: GateRow): Promise<GateEffect> {
    const request = gate.request as unknown as (GateDeferredRequest & { hash?: string }) | null;
    const replayer = request ? this.replayers[`${gate.operation}:${request.method}`] : undefined;
    const userId = gate.requested_by_user_id;
    if (!request || !replayer || userId === null) {
      return this.recordEffect(gate, 'gate_effect_failed', {
        error: 'La operación aprobada no se puede ejecutar (solicitud sin datos).',
      });
    }
    const permissions = await this.permissionsOf(gate, userId);
    if (!permissions.includes(replayer.permission)) {
      return this.recordEffect(gate, 'gate_effect_failed', {
        error: `Quien pidió la operación ya no tiene el permiso ${replayer.permission}.`,
      });
    }
    try {
      const result = await this.asUser(gate, userId, permissions, () =>
        replayer.run(request.args, userId),
      );
      return this.recordEffect(gate, 'gate_executed', {
        method: request.method,
        record_id: recordId(result),
      });
    } catch (e) {
      if (!this.isPermanent(e)) throw e;
      return this.recordEffect(gate, 'gate_effect_failed', { error: this.message(e) });
    }
  }

  // ---- helpers -------------------------------------------------------------

  private async cancelUnstarted(gate: GateRow, reason: string): Promise<void> {
    const db = this.prisma.withoutScope();
    const done = await db.workflow_approval_gates.updateMany({
      where: { id: gate.id, status: 'pending', instance_id: null },
      data: { status: 'cancelled', reason, resolved_at: new Date() },
    });
    if (done.count === 0) return;
    await db.workflow_outbox.create({
      data: {
        store_id: gate.store_id,
        instance_id: null,
        kind: GATE_RESOLVED_OUTBOX_KIND,
        payload: { gate_id: gate.id, outcome: 'cancelled' },
        status: 'pending',
        available_at: new Date(),
      },
    });
  }

  private async gate(storeId: number, gateId: number): Promise<GateRow | null> {
    if (!Number.isInteger(gateId) || gateId < 1) return null;
    return (await this.prisma.withoutScope().workflow_approval_gates.findFirst({
      where: { id: gateId, store_id: storeId },
    })) as GateRow | null;
  }

  private async publisherOf(gate: GateRow): Promise<number | null> {
    if (gate.instance_id === null) return null;
    const instance = await this.prisma.withoutScope().workflow_instances.findFirst({
      where: { id: gate.instance_id, store_id: gate.store_id },
      select: { version_id: true },
    });
    if (!instance) return null;
    const version = await this.prisma.withoutScope().workflow_versions.findFirst({
      where: { id: instance.version_id, store_id: gate.store_id },
      select: { published_by_user_id: true },
    });
    return version?.published_by_user_id ?? null;
  }

  private permissionsOf(gate: GateRow, userId: number): Promise<string[]> {
    return resolveUserStorePermissions(
      this.prisma.withoutScope() as never,
      userId,
      gate.store_id,
    );
  }

  private asUser<T>(
    gate: GateRow,
    userId: number,
    permissions: string[],
    fn: () => Promise<T>,
  ): Promise<T> {
    return RequestContextService.runIsolated(
      {
        store_id: gate.store_id,
        organization_id: gate.organization_id,
        user_id: userId,
        is_super_admin: false,
        is_owner: false,
        permissions,
      },
      fn,
    );
  }

  private isPermanent(e: unknown): boolean {
    if (e instanceof WorkflowNonRetryableError) return true;
    if (e instanceof VendixHttpException) return e.getStatus() < 500;
    const status = (e as { getStatus?: () => number })?.getStatus?.();
    return typeof status === 'number' && status >= 400 && status < 500;
  }

  private message(e: unknown): string {
    return ((e as Error)?.message ?? String(e)).slice(0, 500);
  }

  /** Timeline entry on the request (once per gate and type). */
  private async recordEffect(
    gate: GateRow,
    type: 'gate_voided' | 'gate_executed' | 'gate_effect_failed',
    payload: Record<string, unknown>,
  ): Promise<GateEffect> {
    const effect: GateEffect = { kind: type, ...payload };
    if (gate.instance_id === null) return effect;
    const instanceId = gate.instance_id;
    try {
      await this.prisma.$transaction(async (tx: WorkflowTx) => {
        const instance = await tx.workflow_instances.findFirst({
          where: { id: instanceId, store_id: gate.store_id },
          select: { current_stage_key: true },
        });
        if (!instance) return;
        await this.events.lockInstance(tx, gate.store_id, instanceId);
        await this.events.append(tx, {
          store_id: gate.store_id,
          instance_id: instanceId,
          type,
          from_stage_key: instance.current_stage_key,
          to_stage_key: instance.current_stage_key,
          actor: { type: 'system', id: null },
          payload: { gate_id: gate.id, operation: gate.operation, ...payload },
          idempotencyKey: systemIdempotencyKey(`${type}:gate:${gate.id}`),
        });
      });
    } catch (e) {
      if (!(e instanceof WorkflowIdempotencyConflict)) throw e;
    }
    if (type === 'gate_effect_failed') {
      this.logger.warn(`Gate ${gate.id} (${gate.operation}): ${String(payload.error)}`);
    }
    return effect;
  }

  private async notifyRequester(gate: GateRow, effect: GateEffect | undefined) {
    const userId = gate.requested_by_user_id;
    if (userId === null) return;
    const label = WORKFLOW_GATE_OPERATIONS[gate.operation as WorkflowGateOperation]?.label ?? gate.operation;
    const instance = gate.instance_id
      ? await this.prisma.withoutScope().workflow_instances.findFirst({
          where: { id: gate.instance_id, store_id: gate.store_id },
          select: { id: true, reference: true },
        })
      : null;
    const ref = instance ? ` (solicitud ${instance.reference})` : '';
    let body: string;
    if (gate.status === 'approved') {
      body =
        effect?.kind === 'gate_executed'
          ? `Aprobada${ref}: la operación ya se ejecutó.`
          : effect?.kind === 'gate_effect_failed'
            ? `Aprobada${ref}, pero no se pudo ejecutar: ${String(effect.error ?? '')}`
            : `Aprobada${ref}: ya puedes continuar con la operación.`;
    } else if (gate.status === 'rejected') {
      body = `Rechazada${ref}${gate.reason ? `: ${gate.reason}` : '.'}`;
    } else {
      body = `Cancelada${ref}${gate.reason ? `: ${gate.reason}` : '.'} Puedes volver a intentarla.`;
    }
    await this.notifications.sendToUser(
      gate.store_id,
      userId,
      NOTIFICATION_TYPE,
      `Aprobación · ${label}`,
      body,
      instance
        ? { kind: 'workflow', instance_id: instance.id, url: `/admin/workflows/instances/${instance.id}` }
        : { kind: 'workflow' },
    );
  }
}

interface GateEffect {
  kind: 'none' | 'gate_voided' | 'gate_executed' | 'gate_effect_failed';
  [key: string]: unknown;
}
