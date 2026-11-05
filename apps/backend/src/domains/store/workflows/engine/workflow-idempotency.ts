import { createHash } from 'crypto';

/**
 * Idempotency keys are stored namespaced by origin so a key chosen by (or
 * guessable for) one origin can never address another origin's event. The
 * client never sees the namespaced value. Max stored length is 80.
 */
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

/** Client key of an authenticated user (API-key requests use the acting user). */
export function userIdempotencyKey(userId: number | null, raw: string): string {
  return `u:${userId ?? 0}:${sha(raw)}`;
}

/** Public form submission key (already a sha256 of token + submission id). */
export function publicIdempotencyKey(raw: string): string {
  return `p:${sha(raw)}`;
}

/** Engine-generated keys (triggers, outbox actions). */
export function systemIdempotencyKey(raw: string): string {
  return raw.length <= 70 ? `s:${raw}` : `s:${sha(raw)}`;
}

export const START_EVENT_TYPES = ['started', 'submitted'];
export const COMPLETE_EVENT_TYPES = ['task_completed', 'vote'];
