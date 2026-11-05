/** Inbox ("Mis tareas"), board, comments and public-link contracts. */

export interface InboxTaskRow {
  task_id: number;
  kind: string;
  status: string;
  due_at: string | null;
  overdue: boolean;
  stage_key: string;
  stage_name: string;
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
