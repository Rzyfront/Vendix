import { Injectable, Logger } from '@nestjs/common';
import { AccessAuditEvent } from './access-audit.types';

export const ACCESS_AUDIT_PREFIX = 'ACCESS_AUDIT ';
const DEDUPE_WINDOW_MS = 60_000;
const DEDUPE_MAX_ENTRIES = 5_000;
const ROUTE_MAX_LENGTH = 200;

/**
 * Writes one structured `ACCESS_AUDIT {json}` line per access-gate event
 * (apps-f4 S8). Read by `scripts/access-audit-summary.mjs`.
 * Identical events inside 60 s are written once per process.
 */
@Injectable()
export class AccessAuditLogger {
  private readonly logger = new Logger('AccessAudit');
  private readonly seen = new Map<string, number>();

  record(event: AccessAuditEvent, now: number = Date.now()): void {
    const route = this.cleanRoute(event.route);
    const dedupeKey = [
      event.source,
      event.surface,
      event.store_id,
      event.user_id,
      event.key,
      event.decision,
      event.layer,
      route,
    ].join('|');

    const last = this.seen.get(dedupeKey);
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;
    this.remember(dedupeKey, now);

    // Explicit field list: nothing outside the contract can leak into the log.
    const line = {
      source: event.source,
      surface: event.surface,
      store_id: event.store_id ?? null,
      organization_id: event.organization_id ?? null,
      user_id: event.user_id ?? null,
      role: event.role ?? null,
      key: event.key,
      industry: [...event.industry],
      decision: event.decision,
      layer: event.layer,
      route,
      mode: event.mode,
      ts: new Date(now).toISOString(),
    };
    this.logger.log(`${ACCESS_AUDIT_PREFIX}${JSON.stringify(line)}`);
  }

  private cleanRoute(route: string | null | undefined): string | null {
    if (!route) return null;
    const noQuery = route.split('?')[0].split('#')[0];
    return noQuery.slice(0, ROUTE_MAX_LENGTH);
  }

  private remember(key: string, now: number): void {
    if (this.seen.size >= DEDUPE_MAX_ENTRIES) {
      for (const [k, ts] of this.seen) {
        if (now - ts >= DEDUPE_WINDOW_MS) this.seen.delete(k);
      }
      if (this.seen.size >= DEDUPE_MAX_ENTRIES) this.seen.clear();
    }
    this.seen.set(key, now);
  }
}
