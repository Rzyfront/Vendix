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

/**
 * Holds the scheduled-order choice made in the POS checkout (one per sale) and
 * reads availability. With the setting off (default) `enabled()` is false, the
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
}
