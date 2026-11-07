import { Injectable } from '@nestjs/common';
import {
  WorkflowAssigneeDef,
  WorkflowDefinitionV1,
  WorkflowIssue,
  WorkflowStageDef,
  applyComputedFields,
  evaluateCondition,
  findStage,
  isHumanStage,
  normalizeDefinition,
  resolveTransition,
  stageOutcomes,
  startStage,
  validateFormValues,
  WorkflowExprOptions,
} from '@common/workflows/contract';
import {
  AppliedVendixAction,
  applyActionList,
  isBlockingRequirement,
  isFilledValue,
} from '../engine/workflow-rules';
import { firedGuard } from '../engine/workflow-guards';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowStageService } from '../engine/workflow-stage.service';
import { RequestContextService } from '@common/context/request-context.service';

const MAX_AUTOMATIC_HOPS = 20;
const WATERMARK = 'SIMULACIÓN';
/** What `{{instance.reference}}` / `{{instance.title}}` show in a simulation. */
const SIM_REFERENCE = 'SIM-0001';

export interface SimulateInput {
  state?: { stage_key: string; data: Record<string, unknown> };
  outcome?: string;
  values?: Record<string, unknown>;
  comment?: string;
  satisfied_requirements?: string[];
}

export interface SimulatedTask {
  stage_key: string;
  kind: string;
  assignee: { kind: string; label: string } | null;
}

export interface SimulationResult {
  valid: boolean;
  issues: WorkflowIssue[];
  form_errors: Array<{ field: string; message: string }>;
  comment_required: boolean;
  pending_requirements: Array<{ key: string; label: string }>;
  no_transition: boolean;
  from_stage: { key: string; name: string } | null;
  to_stage: { key: string; name: string; type: string } | null;
  transition: { on: string; label?: string; when_text?: string } | null;
  path: string[];
  data: Record<string, unknown>;
  tasks: SimulatedTask[];
  notifications: Array<{ to: string; message: string }>;
  /** `vendix.*` actions the run would queue; nothing is executed. */
  actions: AppliedVendixAction[];
  ended: { outcome: string } | null;
  loop_guard: boolean;
  /** P2.5: message of the guard that would hold the request. */
  guard_blocked?: string;
  watermark: typeof WATERMARK;
}

export function describeAssignee(a: WorkflowAssigneeDef | undefined): {
  kind: string;
  label: string;
} | null {
  if (!a) return null;
  switch (a.kind) {
    case 'initiator':
      return { kind: a.kind, label: 'Quien inició' };
    case 'role':
      return { kind: a.kind, label: `Rol: ${a.role_key}` };
    case 'group':
      return { kind: a.kind, label: `Grupo: ${a.group_key}` };
    case 'user':
      return { kind: a.kind, label: `Usuario #${a.user_id}` };
    case 'field':
      return { kind: a.kind, label: `Campo: ${a.field}` };
  }
}

function emptyResult(): SimulationResult {
  return {
    valid: true,
    issues: [],
    form_errors: [],
    comment_required: false,
    pending_requirements: [],
    no_transition: false,
    from_stage: null,
    to_stage: null,
    transition: null,
    path: [],
    data: {},
    tasks: [],
    notifications: [],
    actions: [],
    ended: null,
    loop_guard: false,
    watermark: WATERMARK,
  };
}

function ruleText(when: unknown): string | undefined {
  return when ? JSON.stringify(when) : undefined;
}

/**
 * Pure simulation on in-memory state, using the SAME contract functions as the
 * engine (form validation, transition resolution, action application). It
 * assumes the definition already passed `validateWorkflowDefinition`.
 * Mirrors `completeTask`: form → requirements → transition → comment →
 * `on_exit` / `on_enter` → automatic chain. Nothing is written or sent.
 */
