export const OUTBOX_BATCH = 20;
export const OUTBOX_MAX_ATTEMPTS = 6;
/** Delay before attempt 2..6 (minutes): 1m, 5m, 30m, 2h, 12h. */
export const OUTBOX_BACKOFF_MINUTES = [1, 5, 30, 120, 720];

/** A cycle keeps draining batches until the queue is empty or this much time passed. */
export const DISPATCHER_CYCLE_BUDGET_MS = 50_000;
/** Redis key where each cycle leaves its heartbeat (read by the superadmin screen and alerts). */
export const DISPATCHER_HEARTBEAT_KEY = 'workflows:dispatcher:heartbeat';
/** The heartbeat outlives a long outage so "last cycle" stays readable. */
export const DISPATCHER_HEARTBEAT_TTL_SECONDS = 24 * 60 * 60;
