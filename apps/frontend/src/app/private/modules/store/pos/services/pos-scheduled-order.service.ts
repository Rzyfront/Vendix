import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { selectStoreSettings } from '../../../../../core/store/auth/auth.selectors';

export type ScheduledFulfillmentType = 'pickup' | 'delivery';

export type SlotBlockedReason =
  | 'lead_time'
  | 'too_far'
  | 'slot_full'
  | 'day_full'
  | null;

export interface FulfillmentSlot {
  start: string;
  end: string;
  local_start: string;
  local_end: string;
  capacity: number;
  taken: number;
  available: boolean;
  blocked_reason: SlotBlockedReason;
}

export interface FulfillmentDay {
  date: string;
  day_of_week: number;
  blocked_reason: 'day_blocked' | null;
  exception_reason?: string | null;
  day_capacity?: number | null;
  day_taken?: number;
  slots: FulfillmentSlot[];
}

/** Minimal local view of `store_settings.scheduled_orders` (model owned elsewhere). */
interface ScheduledOrdersSettingsView {
  enabled?: boolean;
  max_days_ahead?: number;
  fulfillment_types?: ScheduledFulfillmentType[];
}

interface StoreSettingsView {
  scheduled_orders?: ScheduledOrdersSettingsView;
  product_options?: { enabled?: boolean };
}

/** Payload block sent to `POST /store/payments/pos`. */
export interface PosSchedulePayload {
  start: string;
  end: string;
  fulfillment_type: ScheduledFulfillmentType;
}

const MAX_RANGE_DAYS = 62;

/** YYYY-MM-DD en hora local (sin pasar por UTC). */
function toLocalDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Holds the scheduled-order choice made in the POS checkout (one per sale) and
 * reads availability. The checkout splits the picker across three steps
 * (toggle in Pedido, day/slot in Cliente, fulfillment type in Envío), so the
 * picker state lives here and every section reads the same signals. With the setting off (default) `enabled()` is false, the
 * UI never renders and `schedule()` stays null, so payloads are unchanged.
 */
@Injectable({ providedIn: 'root' })
export class PosScheduledOrderService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(Store);
  private readonly apiUrl = `${environment.apiUrl}/store/scheduled-orders`;

  private readonly settings = signal<ScheduledOrdersSettingsView | null>(null);

  readonly enabled = computed(() => this.settings()?.enabled === true);
  readonly maxDaysAhead = computed(() => this.settings()?.max_days_ahead ?? 14);
  readonly fulfillmentTypes = computed<ScheduledFulfillmentType[]>(() => {
    const types = this.settings()?.fulfillment_types;
    return types?.length ? types : ['pickup', 'delivery'];
  });

  /** Current choice; null when the sale is not scheduled. */
  readonly schedule = signal<PosSchedulePayload | null>(null);

  // ── Picker state shared by the checkout steps ──────────────────────────
  readonly active = signal(false);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly days = signal<FulfillmentDay[]>([]);
  readonly selectedDate = signal<string | null>(null);
  readonly selectedStart = signal<string | null>(null);
  readonly fulfillmentType = signal<ScheduledFulfillmentType | null>(null);
  /** Set by the checkout when it refuses to advance; shows the missing field. */
  readonly showValidation = signal(false);
  /**
   * Set by the checkout when the cart has add-ons: they are only sold in a
   * scheduled order, so the toggle stays on and cannot be turned off.
   */
  readonly required = signal(false);

  readonly selectedDay = computed(
    () => this.days().find((d) => d.date === this.selectedDate()) ?? null,
  );
  readonly hasSlot = computed(
    () => !!this.selectedDay()?.slots.some((s) => s.start === this.selectedStart()),
  );

  constructor() {
    this.store.select(selectStoreSettings).pipe(takeUntilDestroyed()).subscribe((s) => {
      this.settings.set((s as StoreSettingsView | null)?.scheduled_orders ?? null);
    });
  }

  getAvailability(from: string, to: string): Observable<FulfillmentDay[]> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http
      .get<{ data?: FulfillmentDay[] } | FulfillmentDay[]>(
        `${this.apiUrl}/availability`,
        { params },
      )
      .pipe(map((r) => (Array.isArray(r) ? r : (r?.data ?? []))));
  }

  setSchedule(value: PosSchedulePayload | null): void {
    this.schedule.set(value);
  }

  clear(): void {
    this.schedule.set(null);
  }

  activate(): void {
    this.active.set(true);
    this.showValidation.set(false);
    // Una sola opción habilitada: se preselecciona; con varias, elige el cajero.
    const types = this.fulfillmentTypes();
    this.fulfillmentType.set(types.length === 1 ? types[0] : null);
    this.loadAvailability();
  }

  /** Drops the whole choice (toggle off, sale completed or checkout closed). */
  reset(): void {
    this.active.set(false);
    this.required.set(false);
    this.days.set([]);
    this.selectedDate.set(null);
    this.selectedStart.set(null);
    this.fulfillmentType.set(null);
    this.loadError.set(null);
    this.showValidation.set(false);
    this.clear();
  }

  selectFulfillment(t: ScheduledFulfillmentType): void {
    this.fulfillmentType.set(t);
    this.syncSchedule();
  }

  selectDay(date: string): void {
    this.selectedDate.set(date);
    this.selectedStart.set(null);
    this.clear();
  }

  selectSlot(s: FulfillmentSlot): void {
    if (!s.available || s.blocked_reason) return;
    this.selectedStart.set(s.start);
    this.syncSchedule();
  }

  private syncSchedule(): void {
    const slot = this.selectedDay()?.slots.find((s) => s.start === this.selectedStart());
    const type = this.fulfillmentType();
    if (!slot || !type) {
      this.clear();
      return;
    }
    this.setSchedule({ start: slot.start, end: slot.end, fulfillment_type: type });
  }

  private loadAvailability(): void {
    const ahead = Math.min(this.maxDaysAhead(), MAX_RANGE_DAYS - 1);
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + ahead);
    this.loading.set(true);
    this.loadError.set(null);
    this.getAvailability(toLocalDateString(from), toLocalDateString(to)).subscribe({
      next: (days) => {
        this.days.set(days);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No se pudo cargar la disponibilidad. Intenta de nuevo.');
      },
    });
  }
}