export function simulateWorkflow(
  rawDefinition: WorkflowDefinitionV1,
  input: SimulateInput = {},
  exprOptions: WorkflowExprOptions = {},
): SimulationResult {
  const def = normalizeDefinition(rawDefinition);
  const res = emptyResult();
  const instanceRef = { reference: SIM_REFERENCE, title: def.name };

  let data: Record<string, unknown>;
  let current: WorkflowStageDef | undefined;

  if (!input.state) {
    // Start: the would-be first stage, its on_enter hooks and task.
    current = startStage(def);
    if (!current) {
      res.no_transition = true;
      return res;
    }
    const enter = applyActionList(current.on_enter, {}, instanceRef);
    data = enter.data;
    res.from_stage = { key: current.key, name: current.name };
    res.to_stage = { key: current.key, name: current.name, type: current.type };
    res.path = [current.key];
    collectEntry(res, current, enter.notifies);
    res.actions.push(...enter.vendix);
  } else {
    current = findStage(def, input.state.stage_key);
    if (!current) {
      res.no_transition = true;
      return res;
    }
    const outcome = input.outcome ?? '';
    res.from_stage = { key: current.key, name: current.name };
    data = { ...(input.state.data ?? {}) };

    // Form (decisions that send the case back / reject need no values).
    if (current.form?.fields.length && !['reject', 'return'].includes(outcome)) {
      const form = validateFormValues(def, current, input.values ?? {});
      if (!form.ok) {
        res.form_errors = form.errors;
        res.data = data;
        return res;
      }
      data = { ...data, ...form.values };
    }
    data = applyComputedFields(def, data, exprOptions);
    res.data = data;

    if (!stageOutcomes(current).includes(outcome)) {
      res.no_transition = true;
      return res;
    }

    // Exit requirements: only approve / submit are blocked.
    if (outcome === 'approve' || outcome === 'submit') {
      const satisfied = new Set(input.satisfied_requirements ?? []);
      for (const req of current.requirements ?? []) {
        if (!isBlockingRequirement(req)) continue;
        const ok =
          satisfied.has(req.key) ||
          (req.kind === 'file_field' && isFilledValue(data[req.field]));
        if (!ok) res.pending_requirements.push({ key: req.key, label: req.label });
      }
    }

    const guard = firedGuard(current, outcome, data, def.fields);
    if (guard && !guard.redirect_to) {
      res.guard_blocked = guard.message;
      return res;
    }
    const transition = guard?.redirect_to
      ? { to: guard.redirect_to, on: outcome }
      : resolveTransition(current, outcome, data, def.fields);
    if (!transition) res.no_transition = true;
    else {
      res.transition = {
        on: transition.on,
        ...('label' in transition && transition.label ? { label: transition.label } : {}),
        ...('when' in transition && transition.when ? { when_text: ruleText(transition.when) } : {}),
      };
      if ('require_comment' in transition && transition.require_comment && !input.comment?.trim()) {
        res.comment_required = true;
      }
    }
    if (
      res.pending_requirements.length > 0 ||
      res.no_transition ||
      res.comment_required ||
      !transition
    ) {
      return res;
    }

    const submitted = outcome === 'submit' || outcome === 'approve';
    const exit = leaveStage(res, current, data, instanceRef, submitted);
    res.path = [current.key];
    data = exit;
    current = enterStage(res, def, transition.to, data, instanceRef);
    if (!current) return res;
    data = res.data;
  }

  // Stages the engine resolves by itself run on their own (capped here): a
  // wait elapses at once, a subflow is assumed completed, a loop counts laps.
  const SYSTEM_OUTCOME: Record<string, string> = {
    automatic: 'auto',
    wait: 'elapsed',
    subflow: 'completed',
  };
  const laps: Record<string, number> = {};
  let hops = 0;
  while (current && (SYSTEM_OUTCOME[current.type] || current.type === 'loop')) {
    if (hops++ >= MAX_AUTOMATIC_HOPS) {
      res.loop_guard = true;
      break;
    }
    let outcome = SYSTEM_OUTCOME[current.type];
    if (current.type === 'loop' && current.loop) {
      const n = laps[current.key] ?? 0;
      const again = evaluateCondition(current.loop.while, data, def.fields) && n < current.loop.max_iterations;
      laps[current.key] = again ? n + 1 : 0;
      outcome = again ? 'continue' : 'done';
    }
    const guard = firedGuard(current, outcome, data, def.fields);
    if (guard && !guard.redirect_to) {
      res.guard_blocked = guard.message;
      break;
    }
    const t = guard?.redirect_to
      ? { to: guard.redirect_to }
      : resolveTransition(current, outcome, data, def.fields);
    if (!t) {
      res.no_transition = true;
      break;
    }
    const exit = leaveStage(res, current, data, instanceRef, false);
    current = enterStage(res, def, t.to, exit, instanceRef);
    if (!current) break;
    data = res.data;
  }
  res.data = applyComputedFields(def, data, exprOptions);
  return res;
}

