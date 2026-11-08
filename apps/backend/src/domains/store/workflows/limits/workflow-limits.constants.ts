/** The plan limits of Flows that live in `subscription_plans.workflow_limits` (P7.1). */
export const WORKFLOW_LIMIT_KEYS = ['monthly_instances', 'monthly_http_calls', 'storage_bytes'] as const;
export type WorkflowLimitKey = (typeof WORKFLOW_LIMIT_KEYS)[number];

/** Limits that are monthly counters in `workflow_usage_counters` (storage is a live sum). */
export type WorkflowCounterMetric = 'monthly_instances' | 'monthly_http_calls';

const GIB = 1024 * 1024 * 1024;

/** Platform defaults: what a plan without `workflow_limits` gets. */
export const WORKFLOW_LIMIT_DEFAULTS: Record<WorkflowLimitKey, number> = {
  monthly_instances: 20_000,
  monthly_http_calls: 50_000,
  storage_bytes: 10 * GIB,
};

/** Share of the cap from which a meter turns to `warning`. */
export const WORKFLOW_USAGE_WARNING_PERCENT = 80;

/** Counter metric (never a limit key) that dedupes the monthly owner notice of a limit. */
export const workflowNoticeMetric = (metric: WorkflowCounterMetric): string => `notice:${metric}`;

/** Where the owner notice sends the person: the "Uso del plan" screen. */
export const WORKFLOW_USAGE_URL = '/admin/workflows/usage';

export const WORKFLOW_INSTANCES_NOTICE_TITLE =
  'Tus flujos llegaron al límite de solicitudes del plan este mes';
