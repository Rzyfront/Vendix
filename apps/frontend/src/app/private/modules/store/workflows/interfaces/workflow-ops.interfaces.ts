/** Inbox ("Mis tareas"), board, comments and public-link contracts. */

export interface InboxTaskRow {
  task_id: number;
  kind: string;
  status: string;
  due_at: string | null;
  overdue: boolean;
  stage_key: string;
  stage_name: string;
  /** P2.1: the branch of a parallel stage this task belongs to. */
  branch_key?: string | null;
  branch_name?: string | null;
  instance: {
    id: number;
    reference: string;
    title: string;
    row_version: number;
  };
  definition: { id: number; name: string | null };
  assignee: { type: string; id: number; name: string | null } | null;
  quick_outcomes: string[];
}

export interface InboxQuery {
  page?: number;
  limit?: number;
  status?: 'open' | 'claimed';
  overdue?: boolean;
  definition_id?: number;
}

export interface BoardMove {
  to_stage_key: string;
  outcome: string;
  requires_modal: boolean;
}

export interface BoardCard {
  id: number;
  reference: string;
  title: string;
  status: string;
  version: number | null;
  stage_entered_at: string | null;
  stage_due_at: string | null;
  overdue: boolean;
  assignee: { type?: string; name?: string | null } | null;
  has_pending_requirements: boolean;
  row_version: number;
}

export interface BoardColumn {
  stage_key: string;
  name: string;
  type: string | null;
  legacy?: boolean;
  count: number;
  overdue_count: number;
  moves: BoardMove[];
  cards: BoardCard[];
  next_cursor: number | null;
}

export interface BoardData {
  definition: { id: number; name: string; version: number | null };
  columns: BoardColumn[];
}

export interface BoardQuery {
  column?: string;
  cursor?: number;
  limit?: number;
  assignee_user_id?: number;
  overdue?: boolean;
}

export interface InstanceComment {
  id: number;
  body: string;
  author: { id: number; name: string | null };
  created_at: string;
}

export interface PublicLinkStatus {
  active: boolean;
  created_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
}

export interface PublicLinkCreated {
  url_path: string;
  token: string;
}

/** KPIs of one flow (block 12). The same dataset feeds the screen and the XLSX. */
export interface AnalyticsKpis {
  started: number;
  completed: number;
  rejected: number;
  cancelled: number;
  active: number;
  overdue: number;
  cycle_avg_hours: number | null;
  cycle_p90_hours: number | null;
  /** 0..1 */
  on_time_rate: number | null;
}

export interface AnalyticsStage {
  stage_key: string;
  name: string;
  wip: number;
  entered: number;
  exited: number;
  avg_hours: number | null;
  p90_hours: number | null;
  overdue_now: number;
  on_time_rate: number | null;
  reject_rate: number | null;
}

export interface AnalyticsPerson {
  user_id: number;
  name: string;
  tasks_done: number;
  on_time_rate: number | null;
  avg_hours: number | null;
}

export interface AnalyticsDay {
  date: string;
  started: number;
  completed: number;
}

export interface WorkflowAnalytics {
  definition: { id: number; name: string };
  range: { from: string; to: string; timezone: string };
  kpis: AnalyticsKpis;
  stages: AnalyticsStage[];
  people: AnalyticsPerson[];
  bottleneck_stage_key: string | null;
  insufficient_data: boolean;
  daily: AnalyticsDay[];
  truncated: boolean;
}

export interface AnalyticsQuery {
  from?: string;
  to?: string;
}