/** P2.6: on_submit (when a person submitted) → on_complete → on_exit. */
function leaveStage(
  res: SimulationResult,
  stage: WorkflowStageDef,
  data: Record<string, unknown>,
  instanceRef: { reference: string; title: string },
  submitted: boolean,
): Record<string, unknown> {
  let next = data;
  for (const list of [submitted ? stage.on_submit : undefined, stage.on_complete, stage.on_exit]) {
    if (!list?.length) continue;
    const applied = applyActionList(list, next, instanceRef);
    res.notifications.push(...notifyList(applied.notifies));
    res.actions.push(...applied.vendix);
    next = applied.data;
  }
  return next;
}

function notifyList(
  notifies: Array<{ message: string; to: WorkflowAssigneeDef }>,
) {
  return notifies.map((n) => ({
    to: describeAssignee(n.to)?.label ?? '',
    message: n.message,
  }));
}

function collectEntry(
  res: SimulationResult,
  stage: WorkflowStageDef,
  notifies: Array<{ message: string; to: WorkflowAssigneeDef }>,
) {
  res.notifications.push(...notifyList(notifies));
  if (isHumanStage(stage)) {
    res.tasks.push({
      stage_key: stage.key,
      kind: stage.type,
      assignee: describeAssignee(stage.assignee),
    });
  }
  for (const branch of stage.parallel?.branches ?? []) {
    res.tasks.push({
      stage_key: stage.key,
      kind: 'form',
      assignee: describeAssignee(branch.assignee),
    });
  }
  if (stage.type === 'end') res.ended = { outcome: stage.outcome ?? 'completed' };
}

function enterStage(
  res: SimulationResult,
  def: WorkflowDefinitionV1,
  toKey: string,
  data: Record<string, unknown>,
  instanceRef: { reference: string; title: string },
): WorkflowStageDef | undefined {
  const stage = findStage(def, toKey);
  if (!stage) {
    res.no_transition = true;
    res.data = data;
    return undefined;
  }
  const enter = applyActionList(stage.on_enter, data, instanceRef);
  res.actions.push(...enter.vendix);
  res.data = enter.data;
  res.path.push(stage.key);
  res.to_stage = { key: stage.key, name: stage.name, type: stage.type };
  collectEntry(res, stage, enter.notifies);
  return stage;
}

/** `POST store/workflows/definitions/:id/simulate`: validates, then simulates. */
@Injectable()
export class WorkflowSimulatorService {
  constructor(
    private readonly definitions: WorkflowDefinitionsService,
    private readonly stages: WorkflowStageService,
  ) {}

  async simulate(
    id: number,
    input: SimulateInput & { definition?: Record<string, unknown> },
  ): Promise<SimulationResult> {
    const definition =
      input.definition ?? (await this.definitions.getDraft(id)).definition;
    const check = await this.definitions.validateDefinition(definition);
    if (!check.valid) {
      return { ...emptyResult(), valid: false, issues: check.errors };
    }
    // P2.9: `today()` follows the store's calendar, as in the engine.
    const storeId = RequestContextService.getContext()?.store_id;
    const timeZone = storeId ? await this.stages.storeTimezone(storeId) : undefined;
    const result = simulateWorkflow(
      definition as unknown as WorkflowDefinitionV1,
      input,
      timeZone ? { timeZone } : {},
    );
    return { ...result, issues: check.warnings };
  }
}
