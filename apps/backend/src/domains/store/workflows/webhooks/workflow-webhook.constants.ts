/** Event types a store can subscribe an endpoint to (design §5.7). */
export const WORKFLOW_WEBHOOK_EVENTS = [
  'workflow.instance.started',
  'workflow.instance.transitioned',
  'workflow.instance.completed',
  'workflow.instance.rejected',
  'workflow.task.created',
  'workflow.task.completed',
  'workflow.task.overdue',
] as const;

export type WorkflowWebhookEvent = (typeof WORKFLOW_WEBHOOK_EVENTS)[number];

/** Sent by `POST :id/test`; not subscribable, always delivered to that endpoint. */
export const WORKFLOW_WEBHOOK_PING = 'ping';

export const MAX_ACTIVE_WEBHOOK_ENDPOINTS = 10;

export const WEBHOOK_SECRET_PREFIX = 'whsec_';

export const WEBHOOK_OUTBOX_KIND = 'webhook';

/** Error / body text stored on a delivery row is cut to this. */
export const WEBHOOK_STORED_TEXT_MAX = 500;

export interface WebhookBody {
  event_id: string;
  occurred_at: string;
  store_id: number;
  type: string;
  data: Record<string, unknown>;
}
