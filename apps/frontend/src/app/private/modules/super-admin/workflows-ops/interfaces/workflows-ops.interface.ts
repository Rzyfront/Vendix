export interface LatencyPercentiles {
  p50_seconds: number | null;
  p95_seconds: number | null;
  samples: number;
}

export interface StoreCount {
  store_id: number;
  store_name: string;
  count: number;
}

export interface RecentDeadRow {
  id: string;
  store_id: number;
  store_name: string;
  kind: string;
  attempts: number;
  last_error: string | null;
  processed_at: string | null;
}

export interface DispatcherCycle {
  at: string;
  processed: number;
  batches: number;
  duration_ms: number;
  age_seconds: number;
}

export interface WorkflowOpsMetrics {
  generated_at: string;
  outbox: {
    by_status: Record<string, number>;
    by_kind: Array<{ kind: string; status: string; count: number }>;
    pending: number;
    processing: number;
    backlog_due: number;
    oldest_due_age_seconds: number | null;
    stuck_processing: number;
    dead_1h: number;
    dead_24h: number;
    latency_1h: LatencyPercentiles;
  };
  webhooks: {
    by_status_24h: Record<string, number>;
    success_rate_24h: number | null;
    latency_24h: LatencyPercentiles;
    dead_total: number;
  };
  inbound: { accepted_24h: number; rejected_24h: number };
  top_stores: { by_backlog: StoreCount[]; by_dead_24h: StoreCount[] };
  recent_dead: RecentDeadRow[];
  dispatcher: DispatcherCycle | null;
}

export type WorkflowOpsRule =
  | 'dispatcher_stalled'
  | 'backlog_lag'
  | 'dead_letters'
  | 'webhook_failures'
  | 'latency_p95';

export interface WorkflowOpsAlert {
  id: number;
  rule: WorkflowOpsRule | string;
  severity: 'warning' | 'critical';
  title: string;
  details: Record<string, number | null>;
  recipients: number;
  created_at: string;
}

export interface WorkflowOpsAlertsPage {
  alerts: WorkflowOpsAlert[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
