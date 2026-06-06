import type { ISODateString } from './common.types';

export interface AuditLog {
  id: string;
  user_id?: string;
  user_email?: string;
  user_name?: string;
  action: string;
  resource: string;
  resource_id?: string;
  description?: string;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;
  created_at: ISODateString;
}

export interface LoginAttempt {
  id: string;
  email: string;
  ip_address?: string;
  user_agent?: string;
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  failure_reason?: string;
  created_at: ISODateString;
}

export interface ActiveSession {
  id: string;
  user_id: string;
  user_email?: string;
  user_name?: string;
  ip_address?: string;
  user_agent?: string;
  device?: string;
  location?: string;
  is_current?: boolean;
  last_active_at: ISODateString;
  created_at: ISODateString;
  expires_at: ISODateString;
}

export interface AuditStats {
  total_logs: number;
  failed_logins_today: number;
  successful_logins_today: number;
  active_sessions: number;
}
