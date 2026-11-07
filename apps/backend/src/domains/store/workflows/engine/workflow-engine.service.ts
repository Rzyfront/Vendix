import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowStageDef, findStage } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowAdvanceService } from './workflow-advance.service';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import {
  CompleteTaskInput,
  StartPublicWorkflowInput,
  StartSystemWorkflowInput,
  StartWorkflowInput,
  WorkflowActor,
  WorkflowCommandResult,
  WorkflowIdempotencyConflict,
  WorkflowInstanceRow,
  WorkflowTaskRow,
  WorkflowTx,
} from './workflow-engine.types';
import {
  COMPLETE_EVENT_TYPES,
  START_EVENT_TYPES,
  publicIdempotencyKey,
  systemIdempotencyKey,
  userIdempotencyKey,
} from './workflow-idempotency';
import { WorkflowEventsService } from './workflow-events.service';
import {
  WorkflowCallContext,
  WorkflowLoaderService,
} from './workflow-loader.service';
import { WorkflowCompleteService } from './workflow-complete.service';
import { WorkflowStartService } from './workflow-start.service';
import { WorkflowStageService } from './workflow-stage.service';
import { WorkflowTickService } from './workflow-tick.service';


const CLOSED_TASK = ['done', 'cancelled', 'expired'];

/**
 * The ONLY write commands of Flujos. Each runs in one `$transaction` on the
 * scoped client; the actor always comes from `RequestContextService`.
 */
