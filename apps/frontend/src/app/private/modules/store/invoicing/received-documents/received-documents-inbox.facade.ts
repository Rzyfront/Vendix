import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription, catchError, finalize, forkJoin, map, of } from 'rxjs';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import type {
  ApiEnvelope, ReceivedDocument, ReceivedDocumentInboxSummary, ReceivedDocumentQuery,
  ReceivedDocumentReceptionStatus, ReceivedDocumentsPage, ReceivedDocumentsScope,
} from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';
import {
  receivedInboxCanPoll, receivedInboxContextKey, receivedInboxMembershipChanged, receivedInboxNewRowCount,
  receivedInboxProtectedRows, receivedInboxRefreshDelay,
} from './received-documents-refresh.util';

type ReadResult<T> = { value: T; error: null } | { value: null; error: string };
interface InboxContext { scope: ReceivedDocumentsScope; query: ReceivedDocumentQuery; ready: boolean; tenantKey: string }

/** Provided by the routed page; read-only polling never starts reception sync or domain writes. */
@Injectable()
export class ReceivedDocumentsInboxFacade {
  private readonly service = inject(ReceivedDocumentsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly window = this.browser ? this.document.defaultView : null;
  readonly rows = signal<ReceivedDocument[]>([]);
  readonly total = signal(0);
  readonly summary = signal<ReceivedDocumentInboxSummary | null>(null);
  readonly health = signal<ReceivedDocumentReceptionStatus | null>(null);
  readonly error = signal<string | null>(null);
  readonly summaryError = signal(false);
  readonly healthError = signal(false);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly lastUpdatedAt = signal<string | null>(null);
  readonly pendingRows = signal<ReceivedDocument[] | null>(null);
  readonly pendingNewCount = signal(0);
  readonly hasPendingUpdate = computed(() => this.pendingRows() !== null);
  private pendingTotal = 0;
  private context?: InboxContext;
  private contextKey = '';
  private generation = 0;
  private activeRequest?: Subscription;
  private inFlight = false;
  private failures = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private protected = false;
  private destroyed = false;
  private refreshAfterFlight = false;

  constructor() {
    const onAvailability = (): void => {
      this.clearTimer();
      if (this.canPoll()) this.refresh();
    };
    this.document.addEventListener('visibilitychange', onAvailability);
    this.window?.addEventListener('focus', onAvailability);
    this.window?.addEventListener('online', onAvailability);
    this.window?.addEventListener('offline', onAvailability);
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.generation++;
      this.clearTimer();
      this.activeRequest?.unsubscribe();
      this.document.removeEventListener('visibilitychange', onAvailability);
      this.window?.removeEventListener('focus', onAvailability);
      this.window?.removeEventListener('online', onAvailability);
      this.window?.removeEventListener('offline', onAvailability);
    });
  }

  setContext(scope: ReceivedDocumentsScope, query: ReceivedDocumentQuery, ready: boolean, tenantKey = ''): void {
    const key = `${receivedInboxContextKey(scope, query, tenantKey)}:${ready}`;
    if (key === this.contextKey) return;
    const tenantChanged = this.context?.scope !== scope || this.context?.query.store_id !== query.store_id || this.context?.tenantKey !== tenantKey;
    this.generation++;
    this.clearTimer();
    this.activeRequest?.unsubscribe();
    this.inFlight = false;
    this.refreshAfterFlight = false;
    this.contextKey = key;
    this.context = { scope, query: { ...query }, ready, tenantKey };
    this.failures = 0;
    this.pendingRows.set(null);
    this.pendingNewCount.set(0);
    this.error.set(null);
    if (tenantChanged || !ready) {
      this.rows.set([]);
      this.total.set(0);
      this.summary.set(null);
      this.health.set(null);
      this.lastUpdatedAt.set(null);
    }
    this.loading.set(false);
    this.refreshing.set(false);
    if (this.canPoll()) this.refresh(true);
  }

  setProtected(value: boolean): void {
    this.protected = value;
    if (!value) this.applyPendingUpdate();
  }

  applyPendingUpdate(): void {
    const pending = this.pendingRows();
    if (!pending) return;
    this.rows.set(pending);
    this.total.set(this.pendingTotal);
    this.pendingRows.set(null);
    this.pendingNewCount.set(0);
  }

  refresh(initial = false): void {
    if (!this.canPoll() || !this.context) return;
    if (this.inFlight) {
      // Exhaust polling ticks; only explicit refresh after a mutation requests another pass.
      return;
    }
    this.clearTimer();
    this.inFlight = true;
    const generation = this.generation;
    const { scope, query } = this.context;
    this.loading.set(initial && this.rows().length === 0);
    this.refreshing.set(true);
    const checkedEnvelope = <T>(result: ApiEnvelope<T>): T => {
      if (!result.success || result.data == null) throw new Error('Respuesta no disponible.');
      return result.data;
    };
    this.activeRequest = forkJoin({
      list: this.read(this.service.list(scope, query)),
      summary: this.read(this.service.getSummary(scope, query).pipe(map(checkedEnvelope))),
      health: this.read(this.service.getReceptionStatus(scope, query.store_id).pipe(map(checkedEnvelope))),
    }).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => {
      if (generation !== this.generation || this.destroyed) return;
      this.inFlight = false;
      this.loading.set(false);
      this.refreshing.set(false);
      if (this.refreshAfterFlight) {
        this.refreshAfterFlight = false;
        this.refresh();
      } else this.schedule();
    })).subscribe(({ list, summary, health }) => {
      if (generation !== this.generation || this.destroyed) return;
      this.error.set(list.error);
      this.summaryError.set(summary.error !== null);
      this.healthError.set(health.error !== null);
      if (list.value) {
        this.acceptList(list.value, !initial);
        this.lastUpdatedAt.set(new Date().toISOString());
      }
      if (summary.value) this.summary.set(summary.value);
      if (health.value) this.health.set(health.value);
      this.failures = list.error || summary.error || health.error ? this.failures + 1 : 0;
    });
  }

  refreshAfterMutation(): void {
    if (this.inFlight) this.refreshAfterFlight = true;
    else this.refresh();
  }

  private acceptList(result: ReceivedDocumentsPage, allowBuffer = true): void {
    const incoming = result.data ?? [];
    const total = result.meta?.total ?? 0;
    if (allowBuffer && this.protected && this.rows().length > 0) {
      if (receivedInboxMembershipChanged(this.rows(), incoming) || this.pendingRows()) {
        this.pendingNewCount.set(receivedInboxNewRowCount(this.rows(), incoming));
        this.pendingRows.set(incoming);
        this.pendingTotal = total;
      } else this.total.set(total);
      this.rows.set(receivedInboxProtectedRows(this.rows(), incoming));
    } else {
      this.rows.set(incoming);
      this.total.set(total);
      this.pendingRows.set(null);
      this.pendingNewCount.set(0);
    }
  }

  private read<T>(request: Observable<T>): Observable<ReadResult<T>> {
    return request.pipe(
      map((value): ReadResult<T> => ({ value, error: null })),
      catchError((error: unknown) => of<ReadResult<T>>({
        value: null, error: describeApiFailure(error).message || 'No se pudo actualizar el buzón.',
      })),
    );
  }
  private canPoll(): boolean {
    return !this.destroyed && this.browser && receivedInboxCanPoll(
      this.document.visibilityState !== 'hidden', this.window?.navigator.onLine !== false, this.context?.ready === true,
    );
  }
  private schedule(): void {
    this.clearTimer();
    if (!this.canPoll()) return;
    this.timer = setTimeout(() => this.refresh(), receivedInboxRefreshDelay(this.failures));
  }
  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
