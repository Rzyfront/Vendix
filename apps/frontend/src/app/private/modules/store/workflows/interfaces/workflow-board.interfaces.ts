import { StartInstanceBody } from './workflow.interfaces';

/** P5.5 — general board (every flow), filters and branches ("sedes"). */

export type BoardAllColumnKey = 'pending' | 'in_progress' | 'system' | 'closed';

export interface BoardAllCard {
  id: number;
  reference: string;
  title: string;
  status: string;
  definition: { id: number; name: string | null };
  stage_key: string;
  stage_name: string | null;
  assignee: { type: string; id: number; name: string | null } | null;
  stage_due_at: string | null;
  overdue: boolean;
  location: { id: number; name: string | null } | null;
}

export interface BoardAllColumn {
  key: BoardAllColumnKey;
  name: string;
  count: number;
  cards: BoardAllCard[];
  next_cursor: number | null;
}

export interface BoardAllData {
  columns: BoardAllColumn[];
}

export interface BoardAllQuery {
  column?: BoardAllColumnKey;
  cursor?: number;
  limit?: number;
  definition_id?: number;
  role_id?: number;
  location_id?: number;
  assignee_user_id?: number;
  overdue?: boolean;
}

export interface BoardFilterOption {
  id: number;
  name: string;
}

export interface BoardFilters {
  definitions: BoardFilterOption[];
  roles: BoardFilterOption[];
  locations: BoardFilterOption[];
}

/** Fields the inbox payload gained for the mobile quick actions. */
export interface StartInstanceWithLocation extends StartInstanceBody {
  location_id?: number;
}

/** P5.6 — what the live stream says changed (ids only). */
export interface WorkflowLiveEvent {
  /** `resync`: the stream reconnected, anything may have changed. */
  kind: 'event' | 'task' | 'resync';
  instance_id: number | null;
  task_id?: number;
}
