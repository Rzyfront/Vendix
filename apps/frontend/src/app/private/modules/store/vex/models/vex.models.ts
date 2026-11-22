export type VexMessageRole = 'user' | 'agent';

export type VexUiBlockKind =
  | 'table'
  | 'chart'
  | 'kpi'
  | 'image'
  | 'file'
  | 'markdown'
  | 'timeline'
  | 'list'
  // F4 T29: learning blocks (help center post, video, learning path).
  | 'help_article'
  | 'video'
  | 'learning_path'
  // F5 T34: batch write card
  | 'write_batch';

/**
 * A UI block Vex rendered inside a turn.
 *
 * `spec` describes HOW to render (columns, chart type, formats) and `data`
 * carries the payload. Both are server-owned: the backend stores the block
 * (`ai_ui_blocks`) so later turns can read/transform it by `block_id`.
 */
export interface VexUiBlock {
  block_id: string;
  kind: VexUiBlockKind;
  spec: VexBlockSpec;
  data: Record<string, unknown>;
  version: number;
}

export type VexBlockSpec =
  | VexTableSpec
  | VexChartSpec
  | VexKpiSpec
  | VexImageSpec
  | VexFileSpec
  | VexMarkdownSpec
  | VexTimelineSpec
  | VexListSpec
  | VexLearningSpec
  | VexWriteBatchSpec;

export interface VexTableColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'currency' | 'date' | 'datetime';
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
}

export interface VexTableSpec {
  kind: 'table';
  title?: string;
  columns: VexTableColumn[];
  /** Row selection enabled (default true). Selection emits a block interaction. */
  selectable?: boolean;
  page_size?: number;
}

export interface VexChartSeries {
  key: string;
  label?: string;
  /** Per-series geometry for `combo` charts (default: first bar, rest line). */
  type?: 'bar' | 'line';
}

export interface VexChartSpec {
  kind: 'chart';
  title?: string;
  chart_type:
    | 'bar'
    | 'line'
    | 'pie'
    | 'doughnut'
    | 'area'
    | 'radar'
    | 'scatter'
    | 'gauge'
    | 'rose'
    | 'stacked_bar'
    | 'combo'
    | 'funnel'
    | 'heatmap';
  /** Key of each row holding the category label (bar/line/area). */
  x_axis_key?: string;
  /** Keys of each row holding the series values. */
  series?: VexChartSeries[];
  stacked?: boolean;
}

export interface VexKpiSpec {
  kind: 'kpi';
  label: string;
  format?: 'currency' | 'number' | 'percent';
  icon?: string;
  /** Key of `data` holding the main value (default 'value'). */
  value_key?: string;
  delta_key?: string;
  delta_label?: string;
  /** When true the delta renders with inverted sentiment colors. */
  invert_delta?: boolean;
}

export interface VexImageSpec {
  kind: 'image';
  alt?: string;
  caption?: string;
}

export interface VexFileSpec {
  kind: 'file';
  filename?: string;
  mime_type?: string;
}

export interface VexMarkdownSpec {
  kind: 'markdown';
  title?: string;
}

export type VexBlockTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface VexTimelineSpec {
  kind: 'timeline';
  title?: string;
}

export interface VexTimelineEvent {
  id?: string;
  title: string;
  description?: string;
  /** ISO 8601 instant. */
  timestamp?: string;
  status?: VexBlockTone;
  actor?: string;
}

export interface VexTimelineData {
  events: VexTimelineEvent[];
}

export interface VexListSpec {
  kind: 'list';
  title?: string;
  layout?: 'cards' | 'rows';
}

export interface VexListItem {
  id?: string;
  title: string;
  subtitle?: string;
  description?: string;
  badge?: { label: string; tone?: VexBlockTone };
  fields?: Array<{ label: string; value: string | number }>;
}

export interface VexListData {
  items: VexListItem[];
}

/** F4 T29: payload lives in `data` (article / video / series), see CONTRACT. */
export interface VexLearningSpec {
  kind: 'help_article' | 'video' | 'learning_path';
  title?: string;
}

/** Table/chart payload shape: rows plus the total the server counted. */
export interface VexBlockTabularData {
  rows: Array<Record<string, unknown>>;
  total?: number;
}

/** What the user did on a block, sent to the next turn as context. */
export interface VexBlockInteraction {
  type: 'row_select' | 'chart_click' | 'filter';
  selection?: Array<Record<string, unknown>>;
  point?: Record<string, unknown>;
  filter?: Record<string, unknown>;
}

export type VexPlanStepStatus =
  | 'unknown'
  | 'pending'
  | 'approved'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped'
  /** Server-side: the plan was cancelled before this step ran. */
  | 'cancelled';

export interface VexPlanStepChange {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
}

/** One write inside a proposed plan, with its previewed diff. */
export interface VexPlanStep {
  step_id: string;
  tool: string;
  /** Human sentence describing the step ("Crear cotización Q-1024"). */
  summary: string;
  arguments?: Record<string, unknown>;
  preview?: {
    status: 'ok' | 'warning' | 'error';
    target: string;
    changes: VexPlanStepChange[];
    message?: string;
  };
  /** Irreversible steps always ask their own confirmation. */
  irreversible: boolean;
  /** Single-use token for the step's own confirmation, when the backend issued one. */
  confirmation_token?: string;
  status: VexPlanStepStatus;
  /** Server message when the step failed (`metadata.plan.steps[].error`). */
  error?: string;
}

export type VexPlanStatus =
  | 'unknown_effect'
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'done'
  /** Some steps applied, others failed or were left unapplied. */
  | 'partially_applied'
  | 'failed';

export interface VexPlanProposal {
  plan_id: string;
  title: string;
  steps: VexPlanStep[];
  status: VexPlanStatus;
}

