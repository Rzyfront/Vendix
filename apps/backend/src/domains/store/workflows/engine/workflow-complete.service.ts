import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  WorkflowDefinitionV1,
  WorkflowStageDef,
  resolveTransition,
  stageFormKeys,
  stageOutcomes,
  validateFormValues,
} from '@common/workflows/contract';
import { WorkflowAuditService } from '../audit/workflow-audit.service';
import { firedGuard } from './workflow-guards';
import { WorkflowAdvanceService } from './workflow-advance.service';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import {
  CompleteTaskInput,
  WorkflowActor,
  WorkflowCommandResult,
  WorkflowInstanceRow,
  WorkflowRequirementsService,
  WorkflowTaskRow,
  WorkflowTx,
} from './workflow-engine.types';
import { COMPLETE_EVENT_TYPES } from './workflow-idempotency';
import { WorkflowEventsService } from './workflow-events.service';
import { WorkflowStageService } from './workflow-stage.service';
import {
  WorkflowCallContext,
  WorkflowLoaderService,
} from './workflow-loader.service';

const TASK_PERMISSION = 'store:workflows:task';
const CLOSED_TASK = ['done', 'cancelled', 'expired'];

const OUTCOME_VERBS: Record<string, string> = {
  approve: 'Aprobó',
  reject: 'Rechazó',
  return: 'Devolvió',
  submit: 'Envió',
};

/** `completeTask` inside the engine transaction (algorithm §5.4, steps 1–11). */
@Injectable()
export class WorkflowCompleteService {
  constructor(
    private readonly loader: WorkflowLoaderService,
    private readonly assignment: WorkflowAssignmentService,
    private readonly requirements: WorkflowRequirementsService,
    private readonly advancer: WorkflowAdvanceService,
    private readonly events: WorkflowEventsService,
    private readonly stages: WorkflowStageService,
    /** Append-only audit trail (P7.2): required, so no path runs unaudited. */
    private readonly audit: WorkflowAuditService,
  ) {}

