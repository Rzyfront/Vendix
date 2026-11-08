/** Thresholds of the platform alerts (P7.4). Each one is evaluated every ALERT_CRON. */
export const ALERT_CRON = '*/5 * * * *';
/** Held a bit under the cron period: one replica evaluates per tick, a crashed one never blocks the next. */
export const ALERT_LOCK_TTL_SECONDS = 240;
export const ALERT_LOCK_KEY = 'workflows:ops:alerts:lock';
/** One alert per rule per hour. */
export const ALERT_DEDUPE_TTL_SECONDS = 3600;
export const ALERT_DEDUPE_KEY_PREFIX = 'workflows:ops:alert:';

/** dispatcher_stalled: no heartbeat for this long while rows are due. */
export const STALLED_HEARTBEAT_SECONDS = 5 * 60;
/** backlog_lag: oldest due row waiting longer than this. */
export const BACKLOG_LAG_SECONDS = 10 * 60;
/** dead_letters: dead outbox rows in the last hour (inclusive). */
export const DEAD_LETTERS_PER_HOUR = 5;
/** webhook_failures: enough deliveries in the last hour, and this share of them failed. */
export const WEBHOOK_MIN_DELIVERIES_PER_HOUR = 20;
export const WEBHOOK_FAILED_SHARE = 0.5;
/** webhook_failures: or this many dead deliveries in the last hour (inclusive). */
export const WEBHOOK_DEAD_PER_HOUR = 5;
/** latency_p95: p95 of done rows in the last hour above this. */
export const LATENCY_P95_SECONDS = 5 * 60;

/** A `processing` row older than this counts as stuck (same window the dispatcher reclaims at). */
export const STUCK_PROCESSING_MINUTES = 10;
export const TOP_STORES_LIMIT = 10;
export const RECENT_DEAD_LIMIT = 20;
/** `last_error` shown on the screen: truncated, never a payload. */
export const LAST_ERROR_MAX_CHARS = 300;

export const ALERT_RULES = [
  'dispatcher_stalled',
  'backlog_lag',
  'dead_letters',
  'webhook_failures',
  'latency_p95',
] as const;
export type AlertRule = (typeof ALERT_RULES)[number];
