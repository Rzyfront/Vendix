import {
  PqrStatus,
  PqrType,
  PqrPriority,
} from '../../../../../shared/services/pqr.service';

export type { PqrStatus, PqrType, PqrPriority };

/**
 * Public-facing comment returned by `GET /pqr/:ticket_number`.
 * Renamed to `PublicPqrResponse` here to avoid colliding with the admin
 * `PqrComment` interface below (admin comments carry author_email +
 * is_internal + author_id; public ones are sanitized).
 */
export interface PublicPqrResponse {
  id: number;
  content: string;
  author_name: string;
  author_type: string;
  created_at: string | null;
}

/**
 * Admin-facing PQR record returned by `GET /store/support/pqr`.
 * Fields match the backend `toAdminView` mapper.
 */
export interface Pqr {
  id: number;
  ticket_number: string;
  title: string;
  status: PqrStatus;
  pqr_type: PqrType;
  priority: PqrPriority;
  assigned_to: {
    id: number;
    email: string;
    name: string;
  } | null;
  created_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  first_response_at: string | null;
}

export interface PqrComment {
  id: number;
  ticket_id: number;
  content: string;
  is_internal: boolean;
  author_id: number;
  author_type: string;
  author_name: string;
  author_email?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PqrStatusHistoryEntry {
  id: number;
  ticket_id: number;
  old_status: PqrStatus | null;
  new_status: PqrStatus;
  change_reason: string | null;
  change_notes: string | null;
  changed_by_user_id: number | null;
  created_at: string | null;
}

/**
 * Admin-facing detail payload from `GET /store/support/pqr/:id`.
 * Adds description + parsed requester info + comments + status history
 * on top of the list-shape `Pqr`.
 */
export interface PqrDetail extends Pqr {
  description: string;
  requester_name: string;
  requester_email: string;
  requester_phone?: string;
  comments: PqrComment[];
  status_history: PqrStatusHistoryEntry[];
}

export interface PqrStats {
  total: number;
  recent_24h: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_priority: Record<string, number>;
}

export interface PqrQuery {
  status?: PqrStatus;
  pqr_type?: PqrType;
  priority?: PqrPriority;
  search?: string;
  date_from?: string;
  date_to?: string;
  assigned_to_user_id?: number;
  page?: number;
  limit?: number;
}

export interface PqrUpdateDto {
  priority?: PqrPriority;
  assigned_to_user_id?: number;
  tags?: string[];
}

export interface PqrStatusUpdateDto {
  status: PqrStatus;
  change_reason?: string;
  resolution_summary?: string;
}

export interface PqrAssignDto {
  assigned_to_user_id: number;
  notes?: string;
}

export interface PqrCommentCreateDto {
  content: string;
  is_internal?: boolean;
  notify_requester?: boolean;
}

export interface PaginatedPqr {
  data: Pqr[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}