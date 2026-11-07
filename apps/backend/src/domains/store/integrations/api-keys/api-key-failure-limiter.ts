import { Injectable } from '@nestjs/common';

/** Failed authentications allowed per client IP in one window. */
export const API_KEY_FAILURE_LIMIT = { limit: 20, ttlMs: 60_000 } as const;
const MAX_TRACKED_IPS = 10_000;

/**
 * Stops key guessing before it reaches the database: `ApiKeyGuard` looks a key
 * up on every attempt and the per-key throttler only knows valid keys. Only
 * failures count, so a busy integration behind one IP is never affected. It
 * lives in the process, like the global throttler's storage.
 */
@Injectable()
export class ApiKeyFailureLimiter {
  private readonly failures = new Map<
    string,
    { count: number; resetAt: number }
  >();

  isBlocked(ip: string, now = Date.now()): boolean {
    const entry = this.failures.get(ip);
    if (!entry) return false;
    if (entry.resetAt <= now) {
      this.failures.delete(ip);
      return false;
    }
    return entry.count >= API_KEY_FAILURE_LIMIT.limit;
  }

  recordFailure(ip: string, now = Date.now()): void {
    const entry = this.failures.get(ip);
    if (entry && entry.resetAt > now) {
      entry.count++;
      return;
    }
    if (this.failures.size >= MAX_TRACKED_IPS) this.evictExpired(now);
    if (this.failures.size >= MAX_TRACKED_IPS) this.failures.clear();
    this.failures.set(ip, {
      count: 1,
      resetAt: now + API_KEY_FAILURE_LIMIT.ttlMs,
    });
  }

  private evictExpired(now: number): void {
    for (const [ip, entry] of this.failures) {
      if (entry.resetAt <= now) this.failures.delete(ip);
    }
  }
}
