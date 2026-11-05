import { WorkflowFieldDef } from '../../../../../shared/workflows/contract/workflow-contract';

/** Paginated envelope of `ResponseService.paginated()`. */
export interface PaginatedApiResponse<T> {
  success: boolean;
  message?: string;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export type WorkflowDefinitionStatus = 'draft' | 'published' | 'archived';

export interface WorkflowDefinitionRow {
  id: number;
  key: string;
  name: string;
  description: string | null;
  status: WorkflowDefinitionStatus;
  published_version: { version: number; published_at: string } | null;
  has_unpublished_changes: boolean;
  updated_at: string;
}

export interface WorkflowIssueView {
  code: string;
  path: string;
  message: string;
  stage_key?: string;
}

export interface ValidateDefinitionResult {
  valid: boolean;
  errors: WorkflowIssueView[];
  warnings: WorkflowIssueView[];
}

export interface PublishResult {
  unchanged: boolean;
  version: number;
  warnings: WorkflowIssueView[];
}

export interface ExportDefinitionResult {
  source: unknown;
  definition: unknown;
}

export interface CreateDefinitionBody {
  name: string;
  key?: string;
  description?: string;
  definition?: unknown;
}

export type WorkflowInstanceStatus =
  | 'active'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'failed';

export interface WorkflowInstanceRow {
  id: number;
  reference: string;
  title: string;
  status: WorkflowInstanceStatus;
  definition_name: string;
  version: number;
  current_stage_name: string | null;
  stage_due_at: string | null;
  overdue: boolean;
  created_at: string;
}

export interface WorkflowInstanceQuery {
  page?: number;
  limit?: number;
  definition_id?: number;
  status?: string;
  overdue?: boolean;
  search?: string;
}

export interface StartInstanceBody {
  definition_id: number;
  title?: string;
  data?: Record<string, unknown>;
}

export interface StartInstanceResult {
  id: number;
  reference?: string;
  replayed?: boolean;
}

export interface StageRequirementView {
  key: string;
  kind: string;
  label: string;
  accept?: string[];
  max_size_mb?: number;
  blocks_exit?: boolean;
}

export interface TaskAssigneeView {
  type: string;
  id: number | null;
  name: string | null;
}

export interface TaskView {
  id: number;
  status: string;
  assignee: TaskAssigneeView | null;
  claimed_at: string | null;
  due_at: string | null;
  can_act: boolean;
}

export interface TimelineEventView {
  seq: number;
  type: string;
  from_stage_key: string | null;
  to_stage_key: string | null;
  actor_name: string | null;
  payload: Record<string, unknown> | null;
  occurred_at: string;
}

export interface DossierItemView {
  id: number;
  kind: string;
  requirement_key: string | null;
  field_key: string | null;
  stage_key: string | null;
  status: string;
  supersedes_id: number | null;
  created_at: string;
  file: {
    id: number;
    original_name: string;
    mime_type: string;
    size_bytes: number | string;
    sha256: string;
  } | null;
}

export interface InstanceStageView {
  key: string;
  name: string;
  type: string;
  description: string | null;
  form_fields: WorkflowFieldDef[];
  requirements: StageRequirementView[];
}

export interface WorkflowInstanceDetail {
  id: number;
  reference: string;
  title: string;
  status: WorkflowInstanceStatus;
  row_version: number;
  current_stage_key: string | null;
  stage_entered_at: string | null;
  stage_due_at: string | null;
  data: Record<string, unknown>;
  started_by: { name: string } | null;
  created_at: string;
  completed_at: string | null;
  definition: { id: number; name: string; version: number };
  stage: InstanceStageView | null;
  tasks: TaskView[];
  timeline: TimelineEventView[];
  pending_requirements: { key: string; label: string }[];
  allowed_outcomes: string[];
  dossier: { id: number; reference: string; items: DossierItemView[] } | null;
}

export interface CompleteTaskBody {
  outcome: string;
  values?: Record<string, unknown>;
  comment?: string;
  expected_row_version: number;
}

export interface UploadedFileResult {
  file_id: number;
  [key: string]: unknown;
}

export interface FileDownloadResult {
  url: string;
  expires_in: number;
  original_name: string;
  mime_type: string;
  sha256: string;
}

/** Error as the facade shows it: parsed code + user-facing message. */
export interface WorkflowApiError {
  code: string | null;
  message: string;
  status: number | null;
  details: unknown;
}
