import {
  apiGet,
  apiGetRaw,
  apiDelete,
  buildQuery,
  ListParams,
} from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type {
  ActiveSession,
  AuditLog,
  AuditStats,
  LoginAttempt,
  LoginAttemptsStats,
  PaginatedAuditResponse,
  PaginatedLoginAttemptsResponse,
  PaginatedSessionsResponse,
} from '@/core/models/org-admin/audit.types';

/**
 * Servicio de auditoría para el panel ORG_ADMIN.
 *
 * Backend:
 *   GET    /organization/audit/logs?limit&offset&resource&action&from_date&to_date&user_id&store_id
 *   GET    /organization/audit/stats?fromDate&toDate
 *   GET    /organization/audit/export?…      (text/csv)
 *   GET    /organization/login-attempts?page&limit&email&success&store_id
 *   GET    /organization/login-attempts/stats
 *   GET    /organization/sessions?page&limit&user_id&status(active|inactive)
 *   GET    /organization/sessions/user/:userId
 *   DELETE /organization/sessions/:id
 *   DELETE /organization/sessions/user/:userId
 *
 * El backend usa `limit/offset` para audit logs y `page/limit` para
 * login-attempts + sessions. Ambos se exponen unificados a través de
 * `paginatedLogs()` y los tipos `Paginated*Response`.
 *
 * ⚠️ Shape del envelope paginado del backend (ResponseService.paginated):
 *   { success: true, message: '...', data: T[], meta: { total, page, limit, totalPages } }
 *
 * `apiGet<T>` con `unwrap` retorna SOLO `payload.data` (el array) y
 * descarta `meta`. Para los endpoints paginados usamos `apiGetRaw` y
 * normalizamos manualmente a `{ data, meta }` — eso preserva `total` y
 * `totalPages` que el componente necesita para la PaginationBar.
 */
type RawPaginatedEnvelope<T> = {
  success?: boolean;
  message?: string;
  data: T[];
  meta?: { total: number; page: number; limit: number; totalPages: number };
};

async function fetchPaginated<T>(
  path: string,
  params: ListParams,
): Promise<{ data: T[]; meta?: RawPaginatedEnvelope<T>['meta'] }> {
  const envelope = await apiGetRaw<RawPaginatedEnvelope<T>>(path, params);
  return {
    data: Array.isArray(envelope?.data) ? envelope.data : [],
    meta: envelope?.meta,
  };
}

export const OrgAuditService = {
  // ─── Logs ────────────────────────────────────────────────────────────────

  listLogs: async (
    params?: ListParams & { from_date?: string; to_date?: string },
  ): Promise<PaginatedAuditResponse> =>
    fetchPaginated<AuditLog>(Endpoints.ORGANIZATION.AUDIT.LOGS, {
      limit: 50,
      offset: 0,
      ...params,
    }),

  getStats: async (): Promise<AuditStats> =>
    apiGet<AuditStats>(Endpoints.ORGANIZATION.AUDIT.LOGS_STATS),

  /**
   * Devuelve el body CSV como string. El backend setea `Content-Disposition`
   * con el nombre del archivo, pero el wrapper `apiGet` no expone headers;
   * generamos el filename local con la fecha del export.
   */
  exportLogsCsv: async (
    params?: Record<string, string | undefined>,
  ): Promise<{ filename: string; csv: string }> => {
    const csv = await apiGetRaw<string>(Endpoints.ORGANIZATION.AUDIT.LOGS_EXPORT, params);
    const filename = `audit_logs_${new Date().toISOString().split('T')[0]}.csv`;
    return { filename, csv };
  },

  // ─── Login Attempts ──────────────────────────────────────────────────────

  listLoginAttempts: async (
    params?: ListParams & { email?: string; success?: boolean },
  ): Promise<PaginatedLoginAttemptsResponse> =>
    fetchPaginated<LoginAttempt>(Endpoints.ORGANIZATION.AUDIT.LOGIN_ATTEMPTS, params ?? {}),

  getLoginAttemptsStats: async (): Promise<LoginAttemptsStats> =>
    apiGet<LoginAttemptsStats>(Endpoints.ORGANIZATION.AUDIT.LOGIN_ATTEMPTS_STATS),

  // ─── Sessions ────────────────────────────────────────────────────────────

  listSessions: async (
    params?: ListParams & { status?: 'active' | 'inactive' },
  ): Promise<PaginatedSessionsResponse> =>
    fetchPaginated<ActiveSession>(Endpoints.ORGANIZATION.AUDIT.SESSIONS, params ?? {}),

  getUserSessions: async (userId: string | number): Promise<ActiveSession[]> =>
    apiGet<ActiveSession[]>(
      Endpoints.ORGANIZATION.AUDIT.SESSIONS_USER.replace(':userId', String(userId)),
    ),

  terminateSession: async (id: string | number): Promise<void> => {
    await apiDelete<void>(
      Endpoints.ORGANIZATION.AUDIT.SESSIONS_TERMINATE.replace(':id', String(id)),
    );
  },

  terminateUserSessions: async (userId: string | number): Promise<void> => {
    await apiDelete<void>(
      Endpoints.ORGANIZATION.AUDIT.SESSIONS_TERMINATE_USER.replace(':userId', String(userId)),
    );
  },
};

// Re-export util para los screens que quieran componer queries custom.
export { buildQuery };
// Suppress unused warnings de tipos solo consumidos en service.
export type { AuditLog };
