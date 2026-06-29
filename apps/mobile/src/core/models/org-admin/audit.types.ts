import type { ISODateString } from './common.types';

// ─────────────────────────────────────────────────────────────────────────────
// Enums (espejo de apps/frontend/src/app/private/modules/organization/audit/interfaces/audit.interface.ts)
//
// Renombrados como `AuditLogAction` / `AuditLogResource` para no colisionar con
// los `AuditAction` / `AuditResource` más genéricos que ya viven en
// `common.types.ts` (usados por orders/POS/etc.).
// ─────────────────────────────────────────────────────────────────────────────

export type AuditLogAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'PASSWORD_CHANGE'
  | 'EMAIL_VERIFY'
  | 'ONBOARDING_COMPLETE'
  | 'PERMISSION_CHANGE'
  | 'LOGIN_FAILED'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_UNLOCKED'
  | 'SUSPICIOUS_ACTIVITY'
  | 'PASSWORD_RESET'
  | 'VIEW'
  | 'SEARCH';

export type AuditLogResource =
  | 'users'
  | 'organizations'
  | 'stores'
  | 'domain_settings'
  | 'products'
  | 'orders'
  | 'auth'
  | 'roles'
  | 'permissions'
  | 'system'
  | 'settings';

// ─────────────────────────────────────────────────────────────────────────────
// Audit Log
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface AuditStore {
  id: number;
  name: string;
  slug: string;
}

export interface AuditLog {
  id: number | string;
  user_id?: number;
  user_email?: string;
  user_name?: string;
  store_id?: number;
  organization_id?: number;
  action: AuditLogAction | string;
  resource: AuditLogResource | string;
  resource_id?: number | string;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  description?: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at: ISODateString;
  users?: AuditUser;
  stores?: AuditStore;
}

export interface AuditStats {
  total_logs: number;
  logs_by_action: Record<string, number>;
  logs_by_resource: Record<string, number>;
  /** Formato `CREATE_users`, `UPDATE_settings`, etc. */
  logs_by_action_and_resource: Record<string, number>;
}

export interface AuditQueryParams {
  page?: number;
  limit?: number;
  /** Backend usa `limit/offset` para /audit/logs */
  offset?: number;
  action?: AuditLogAction | string;
  resource?: AuditLogResource | string;
  from_date?: string;
  to_date?: string;
  user_id?: number;
  store_id?: number;
  /** Filtro de búsqueda libre (delegado al backend si lo soporta). */
  search?: string;
  [key: string]: unknown;
}

export interface AuditPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedAuditResponse {
  data: AuditLog[];
  meta?: AuditPagination;
}

// ─────────────────────────────────────────────────────────────────────────────
// Login Attempt
// ─────────────────────────────────────────────────────────────────────────────

export type LoginAttemptStatus = 'SUCCESS' | 'FAILED' | 'BLOCKED';

export interface LoginAttempt {
  id: string | number;
  email: string;
  ip_address?: string;
  user_agent?: string;
  status: LoginAttemptStatus;
  /** Espejo del backend NestJS que serializa booleanos, no enums. */
  success?: boolean;
  failure_reason?: string;
  created_at: ISODateString;
  attempted_at?: ISODateString;
  stores?: AuditStore;
}

export interface LoginAttemptsStats {
  total_attempts: number;
  successful_attempts: number;
  failed_attempts: number;
  /** 0-100, porcentaje redondeado por el backend. */
  success_rate: number;
}

export interface LoginAttemptsQueryParams {
  page?: number;
  limit?: number;
  email?: string;
  success?: boolean;
}

export interface PaginatedLoginAttemptsResponse {
  data: LoginAttempt[];
  meta?: AuditPagination;
}

// ─────────────────────────────────────────────────────────────────────────────
// Active Session
// ─────────────────────────────────────────────────────────────────────────────

export interface ActiveSession {
  id: string | number;
  user_id: string | number;
  user_email?: string;
  user_name?: string;
  ip_address?: string;
  user_agent?: string;
  device?: string;
  location?: string;
  /** El backend serializa booleanos. `true` = activa, `false` = revocada/expirada. */
  is_active?: boolean;
  is_current?: boolean;
  last_active_at?: ISODateString;
  last_activity?: ISODateString;
  created_at: ISODateString;
  expires_at: ISODateString;
  users?: AuditUser;
}

export interface SessionsQueryParams {
  page?: number;
  limit?: number;
  status?: 'active' | 'inactive';
}

export interface PaginatedSessionsResponse {
  data: ActiveSession[];
  meta?: AuditPagination;
}
