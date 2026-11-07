export const OUTBOX_BATCH = 20;
export const OUTBOX_MAX_ATTEMPTS = 6;
/** Delay before attempt 2..6 (minutes): 1m, 5m, 30m, 2h, 12h. */
export const OUTBOX_BACKOFF_MINUTES = [1, 5, 30, 120, 720];
