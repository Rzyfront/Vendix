export type PlatformAlertSeverity = 'info' | 'warning' | 'critical';
export type PlatformAlertStatus = 'open' | 'resolved';
export type PlatformAlertResolution =
  | 'auto_quiet'
  | 'recovered'
  | 'manual'
  | 'ticket_closed';

export type PlatformAlertStatusFilter = PlatformAlertStatus | 'all';

export type PlatformAlertCategory = 'plan_limit';

export interface PlatformAlertContextLine {
  label: string;
  value: string;
  href?: string | null;
}

export interface PlatformAlertView {
  id: number;
  source: string;
  process: string;
  error_type: string;
  severity: PlatformAlertSeverity;
  status: PlatformAlertStatus;
  title: string;
  message: string;
  details: Record<string, unknown> | null;
  organization_id: number | null;
  store_id: number | null;
  affected_store_ids: number[];
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  escalated_at: string | null;
  resolved_at: string | null;
  resolution: PlatformAlertResolution | null;
  ticket_number: string | null;
  ticket_status: string | null;
  telegram_sent: boolean;
  context: PlatformAlertContextLine[];
  scope_label: string;
  category: PlatformAlertCategory | null;
  kind_label: string;
}

export interface PlatformAlertsFilters {
  status: PlatformAlertStatusFilter;
  severity?: PlatformAlertSeverity;
  source?: string;
  search?: string;
  page: number;
  limit: number;
}

export interface PlatformAlertsPaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
}

export interface PlatformAlertsPage {
  data: PlatformAlertView[];
  meta: PlatformAlertsPaginationMeta;
}

export interface PlatformAlertsStats {
  open_critical: number;
  open_warning: number;
  open_info: number;
  last_24h: number;
  telegram_enabled: boolean;
  email_recipients: number;
}

export type PlatformTestAlertSeverity = 'warning' | 'critical';

export interface PlatformTestAlertResult {
  alert_id: number;
  occurrences: number;
  ticket_number: string | null;
  telegram_sent: boolean;
}
