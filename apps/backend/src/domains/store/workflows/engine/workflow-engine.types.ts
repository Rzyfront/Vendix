import {
  WorkflowAssigneeDef,
  WorkflowDefinitionV1,
  WorkflowStageDef,
} from '@common/workflows/contract';

/** Scoped transaction client (`StorePrismaService.$transaction` callback arg). */
export type WorkflowTx = any;

export type WorkflowActorType = 'user' | 'public' | 'system' | 'ai';

export interface WorkflowActor {
  type: WorkflowActorType;
  id: number | null;
}

export type WorkflowInstanceStatus =
  | 'active'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'failed';

export interface WorkflowInstanceRow {
  id: number;
  organization_id: number;
  store_id: number;
  definition_id: number;
  version_id: number;
  reference: string;
  title: string;
  status: WorkflowInstanceStatus;
  current_stage_key: string;
  stage_entered_at: Date;
  stage_due_at: Date | null;
  stage_entry_seq: number;
  stage_last_reminded_at: Date | null;
  stage_escalated_at: Date | null;
  cancel_reason: string | null;
  data: Record<string, unknown>;
  subject_type: string | null;
  subject_id: number | null;
  started_by_type: WorkflowActorType;
  started_by_id: number | null;
  row_version: number;
  completed_at: Date | null;
  /** P2: engine state (loop counters, failed subflow entries). */
  runtime?: WorkflowInstanceRuntime | null;
  /** P2.2: the request that launched this one as a subflow. */
  parent_instance_id?: number | null;
  parent_stage_key?: string | null;
  parent_entry_seq?: number | null;
  /** P5.5: branch (`inventory_locations`) the request belongs to. */
  location_id?: number | null;
}

export interface WorkflowInstanceRuntime {
  /** Laps taken by each loop stage since it last finished. */
  loops?: Record<string, number>;
  /** Stage entry seq (as string key `<stage>:<seq>`) whose subflow could not start. */
  subflow_failed?: Record<string, string>;
}

export type WorkflowTaskStatus =
  | 'open'
  | 'claimed'
  | 'done'
  | 'cancelled'
  | 'expired';

export interface WorkflowTaskRow {
  id: number;
  organization_id: number;
  store_id: number;
  instance_id: number;
  stage_key: string;
  stage_entry_seq: number;
  kind: 'form' | 'approval' | 'review';
  status: WorkflowTaskStatus;
  assignee_user_id: number | null;
  assignee_role_id: number | null;
  assignee_group_id: number | null;
  claimed_at: Date | null;
  due_at: Date | null;
  outcome: string | null;
  outcome_comment: string | null;
  completed_by_user_id: number | null;
  completed_at: Date | null;
  /** P2.1: branch of a parallel stage. */
  branch_key?: string | null;
}

export interface AssigneeFields {
  assignee_user_id: number | null;
  assignee_role_id: number | null;
  assignee_group_id: number | null;
}

export interface AssignmentResult {
  fields: AssigneeFields;
  /** True when nobody could be resolved and a fallback was used. */
  unassigned: boolean;
  reason?: string;
  fallback?: 'escalate_to' | 'owner' | 'none';
}

/** Payload of a `notify` outbox row; recipients are resolved at dispatch. */
export interface WorkflowNotifyPayload {
  title: string;
  message: string;
  def?: WorkflowAssigneeDef;
  task_ids?: number[];
  user_ids?: number[];
  /** Recipients to leave out (e.g. the author of a comment). */
  exclude_user_ids?: number[];
}

export interface WorkflowLoaded {
  instance: WorkflowInstanceRow;
  definition: WorkflowDefinitionV1;
  stage: WorkflowStageDef;
}

export interface PendingRequirement {
  key: string;
  label: string;
}

/**
 * Evaluates the exit requirements of a stage. The engine depends on this
 * abstract class (DI token) so the documents block can plug real evaluation
 * for `upload`, `issued_document` and `signature` without touching the engine.
 */
export abstract class WorkflowRequirementsService {
  abstract pendingRequirements(
    instance: Pick<WorkflowInstanceRow, 'id' | 'data' | 'current_stage_key'> &
      Partial<WorkflowInstanceRow>,
    stage: WorkflowStageDef,
    tx?: WorkflowTx,
  ): Promise<PendingRequirement[]>;
}

/** Thrown by the events writer when `(store_id, idempotency_key)` collides. */
export class WorkflowIdempotencyConflict extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key already used: ${idempotencyKey}`);
  }
}

/** Permanent failure: the outbox must not retry it (it ends `dead`). */
export class WorkflowNonRetryableError extends Error {}

export interface StartWorkflowInput {
  definitionId?: number;
  definitionKey?: string;
  title?: string;
  data?: Record<string, unknown>;
  subject?: { type: string; id: number } | null;
  /** P5.5: branch of the request; must belong to the store. */
  locationId?: number | null;
  idempotencyKey?: string;
}

export interface CompleteTaskInput {
  taskId: number;
  outcome: string;
  values?: Record<string, unknown>;
  comment?: string | null;
  expectedRowVersion: number;
  idempotencyKey?: string;
}

export interface WorkflowCommandResult {
  instance: WorkflowInstanceRow;
  task: WorkflowTaskRow | null;
  /** False for a recorded quorum vote that did not move the instance yet. */
  advanced: boolean;
  /** True when an idempotency key replayed the original result. */
  replayed: boolean;
  from_stage_key: string | null;
  to_stage_key: string | null;
}

/**
 * Public submission of a start form. Only `WorkflowPublicFormService` builds
 * it; the engine re-checks the link inside the transaction.
 */
export interface StartPublicWorkflowInput {
  linkId: number;
  definitionId: number;
  values: Record<string, unknown>;
  contact: { name: string; email?: string | null; phone?: string | null };
  idempotencyKey: string;
  /**
   * P3.4: file fields of the start form with a completed upload of this link
   * (checked by the caller); the files join the dossier after the start.
   */
  fileFields?: string[];
}

/**
 * System start from a business event (actor `system`). Built only by the
 * outbox dispatcher from a `start_instance` row; the engine re-checks that the
 * published version still has a matching `event` trigger.
 */
/**
 * P3: start from outside Vendix (actor `system`). `webhook` checks `values`
 * against the declared fields; `email` and `record_date` fill fields from the
 * trigger `map` over `context` (`{{email.<key>}}` / `{{record.<key>}}`).
 */
export interface StartExternalWorkflowInput {
  definitionId: number;
  kind: 'webhook' | 'email' | 'record_date';
  /** `webhook` only: field key → value, checked like a form. */
  values?: Record<string, unknown>;
  /** `email` / `record_date`: flat context the trigger map reads. */
  context?: Record<string, unknown>;
  /** `record_date` only: the date field of the trigger that fired. */
  recordField?: string;
  subject?: { type: string; id: number } | null;
  /** Raw key; the engine namespaces it as a system key. */
  idempotencyKey: string;
  /** Extra data of the `started` event (`via` is set from `kind`). */
  started?: Record<string, unknown>;
  /** Title of the request (default: the flow name). */
  title?: string;
}

export interface StartSystemWorkflowInput {
  definitionId: number;
  event: string;
  /** Flat context with exactly the keys of `WORKFLOW_EVENT_TOKENS[event]`. */
  eventContext: Record<string, unknown>;
  idempotencyKey: string;
}