export interface VexToolStep {
  id: string;
  name: string;
  summary?: string;
  status: 'running' | 'done' | 'failed' | 'waiting' | 'unknown';
}

export type VexFollowupKind = 'reminder' | 'log_entry';
export type VexFollowupStatus = 'suggested' | 'saved' | 'dismissed';

/**
 * A follow-up Vex suggested on its own (never written until the person saves
 * it). Persisted server-side in the message metadata, so it survives a reload.
 */
export interface VexFollowup {
  id: string;
  kind: VexFollowupKind;
  title: string;
  note?: string | null;
  /** ISO instant (UTC); `null` for a dateless log entry. */
  remind_at?: string | null;
  link_label?: string | null;
  source_phrase?: string | null;
  status: VexFollowupStatus;
  reminder_id?: number | null;
}

/** What the person changed on the card before saving. */
export interface VexFollowupEdits {
  title?: string;
  note?: string | null;
  /** Store-local wall clock `YYYY-MM-DDTHH:mm`, or `null` for no date. */
  remind_at?: string | null;
}

export interface VexMessage {
  id: string;
  role: VexMessageRole;
  content: string;
  created_at: Date;
  /** Blocks rendered inside this message, in arrival order. */
  blocks?: VexUiBlock[];
  /** Plan awaiting approval, when the turn proposed one. */
  plan?: VexPlanProposal | null;
  /** Live trace of the turn that produced this message. */
  tool_steps?: VexToolStep[];
  /** True while the stream is still appending to this message. */
  streaming?: boolean;
  /** Non-empty when the turn ended in an error. */
  error?: string | null;
  /** The conversation is blocked or busy: offer "Empezar de nuevo". */
  restart_suggested?: boolean;
  /** User message that never reached the server: offer «Reintentar». */
  send_failed?: boolean;
  /** Attachment handles sent with a user message, kept to resend them on retry. */
  attachment_ids?: string[];
  /** The answer was cut: offer «Reintentar» (resends the last user message). */
  can_retry?: boolean;
  /** Follow-ups Vex suggested in this turn (at most one per turn). */
  followups?: VexFollowup[];
}

/** `context_budget` of the `done` frame: how full the model window is for the next turn. */
export interface VexContextBudget {
  estimated_input_tokens: number;
  omitted_messages: number;
  context_window_tokens: number;
  provenance: 'configured' | 'fallback';
  method: 'conservative_estimate';
  /** Output the engine reserved for the answer. */
  max_output_tokens?: number;
  /** Percent at which the ring warns and the server compacts (≤ 75, under the engine ceiling). */
  compaction_percent?: number;
}

/** Rolling summary of the older part of a conversation (compaction). */
export interface VexCompaction {
  summary: string;
  /** Local message id (`m-<row id>`) after which the divider renders; null = top of the thread. */
  through_message_id: string | null;
}

export interface VexConversation {
  id: string;
  title: string;
  messages: VexMessage[];
  created_at: Date;
  updated_at: Date;
  status?: string;
  /** «No sugerir en este chat»: Vex stops suggesting follow-ups here. */
  followups_muted?: boolean;
  /** Not created on the server yet (its first message could not be sent). Hidden from the list. */
  local?: boolean;
}

export interface VexModelOption {
  id: string;
  label: string;
}

export const VEX_MODEL_OPTIONS: VexModelOption[] = [
  { id: 'vex-flash', label: 'Flash' },
  { id: 'vex-pro', label: 'Pro' },
];

// ── F5: write batch (one approval for up to 25 reversible writes) ──

/** `write_batch` blocks carry everything in `data`; the spec is empty. */
export type VexWriteBatchSpec = Record<string, never>;

/** `data` of a persisted `write_batch` block (the card re-fetches by id). */
export interface VexWriteBatchBlockData {
  batch_id: string;
  goal: string;
  part_index: number;
  part_total: number;
  step_count: number;
}

export type VexWriteBatchStatus =
  | 'proposed'
  | 'executing'
  | 'applied'
  | 'partially_applied'
  | 'failed'
  | 'unknown_effect'
  | 'rejected'
  | 'expired';

export type VexWriteBatchStepStatus =
  | 'pending'
  | 'running'
  | 'applied'
  | 'failed'
  | 'unknown'
  | 'skipped'
  | 'unselected'
  | 'cancelled'
  | 'compensating'
  | 'compensated'
  | 'compensation_failed';

export interface VexWriteBatchStep {
  step_id: string;
  order: number;
  tool: string;
  label: string;
  preview: {
    status: 'ok' | 'warning';
    target: string;
    changes: Array<{ field: string; label: string; from: unknown; to: unknown }>;
    message?: string;
    domain?: string;
  };
  compensable: boolean;
  can_undo: boolean;
  status: VexWriteBatchStepStatus;
  result_summary?: string;
  error?: string;
}

export interface VexWriteBatchSummary {
  applied: number;
  failed: number;
  unknown: number;
  skipped: number;
  unselected: number;
  compensable: number;
  applied_through_order: number;
  message: string;
}

/** Mirror of the backend `WriteBatchView` (fields the card uses). */
export interface VexWriteBatch {
  id: string;
  goal: string;
  status: VexWriteBatchStatus;
  part_index: number;
  part_total: number;
  step_count: number;
  steps: VexWriteBatchStep[];
  summary: VexWriteBatchSummary | null;
  undo_until: string | null;
  expires_at: string;
}

export interface VexWriteBatchResult {
  batch: VexWriteBatch;
  replayed: boolean;
}

/** T39: a prebuilt task offered in the welcome gallery «Tareas». */
export interface VexLaunchablePlaybook {
  id: string;
  title: string;
  description: string;
  prompt: string;
}
