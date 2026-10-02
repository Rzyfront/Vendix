export type VexMessageRole = 'user' | 'agent';

export type VexUiBlockKind =
  | 'table'
  | 'chart'
  | 'kpi'
  | 'image'
  | 'file'
  | 'markdown';

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
  | VexMarkdownSpec;

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
}

export interface VexChartSpec {
  kind: 'chart';
  title?: string;
  chart_type: 'bar' | 'line' | 'pie' | 'doughnut' | 'area' | 'radar' | 'scatter' | 'gauge';
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
  status: 'running' | 'done' | 'failed';
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
}

export interface VexConversation {
  id: string;
  title: string;
  messages: VexMessage[];
  created_at: Date;
  updated_at: Date;
  status?: string;
}

export type VexLogCategory = 'sale' | 'inventory' | 'cash' | 'alert' | 'agent';

export interface VexLogEvent {
  id: string;
  category: VexLogCategory;
  title: string;
  description: string;
  created_at: Date;
  is_new: boolean;
}

export interface VexModelOption {
  id: string;
  label: string;
}

export const VEX_MODEL_OPTIONS: VexModelOption[] = [
  { id: 'vex-flash', label: 'Flash' },
  { id: 'vex-pro', label: 'Pro' },
];

export const VEX_LOG_CATEGORY_META: Record<
  VexLogCategory,
  { label: string; icon: string }
> = {
  sale: { label: 'Ventas', icon: 'shopping-cart' },
  inventory: { label: 'Inventario', icon: 'package' },
  cash: { label: 'Caja', icon: 'wallet' },
  alert: { label: 'Alertas', icon: 'bell' },
  agent: { label: 'Vex', icon: 'sparkles' },
};
