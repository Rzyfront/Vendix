import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  resolveTransition,
  stageOutcomes,
  validateFormValues,
} from '@common/workflows/contract';
import { WorkflowAdvanceService } from './workflow-advance.service';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import {
  CompleteTaskInput,
  WorkflowActor,
  WorkflowCommandResult,
  WorkflowRequirementsService,
  WorkflowTx,
} from './workflow-engine.types';
import { COMPLETE_EVENT_TYPES } from './workflow-idempotency';
import { WorkflowEventsService } from './workflow-events.service';
import {
  WorkflowCallContext,
  WorkflowLoaderService,
} from './workflow-loader.service';

const TASK_PERMISSION = 'store:workflows:task';
const CLOSED_TASK = ['done', 'cancelled', 'expired'];

/** `completeTask` inside the engine transaction (algorithm §5.4, steps 1–11). */
@Injectable()
export class WorkflowCompleteService {
  constructor(
    private readonly loader: WorkflowLoaderService,
    private readonly assignment: WorkflowAssignmentService,
    private readonly requirements: WorkflowRequirementsService,
    private readonly advancer: WorkflowAdvanceService,
    private readonly events: WorkflowEventsService,
  ) {}

  async execute(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    actor: WorkflowActor,
    input: CompleteTaskInput,
  ): Promise<WorkflowCommandResult> {
    if (input.idempotencyKey) {
      const prev = await this.events.replay(tx, input.idempotencyKey, {
        actor,
        types: COMPLETE_EVENT_TYPES,
      });
      if (prev) return prev;
    }
    // 1. Task + instance (store scoped).
    let task = await this.loader.loadTask(tx, input.taskId);
    let instance = await this.loader.loadInstance(tx, task.instance_id);
    if (CLOSED_TASK.includes(task.status)) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_CLOSED);
    }
    if (instance.status !== 'active') {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_INSTANCE_CLOSED);
    }
    // 2. May this actor attend it?
    this.assertTaskPermission(ctx);
    if (!(await this.assignment.canAct(
        tx,
        task,
        ctx.user_id as number,
        ctx.store_id,
        ctx.organization_id,
      ))) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_FORBIDDEN);
    }
    const definition = await this.loader.loadDefinition(tx, instance.version_id);
    const stage = this.loader.currentStage(definition, instance);
    if (stage.key !== task.stage_key || task.stage_entry_seq !== instance.stage_entry_seq) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_CLOSED);
    }
    if (!stageOutcomes(stage).includes(input.outcome)) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_OUTCOME_INVALID);
    }
    const required = stage.type === 'approval' ? (stage.quorum?.required ?? 1) : 1;
    const quorum = required > 1;
    const votesApprove = quorum && input.outcome === 'approve';

    if (!votesApprove && instance.row_version !== input.expectedRowVersion) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
    }
    // 3. Form (decisions that send the case back / reject need no values).
    let data = instance.data ?? {};
    if (stage.form?.fields.length && !['reject', 'return'].includes(input.outcome)) {
      const form = validateFormValues(definition, stage, input.values ?? {});
      if (!form.ok) {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_FORM_INVALID, undefined, {
          errors: form.errors,
        });
      }
      data = { ...data, ...form.values };
    }

    // 4. Quorum.
    let expected = input.expectedRowVersion;
    if (quorum) {
      const voted = await tx.workflow_task_votes.findFirst({
        where: {
          store_id: ctx.store_id,
          task_id: task.id,
          user_id: ctx.user_id,
        },
      });
      if (voted) throw new VendixHttpException(ErrorCodes.WORKFLOW_ALREADY_VOTED);
    }
    if (votesApprove) {
      // Lock first (bump without comparing the caller's version), then count
      // on a fresh read: concurrent voters serialize on the instance row, so
      // the last approval always sees all the others.
      const lock = await tx.workflow_instances.updateMany({
        where: {
          id: instance.id,
          store_id: ctx.store_id,
          status: 'active',
          current_stage_key: stage.key,
          stage_entry_seq: instance.stage_entry_seq,
        },
        data: { row_version: { increment: 1 } },
      });
      if (lock.count === 0) throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
      instance = await this.loader.loadInstance(tx, instance.id);
      task = await this.loader.loadTask(tx, task.id);
      if (CLOSED_TASK.includes(task.status)) {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_CLOSED);
      }
      expected = instance.row_version;
      await tx.workflow_task_votes.create({
        data: {
          store_id: ctx.store_id,
          task_id: task.id,
          user_id: ctx.user_id,
          outcome: 'approve',
          comment: input.comment ?? null,
        },
      });
      const approvals = await tx.workflow_task_votes.count({
        where: { store_id: ctx.store_id, task_id: task.id, outcome: 'approve' },
      });
      if (approvals < required) {
        await this.events.append(tx, {
          store_id: ctx.store_id,
          instance_id: instance.id,
          type: 'vote',
          from_stage_key: stage.key,
          to_stage_key: stage.key,
          actor,
          payload: {
            task_id: task.id,
            outcome: 'approve',
            comment: input.comment ?? null,
            approvals,
            required,
            advanced: false,
          },
          idempotencyKey: input.idempotencyKey ?? null,
        });
        return {
          instance,
          task,
          advanced: false,
          replayed: false,
          from_stage_key: stage.key,
          to_stage_key: stage.key,
        };
      }
    }

    // 5. Exit requirements: only `approve` / `submit` are blocked.
    if (input.outcome === 'approve' || input.outcome === 'submit') {
      const pending = await this.requirements.pendingRequirements(
        { ...instance, data },
        stage,
        tx,
      );
      if (pending.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.WORKFLOW_REQUIREMENT_PENDING,
          `Falta: ${pending.map((p) => p.label).join(', ')}`,
          { pending },
        );
      }
    }
    // 6. Transition.
    const transition = resolveTransition(stage, input.outcome, data, definition.fields);
    if (!transition) throw new VendixHttpException(ErrorCodes.WORKFLOW_NO_TRANSITION);
    if (transition.require_comment && !input.comment?.trim()) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_COMMENT_REQUIRED);
    }
    // 7–11.
    const updated = await this.advancer.advance({
      tx,
      instance,
      definition,
      fromStage: stage,
      toStageKey: transition.to,
      data,
      actor,
      expectedRowVersion: expected,
      runExitHooks: true,
      doneTaskId: task.id,
      event: {
        type: 'task_completed',
        idempotencyKey: input.idempotencyKey ?? null,
        payload: {
          task_id: task.id,
          outcome: input.outcome,
          comment: input.comment ?? null,
          advanced: true,
        },
      },
      onCas: async () => {
        const done = await tx.workflow_tasks.updateMany({
          where: {
            id: task.id,
            store_id: ctx.store_id,
            status: { in: ['open', 'claimed'] },
          },
          data: {
            status: 'done',
            outcome: input.outcome,
            outcome_comment: input.comment ?? null,
            completed_by_user_id: ctx.user_id,
            completed_at: new Date(),
            ...(task.assignee_user_id === null && { assignee_user_id: ctx.user_id }),
          },
        });
        if (done.count === 0) {
          throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_CLOSED);
        }
        await this.events.emitWebhook(tx, instance, 'workflow.task.completed', {
          task_id: task.id,
          stage_key: stage.key,
          outcome: input.outcome,
        });
        if (quorum && !votesApprove) {
          // The approving vote was recorded above, under the instance lock.
          await tx.workflow_task_votes.create({
            data: {
              store_id: ctx.store_id,
              task_id: task.id,
              user_id: ctx.user_id,
              outcome: input.outcome,
              comment: input.comment ?? null,
            },
          });
        }
      },
    });
    return {
      instance: updated,
      task: await this.loader.loadTask(tx, task.id),
      advanced: true,
      replayed: false,
      from_stage_key: stage.key,
      to_stage_key: transition.to,
    };
  }

  /**
   * Fails closed: without the task permission (an empty list included) the
   * caller is rejected. System/public paths never go through this check.
   */
  assertTaskPermission(ctx: WorkflowCallContext) {
    if (ctx.is_owner || ctx.is_super_admin) return;
    if (!ctx.permissions.includes(TASK_PERMISSION)) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_FORBIDDEN);
    }
  }
}