  /**
   * One audit row for a decision, in the decision's own transaction: it
   * commits or rolls back with it. Call it as the last statement, after every
   * row it depends on was written.
   */
  private async auditDecision(
    tx: WorkflowTx,
    action: 'decision.task_completed' | 'decision.task_voted',
    d: {
      instance: WorkflowInstanceRow;
      task: WorkflowTaskRow;
      stage: WorkflowStageDef;
      outcome: string;
      comment?: string | null;
      extra?: Record<string, unknown>;
    },
  ): Promise<void> {
    const lead =
      action === 'decision.task_voted'
        ? 'Votó a favor'
        : (OUTCOME_VERBS[d.outcome] ?? `Decidió «${d.outcome}»`);
    await this.audit.append(tx, {
      action,
      target_type: 'task',
      target_id: d.task.id,
      definition_id: d.instance.definition_id,
      instance_id: d.instance.id,
      summary: `${lead} en la etapa «${d.stage.name}» de la solicitud ${d.instance.reference}`,
      details: {
        outcome: d.outcome,
        stage_key: d.stage.key,
        stage_name: d.stage.name,
        task_id: d.task.id,
        instance_reference: d.instance.reference,
        has_comment: !!d.comment?.trim(),
        ...d.extra,
      },
    });
  }

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
    if (stage.type === 'parallel') {
      return this.completeBranch(tx, ctx, actor, input, { task, instance, definition, stage });
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
    if (stageFormKeys(stage).length && !['reject', 'return'].includes(input.outcome)) {
      const form = validateFormValues(definition, stage, input.values ?? {});
      if (!form.ok) {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_FORM_INVALID, undefined, {
          errors: form.errors,
        });
      }
      data = { ...data, ...form.values };
    }
    data = await this.stages.computeFields(definition, data, ctx.store_id);
    // P2.5: a guard blocks with its message or sends the request elsewhere.
    const guard = firedGuard(stage, input.outcome, data, definition.fields);
    if (guard && !guard.redirect_to) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_GUARD_BLOCKED, guard.message, {
        stage_key: stage.key,
      });
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
      // Under the lock: a double click from the same user read no vote above.
      const votedMeanwhile = await tx.workflow_task_votes.findFirst({
        where: {
          store_id: ctx.store_id,
          task_id: task.id,
          user_id: ctx.user_id,
        },
      });
      if (votedMeanwhile) {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_ALREADY_VOTED);
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
        await this.auditDecision(tx, 'decision.task_voted', {
          instance,
          task,
          stage,
          outcome: 'approve',
          comment: input.comment,
          extra: { approvals, required },
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
    // 6. Transition (a redirecting guard wins over the declared branches).
    const transition = guard?.redirect_to
      ? { to: guard.redirect_to, on: input.outcome }
      : resolveTransition(stage, input.outcome, data, definition.fields);
    if (!transition) throw new VendixHttpException(ErrorCodes.WORKFLOW_NO_TRANSITION);
    if ('require_comment' in transition && transition.require_comment && !input.comment?.trim()) {
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
      resolved: { submitted: input.outcome === 'submit' || input.outcome === 'approve' },
      doneTaskId: task.id,
      event: {
        type: 'task_completed',
        idempotencyKey: input.idempotencyKey ?? null,
        payload: {
          task_id: task.id,
          outcome: input.outcome,
          comment: input.comment ?? null,
          advanced: true,
          ...(guard ? { guard_message: guard.message } : {}),
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
    if (guard) {
      await this.events.append(tx, {
        store_id: ctx.store_id,
        instance_id: instance.id,
        type: 'guard_redirected',
        from_stage_key: stage.key,
        to_stage_key: transition.to,
        actor,
        payload: { message: guard.message, to: transition.to },
      });
    }
    await this.auditDecision(tx, 'decision.task_completed', {
      instance,
      task,
      stage,
      outcome: input.outcome,
      comment: input.comment,
      extra: { to_stage_key: transition.to, ...(quorum ? { quorum_required: required } : {}) },
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
   * P2.1: a branch of a parallel stage submits its part. Concurrent branches
   * serialize on the instance row (bump first, then read fresh, like the
   * quorum), so the branch that completes the join always sees the others and
   * the join fires exactly once.
   */
  private async completeBranch(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    actor: WorkflowActor,
    input: CompleteTaskInput,
    loaded: {
      task: WorkflowTaskRow;
      instance: WorkflowInstanceRow;
      definition: WorkflowDefinitionV1;
      stage: WorkflowStageDef;
    },
  ): Promise<WorkflowCommandResult> {
    const { definition, stage } = loaded;
    const parallel = stage.parallel;
    const branch = parallel?.branches.find((b) => b.key === loaded.task.branch_key);
    if (!parallel || !branch) throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_CLOSED);
    if (input.outcome !== 'submit') {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_OUTCOME_INVALID);
    }
    const form = validateFormValues(
      definition,
      { ...stage, form: branch.form ?? { fields: [] } },
      input.values ?? {},
    );
    if (!form.ok) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_FORM_INVALID, undefined, {
        errors: form.errors,
      });
    }

    const lock = await tx.workflow_instances.updateMany({
      where: {
        id: loaded.instance.id,
        store_id: ctx.store_id,
        status: 'active',
        current_stage_key: stage.key,
        stage_entry_seq: loaded.instance.stage_entry_seq,
      },
      data: { row_version: { increment: 1 } },
    });
    if (lock.count === 0) throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
    const fresh = await this.loader.loadInstance(tx, loaded.instance.id);
    const done = await tx.workflow_tasks.updateMany({
      where: { id: loaded.task.id, store_id: ctx.store_id, status: { in: ['open', 'claimed'] } },
      data: {
        status: 'done',
        outcome: 'submit',
        outcome_comment: input.comment ?? null,
        completed_by_user_id: ctx.user_id,
        completed_at: new Date(),
        ...(loaded.task.assignee_user_id === null && { assignee_user_id: ctx.user_id }),
      },
    });
    if (done.count === 0) throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_CLOSED);

    // The branch's values and `on_submit` hooks, written under the lock.
    const submitted = this.stagesApply(stage, { ...(fresh.data ?? {}), ...form.values }, fresh);
    const data = await this.stages.computeFields(definition, submitted.data, ctx.store_id);
    const saved = await tx.workflow_instances.updateMany({
      where: { id: fresh.id, store_id: ctx.store_id, row_version: fresh.row_version },
      data: { data, row_version: { increment: 1 } },
    });
    if (saved.count === 0) throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
    let instance: WorkflowInstanceRow = { ...fresh, data, row_version: fresh.row_version + 1 };
    await this.stagesEnqueue(tx, instance, stage.key, submitted);

    const doneCount = await tx.workflow_tasks.count({
      where: {
        store_id: ctx.store_id,
        instance_id: instance.id,
        stage_key: stage.key,
        stage_entry_seq: instance.stage_entry_seq,
        branch_key: { not: null },
        status: 'done',
      },
    });
    const total = parallel.branches.length;
    const needed =
      parallel.join === 'any' ? 1 : parallel.join === 'n_of_m' ? (parallel.required ?? total) : total;
    const joined = doneCount >= needed;
    await this.events.append(tx, {
      store_id: ctx.store_id,
      instance_id: instance.id,
      type: 'branch_completed',
      from_stage_key: stage.key,
      to_stage_key: stage.key,
      actor,
      payload: {
        task_id: loaded.task.id,
        branch_key: branch.key,
        branch_name: branch.name,
        comment: input.comment ?? null,
        done: doneCount,
        total,
        needed,
        advanced: false,
      },
      idempotencyKey: input.idempotencyKey ?? null,
    });
    await this.events.emitWebhook(tx, instance, 'workflow.task.completed', {
      task_id: loaded.task.id,
      stage_key: stage.key,
      outcome: 'submit',
      branch_key: branch.key,
    });
    const task = await this.loader.loadTask(tx, loaded.task.id);
    if (!joined) {
      await this.auditBranch(tx, loaded, branch.key, input);
      return {
        instance,
        task,
        advanced: false,
        replayed: false,
        from_stage_key: stage.key,
        to_stage_key: stage.key,
      };
    }

    const guard = firedGuard(stage, 'joined', data, definition.fields);
    if (guard && !guard.redirect_to) {
      // The join is reached but held: the timeline says why; a manager moves it.
      await this.events.append(tx, {
        store_id: ctx.store_id,
        instance_id: instance.id,
        type: 'guard_blocked',
        from_stage_key: stage.key,
        to_stage_key: stage.key,
        actor: { type: 'system', id: null },
        payload: { message: guard.message },
      });
      await this.auditBranch(tx, loaded, branch.key, input);
      return {
        instance,
        task,
        advanced: false,
        replayed: false,
        from_stage_key: stage.key,
        to_stage_key: stage.key,
      };
    }
    const transition = guard?.redirect_to
      ? { to: guard.redirect_to }
      : resolveTransition(stage, 'joined', data, definition.fields);
    if (!transition) throw new VendixHttpException(ErrorCodes.WORKFLOW_NO_TRANSITION);
    instance = await this.advancer.advance({
      tx,
      instance,
      definition,
      fromStage: stage,
      toStageKey: transition.to,
      data,
      actor: { type: 'system', id: null },
      expectedRowVersion: instance.row_version,
      runExitHooks: true,
      resolved: { submitted: false },
      doneTaskId: loaded.task.id,
      event: {
        type: guard ? 'guard_redirected' : 'joined',
        payload: {
          join: parallel.join,
          done: doneCount,
          total,
          ...(guard ? { message: guard.message, to: transition.to } : {}),
        },
      },
    });
    await this.auditBranch(tx, { ...loaded, instance }, branch.key, input);
    return {
      instance,
      task,
      advanced: true,
      replayed: false,
      from_stage_key: stage.key,
      to_stage_key: transition.to,
    };
  }

  /** The submission of one branch of a parallel stage is a decision too. */
  private auditBranch(
    tx: WorkflowTx,
    loaded: { task: WorkflowTaskRow; instance: WorkflowInstanceRow; stage: WorkflowStageDef },
    branchKey: string,
    input: CompleteTaskInput,
  ): Promise<void> {
    return this.auditDecision(tx, 'decision.task_completed', {
      instance: loaded.instance,
      task: loaded.task,
      stage: loaded.stage,
      outcome: 'submit',
      comment: input.comment,
      extra: { branch_key: branchKey },
    });
  }

  private stagesApply(
    stage: WorkflowStageDef,
    data: Record<string, unknown>,
    instance: WorkflowInstanceRow,
  ) {
    return this.stages.applyHooks([stage.on_submit], data, instance);
  }

  private async stagesEnqueue(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    stageKey: string,
    applied: ReturnType<WorkflowStageService['applyHooks']>,
  ): Promise<void> {
    for (const payload of applied.notifies) {
      await this.events.enqueue(tx, {
        store_id: instance.store_id,
        instance_id: instance.id,
        kind: 'notify',
        payload: payload as unknown as Record<string, unknown>,
      });
    }
    await this.stages.enqueueVendixActions(tx, instance, stageKey, applied.vendix);
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
