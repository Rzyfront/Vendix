import { apiGet, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { AuditLog, LoginAttempt, ActiveSession, AuditStats } from '@/core/models/org-admin/audit.types';

export const OrgAuditService = {
  listLogs: async (params?: ListParams) =>
    apiGet<AuditLog[]>(Endpoints.ORGANIZATION.AUDIT.LOGS, params),
  listLoginAttempts: async (params?: ListParams) =>
    apiGet<LoginAttempt[]>(Endpoints.ORGANIZATION.AUDIT.LOGIN_ATTEMPTS, params),
  listSessions: async (params?: ListParams) =>
    apiGet<ActiveSession[]>(Endpoints.ORGANIZATION.AUDIT.SESSIONS, params),
  getUserSessions: async (userId: string) =>
    apiGet<ActiveSession[]>(Endpoints.ORGANIZATION.AUDIT.SESSIONS_USER.replace(':userId', userId)),
  getStats: async (): Promise<AuditStats> => {
    const [logs, attempts, sessions] = await Promise.all([
      apiGet<AuditLog[]>(Endpoints.ORGANIZATION.AUDIT.LOGS, { pageSize: 1 }),
      apiGet<LoginAttempt[]>(Endpoints.ORGANIZATION.AUDIT.LOGIN_ATTEMPTS, { pageSize: 1 }),
      apiGet<ActiveSession[]>(Endpoints.ORGANIZATION.AUDIT.SESSIONS, { pageSize: 1 }),
    ]);
    return {
      total_logs: (logs as any)?.length ?? 0,
      failed_logins_today: 0,
      successful_logins_today: 0,
      active_sessions: (sessions as any)?.length ?? 0,
    };
  },
};
