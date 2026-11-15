import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
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

  private load_seq = 0;
  private refresh_timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  readonly items = this._items.asReadonly();
  readonly active_filter = this._active_filter.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly updating_ids = this._updating_ids.asReadonly();

  readonly counts = computed(() => countReminders(this._items()));
  readonly filtered = computed(() => filterReminders(this._items(), this._active_filter()));
  /** Pending reminders due today or overdue: the badge on the sidebar header. */
  readonly attention_count = computed(() => this.counts().today + this.counts().overdue);

  /** Zone the reminders are bucketed in (server), falling back to the store setting. */
  readonly timezone = computed(() => this._server_timezone() ?? this.settings.timezone());

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      if (this.refresh_timer) clearTimeout(this.refresh_timer);
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
      const res = await firstValueFrom(this.reminders.list('all'));
      if (this.destroyed || seq !== this.load_seq) return;
      this._items.set(Array.isArray(res?.items) ? res.items : []);
      this._server_timezone.set(res?.timezone || null);
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