@Injectable()
export class WorkflowEngineService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly loader: WorkflowLoaderService,
    private readonly assignment: WorkflowAssignmentService,
    private readonly starter: WorkflowStartService,
    private readonly completer: WorkflowCompleteService,
    private readonly advancer: WorkflowAdvanceService,
    private readonly stages: WorkflowStageService,
    private readonly events: WorkflowEventsService,
    private readonly ticker: WorkflowTickService,
  ) {}

  // ---- start -------------------------------------------------------------

  async start(raw: StartWorkflowInput): Promise<WorkflowCommandResult> {
    const ctx = this.loader.context();
    const actor = this.userActor(ctx);
    const input = {
      ...raw,
      idempotencyKey: raw.idempotencyKey
        ? userIdempotencyKey(ctx.user_id, raw.idempotencyKey)
        : undefined,
    };
    try {
      return await this.prisma.$transaction((tx: WorkflowTx) =>
        this.starter.execute(tx, ctx, actor, input),
      );
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) {
        const prev = await this.events.replay(this.prisma, e.idempotencyKey, {
          actor: actor,
          types: START_EVENT_TYPES,
        });
        if (prev) return prev;
      }
      throw e;
    }
  }


  /**
   * Public form submission (actor `public`). Only `WorkflowPublicFormService`
   * calls it, after resolving the link; the start service re-checks the link.
   */
  async startPublic(raw: StartPublicWorkflowInput): Promise<WorkflowCommandResult> {
    const ctx = this.loader.context();
    const input = { ...raw, idempotencyKey: publicIdempotencyKey(raw.idempotencyKey) };
    try {
      return await this.prisma.$transaction((tx: WorkflowTx) =>
        this.starter.executePublic(tx, ctx, input),
      );
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) {
        const prev = await this.events.replay(this.prisma, e.idempotencyKey, {
          actor: { type: 'public', id: null },
          types: START_EVENT_TYPES,
        });
        if (prev) return prev;
      }
      throw e;
    }
  }

  /**
   * Start from a business event (actor `system`). Only the outbox dispatcher
   * calls it, inside the store context of the `start_instance` row.
   */
  async startSystem(raw: StartSystemWorkflowInput): Promise<WorkflowCommandResult> {
    const ctx = this.loader.context();
    const input = { ...raw, idempotencyKey: systemIdempotencyKey(raw.idempotencyKey) };
    try {
      return await this.prisma.$transaction((tx: WorkflowTx) =>
        this.starter.executeSystem(tx, ctx, input),
      );
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) {
        const prev = await this.events.replay(this.prisma, e.idempotencyKey, {
          actor: { type: 'system', id: null },
          types: START_EVENT_TYPES,
        });
        if (prev) return prev;
      }
      throw e;
    }
  }

  // ---- completeTask ------------------------------------------------------

  async completeTask(raw: CompleteTaskInput): Promise<WorkflowCommandResult> {
    const ctx = this.loader.context();
    const actor = this.userActor(ctx);
    const input = {
      ...raw,
      idempotencyKey: raw.idempotencyKey
        ? userIdempotencyKey(ctx.user_id, raw.idempotencyKey)
        : undefined,
    };
    try {
      return await this.prisma.$transaction((tx: WorkflowTx) =>
        this.completer.execute(tx, ctx, actor, input),
      );
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) {
        const prev = await this.events.replay(this.prisma, e.idempotencyKey, {
          actor: actor,
          types: COMPLETE_EVENT_TYPES,
        });
        if (prev) return prev;
      }
      throw e;
    }
  }


  // ---- claim -------------------------------------------------------------

  async claimTask(taskId: number): Promise<WorkflowTaskRow> {
    const ctx = this.loader.context();
    const actor = this.userActor(ctx);
    return this.prisma.$transaction(async (tx: WorkflowTx) => {
      const task = await this.loader.loadTask(tx, taskId);
      if (task.status !== 'open') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_CLOSED);
      }
      this.completer.assertTaskPermission(ctx);
      if (!(await this.assignment.canAct(
          tx,
          task,
          ctx.user_id as number,
          ctx.store_id,
          ctx.organization_id,
        ))) {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_FORBIDDEN);
      }
      const instance = await this.loader.loadInstance(tx, task.instance_id);
      if (instance.status !== 'active') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_INSTANCE_CLOSED);
      }
      const definition = await this.loader.loadDefinition(tx, instance.version_id);
      const stage: WorkflowStageDef | undefined = findStage(definition, task.stage_key);
      if (stage?.quorum && stage.quorum.required > 1) {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_CLAIM_NOT_ALLOWED);
      }
      await this.events.lockInstance(tx, ctx.store_id, instance.id);
      const res = await tx.workflow_tasks.updateMany({
        where: { id: task.id, store_id: ctx.store_id, status: 'open' },
        data: { status: 'claimed', assignee_user_id: ctx.user_id, claimed_at: new Date() },
      });
      if (res.count === 0) throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_CLOSED);
      await this.events.append(tx, {
        store_id: ctx.store_id,
        instance_id: instance.id,
        type: 'claimed',
        from_stage_key: task.stage_key,
        actor,
        payload: { task_id: task.id },
      });
      return this.loader.loadTask(tx, task.id);
    });
  }

  // ---- admin commands ----------------------------------------------------

  /** Force the instance to `to` (caller checks `store:workflows:manage`). */
  async transition(input: {
    instanceId: number;
    to: string;
    reason: string;
    expectedRowVersion?: number;
  }): Promise<WorkflowCommandResult> {
    const ctx = this.loader.context();
    const actor = this.adminActor(ctx);
    return this.prisma.$transaction(async (tx: WorkflowTx) => {
      const instance = await this.loader.loadInstance(tx, input.instanceId);
      if (instance.status !== 'active') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_INSTANCE_CLOSED);
      }
      const definition = await this.loader.loadDefinition(tx, instance.version_id);
      const from = this.loader.currentStage(definition, instance);
      const updated = await this.advancer.advance({
        tx,
        instance,
        definition,
        fromStage: from,
        toStageKey: input.to,
        data: instance.data ?? {},
        actor,
        expectedRowVersion: input.expectedRowVersion ?? instance.row_version,
        runExitHooks: false,
        event: { type: 'forced', payload: { reason: input.reason } },
      });
      return {
        instance: updated,
        task: null,
        advanced: true,
        replayed: false,
        from_stage_key: from.key,
        to_stage_key: input.to,
      };
    });
  }

  async cancel(input: { instanceId: number; reason: string }): Promise<WorkflowInstanceRow> {
    const ctx = this.loader.context();
    const actor = this.adminActor(ctx);
    return this.prisma.$transaction(async (tx: WorkflowTx) => {
      const instance = await this.loader.loadInstance(tx, input.instanceId);
      if (instance.status !== 'active') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_INSTANCE_CLOSED);
      }
      const now = new Date();
      const cas = await tx.workflow_instances.updateMany({
        where: {
          id: instance.id,
          store_id: ctx.store_id,
          row_version: instance.row_version,
          status: 'active',
        },
        data: {
          status: 'cancelled',
          cancel_reason: input.reason,
          completed_at: now,
          stage_due_at: null,
          row_version: { increment: 1 },
        },
      });
      if (cas.count === 0) throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
      await this.stages.cancelOpenTasks(tx, ctx.store_id, instance.id);
      await this.events.append(tx, {
        store_id: ctx.store_id,
        instance_id: instance.id,
        type: 'cancelled',
        from_stage_key: instance.current_stage_key,
        actor,
        payload: { reason: input.reason },
      });
      return this.loader.loadInstance(tx, instance.id);
    });
  }

  /** Internal: automatic stages, overdue reminders and escalation. */
  tick(
    instanceId: number,
    opts: { expectStageEntrySeq?: number; now?: Date } = {},
  ) {
    return this.ticker.tick(instanceId, opts);
  }

  // ---- helpers -----------------------------------------------------------

  private userActor(ctx: WorkflowCallContext): WorkflowActor {
    if (ctx.user_id === null) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_FORBIDDEN);
    }
    return { type: 'user', id: ctx.user_id };
  }

  private adminActor(ctx: WorkflowCallContext): WorkflowActor {
    return ctx.user_id === null
      ? { type: 'system', id: null }
      : { type: 'user', id: ctx.user_id };
  }


}
