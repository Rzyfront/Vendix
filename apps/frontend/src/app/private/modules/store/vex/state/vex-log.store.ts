import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiError } from '../../../../../shared/utils/http-error.util';
import { Reminder, RemindersService } from '../../dashboard/services/reminders.service';
import { VexChatStore } from './vex-chat.store';
import {
  VexReminderFilter,
  countReminders,
  filterReminders,
  vexActivityFingerprint,
} from './vex-reminders.util';

/**
 * Page size of each status request (the API maximum). Pending and done are
 * read separately so a long history of done reminders never pushes pending
 * ones out of one shared page, and "Hechos" is not cut at the default 100.
 */
export const VEX_REMINDERS_PAGE_LIMIT = 200;

/** How long the collapsed rail keeps its "new reminder" cue. */
const HIGHLIGHT_MS = 3000;

/** Wait for a burst of Vex activity (thread load, several receipts) to settle. */
const ACTIVITY_REFRESH_DELAY_MS = 400;

/**
 * The "Bitácora empresarial" of the Vex view: the current user's reminders,
 * the same ones the dashboard Bitácora tab lists and Vex reads, creates,
 * edits, completes and deletes (`/store/reminders`, scoped server-side to the
 * active store and user — no other data reaches this sidebar).
 *
 * Provided by `VexPageComponent`, next to `VexChatStore`: whenever a Vex turn
 * finishes or a confirmed step is applied it re-reads the reminders, so a
 * reminder Vex just created or changed shows up without a reload.
 */
@Injectable()
export class VexLogStore {
  private readonly destroyRef = inject(DestroyRef);
  private readonly reminders = inject(RemindersService);
  private readonly chat = inject(VexChatStore);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly toast = inject(ToastService);

  private readonly _items = signal<Reminder[]>([]);
  private readonly _active_filter = signal<VexReminderFilter>('pending');
  private readonly _loading = signal(true);
  private readonly _error = signal(false);
  private readonly _server_timezone = signal<string | null>(null);
  private readonly _updating_ids = signal<ReadonlySet<number>>(new Set());

  private readonly _highlight = signal(false);
  private known_pending_ids: Set<number> | null = null;
  private highlight_timer: ReturnType<typeof setTimeout> | null = null;

  private load_seq = 0;
  private refresh_timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  readonly items = this._items.asReadonly();
  readonly active_filter = this._active_filter.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly updating_ids = this._updating_ids.asReadonly();
  /** True for a moment after a new pending reminder shows up (collapsed rail cue). */
  readonly highlight = this._highlight.asReadonly();

  readonly counts = computed(() => countReminders(this._items()));
  readonly filtered = computed(() => filterReminders(this._items(), this._active_filter()));
  /** Pending reminders due today or overdue: the badge on the sidebar header. */
  /** Pending reminders in total: the counter of the collapsed rail. */
  readonly pending_count = computed(() => this.counts().pending);
  readonly attention_count = computed(() => this.counts().today + this.counts().overdue);

  /** Zone the reminders are bucketed in (server), falling back to the store setting. */
  readonly timezone = computed(() => this._server_timezone() ?? this.settings.timezone());

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      if (this.refresh_timer) clearTimeout(this.refresh_timer);
      if (this.highlight_timer) clearTimeout(this.highlight_timer);
    });

    void this.refresh();

    let previous: string | null = null;
    effect(() => {
      const fingerprint = vexActivityFingerprint(
        this.chat.conversations(),
        this.chat.busy_plan_id(),
      );
      if (previous !== null && fingerprint !== previous) {
        untracked(() => this.scheduleRefresh());
      }
      previous = fingerprint;
    });
  }

  setFilter(filter: VexReminderFilter): void {
    this._active_filter.set(filter);
  }

  async refresh(): Promise<void> {
    const seq = ++this.load_seq;
    try {
      const [pending, done] = await firstValueFrom(
        forkJoin([
          this.reminders.list('pending', VEX_REMINDERS_PAGE_LIMIT),
          this.reminders.list('done', VEX_REMINDERS_PAGE_LIMIT),
        ]),
      );
      if (this.destroyed || seq !== this.load_seq) return;
      this._items.set([
        ...(Array.isArray(pending?.items) ? pending.items : []),
        ...(Array.isArray(done?.items) ? done.items : []),
      ]);
      this.noteNewPending(Array.isArray(pending?.items) ? pending.items : []);
      this._server_timezone.set(pending?.timezone || done?.timezone || null);
      this._error.set(false);
    } catch {
      // Secondary panel: show an inline retry instead of toasting over the chat.
      if (this.destroyed || seq !== this.load_seq) return;
      this._error.set(true);
    } finally {
      if (!this.destroyed && seq === this.load_seq) this._loading.set(false);
    }
  }

  /** Marks a reminder done, or reopens it, then re-reads the list. */
  async toggleStatus(item: Reminder): Promise<void> {
    if (this._updating_ids().has(item.id)) return;
    this.setUpdating(item.id, true);
    try {
      await firstValueFrom(
        this.reminders.update(item.id, { status: item.status === 'done' ? 'pending' : 'done' }),
      );
      if (this.destroyed) return;
      await this.refresh();
    } catch (err) {
      if (!this.destroyed) {
        this.toast.error(
          extractApiError(err).message ?? 'No se pudo actualizar el recordatorio',
        );
      }
    } finally {
      if (!this.destroyed) this.setUpdating(item.id, false);
    }
  }

  /** Flags a pending reminder never seen before; the first load only seeds the set. */
  private noteNewPending(pending: readonly Reminder[]): void {
    const ids = new Set(pending.map((item) => item.id));
    const previous = this.known_pending_ids;
    this.known_pending_ids = ids;
    if (!previous) return;
    let fresh = false;
    for (const id of ids) if (!previous.has(id)) fresh = true;
    if (!fresh) return;
    this._highlight.set(true);
    if (this.highlight_timer) clearTimeout(this.highlight_timer);
    this.highlight_timer = setTimeout(() => {
      this.highlight_timer = null;
      if (!this.destroyed) this._highlight.set(false);
    }, HIGHLIGHT_MS);
  }

  private scheduleRefresh(): void {
    if (this.destroyed) return;
    if (this.refresh_timer) clearTimeout(this.refresh_timer);
    this.refresh_timer = setTimeout(() => {
      this.refresh_timer = null;
      void this.refresh();
    }, ACTIVITY_REFRESH_DELAY_MS);
  }

  private setUpdating(id: number, on: boolean): void {
    this._updating_ids.update((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
