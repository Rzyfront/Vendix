import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthFacade } from '../store/auth/auth.facade';

/** `audit`: the gate only records. `enforce`: the industry layer blocks. */
export type AccessGateMode = 'audit' | 'enforce';

export type AccessGateApp = 'STORE_ADMIN' | 'ORG_ADMIN';

/** Surfaces that consult `canSeeKey` (apps-f4 S4). */
export type AccessSurface = 'sidebar' | 'url' | 'apps_card' | 'vexi';

export type AccessLayer = 'user' | 'store' | 'industry' | 'org';

export type AccessDecision = 'would_hide' | 'would_block' | 'hidden' | 'blocked';

export interface AccessAuditEvent {
  key: string;
  decision: AccessDecision;
  layer: AccessLayer;
  surface: AccessSurface;
  route?: string;
}

interface AccessGateState {
  mode?: AccessGateMode;
  industries?: string[];
  org_panel_ui?: Record<string, boolean> | null;
}

/** Max wait for the gate state before a guard falls back to audit. */
const LOAD_TIMEOUT_MS = 1500;
const FLUSH_DELAY_MS = 2000;
const MAX_EVENTS_PER_REQUEST = 50;

/**
 * Access gate state and audit sink (apps-f4 S4/S5/S8).
 *
 * - `mode` comes from the backend flag (Redis, `GET /{store|organization}/access-gate`).
 *   Until it loads, or when the call fails, the gate stays in `audit`: nothing
 *   new is hidden or blocked.
 * - `industries` is the store industries, or for ORG_ADMIN the union of the
 *   organization stores (S6), computed by the backend.
 * - `report()` sends gate events to the backend, which stamps store, user and
 *   role from the session and writes one `ACCESS_AUDIT` line per event. The
 *   front deduplicates per session so a sidebar re-render is one event, not one
 *   per emission.
 */
@Injectable({ providedIn: 'root' })
export class AccessGateService {
  private readonly http = inject(HttpClient);
  private readonly authFacade = inject(AuthFacade);

  readonly mode = signal<AccessGateMode>('audit');
  /** `null` until loaded: callers fall back to the store settings industries. */
  readonly industries = signal<string[] | null>(null);
  /** ORG_ADMIN ceiling, `organization_settings.panel_ui.ORG_ADMIN`. */
  readonly orgPanelUi = signal<Record<string, boolean> | null>(null);

  private loadedFor: string | null = null;
  private loading: Promise<void> | null = null;
  private readonly seen = new Set<string>();
  private queue: AccessAuditEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** STORE_ADMIN unless the session is in the organization panel. */
  currentApp(): AccessGateApp {
    return this.authFacade.selectedAppType() === 'ORG_ADMIN'
      ? 'ORG_ADMIN'
      : 'STORE_ADMIN';
  }

  /**
   * Loads mode and industries once per store/organization. Never rejects and
   * never waits more than `LOAD_TIMEOUT_MS`: a slow or failing call keeps the
   * gate in audit.
   */
  ensureLoaded(app: AccessGateApp = this.currentApp()): Promise<void> {
    const scopeKey = this.scopeKey(app);
    if (this.loadedFor === scopeKey) return Promise.resolve();
    if (this.loading) return this.loading;

    this.mode.set('audit');
    this.industries.set(null);
    this.orgPanelUi.set(null);

    const url = `${environment.apiUrl}/${this.prefix(app)}/access-gate`;
    this.loading = firstValueFrom(
      this.http
        .get<{ data?: AccessGateState } & AccessGateState>(url)
        .pipe(timeout(LOAD_TIMEOUT_MS)),
    )
      .then((response) => {
        const state = response?.data ?? response;
        this.mode.set(state?.mode === 'enforce' ? 'enforce' : 'audit');
        this.industries.set(
          Array.isArray(state?.industries) ? state.industries : null,
        );
        this.orgPanelUi.set(state?.org_panel_ui ?? null);
        this.loadedFor = scopeKey;
      })
      .catch(() => {
        // Audit on any failure; retry on the next navigation.
        this.mode.set('audit');
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /** Queues one event; identical events in the same session are sent once. */
  report(event: AccessAuditEvent): void {
    const route = event.route
      ? event.route.split('?')[0].slice(0, 200)
      : undefined;
    const app = this.currentApp();
    const id = [
      this.scopeKey(app),
      event.key,
      event.decision,
      event.layer,
      event.surface,
      route ?? '',
    ].join('|');
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.queue.push({ ...event, ...(route ? { route } : {}) });
    this.scheduleFlush(app);
  }

  private scheduleFlush(app: AccessGateApp): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const batch = this.queue.splice(0, MAX_EVENTS_PER_REQUEST);
      if (!batch.length) return;
      this.http
        .post(`${environment.apiUrl}/${this.prefix(app)}/access-gate/audit`, {
          events: batch,
        })
        .subscribe({ error: () => undefined });
      if (this.queue.length) this.scheduleFlush(app);
    }, FLUSH_DELAY_MS);
  }

  private prefix(app: AccessGateApp): string {
    return app === 'ORG_ADMIN' ? 'organization' : 'store';
  }

  private scopeKey(app: AccessGateApp): string {
    const store = this.authFacade.userStore() as { id?: number } | null;
    const organization = this.authFacade.userOrganization() as {
      id?: number;
    } | null;
    return app === 'ORG_ADMIN'
      ? `org:${organization?.id ?? '?'}`
      : `store:${store?.id ?? '?'}`;
  }
}
