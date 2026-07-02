import {
  Component,
  inject,
  signal,
  computed,
  effect,
  DestroyRef,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap, tap } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReservationsService } from '../../services/reservations.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import {
  ProviderAvailabilityOverview,
  ProviderAvailabilityDay,
  ProviderAvailabilityRow,
} from '../../interfaces/reservation.interface';

/**
 * Provider availability dashboard.
 *
 * Renders a 7-day (default) overview of capacity and occupancy per provider
 * with stats cards on top. Built signals-first / zoneless — no markForCheck,
 * no subscribe without takeUntilDestroyed.
 */
@Component({
  selector: 'app-provider-availability',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    IconComponent,
    ButtonComponent,
    CardComponent,
  ],
  templateUrl: './provider-availability.component.html',
  styleUrls: ['./provider-availability.component.scss'],
})
export class ProviderAvailabilityComponent {
  private service = inject(ReservationsService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  // --- State ---
  readonly overview = signal<ProviderAvailabilityOverview | null>(null);
  readonly loading = signal(false);

  // Default to today + 6 days (7-day window)
  readonly dateFrom = signal(this.formatDateInput(new Date()));
  readonly dateTo = signal(
    this.formatDateInput(this.addDays(new Date(), 6)),
  );

  readonly slotMinutes = signal(30);
  readonly providerFilter = signal<number | null>(null);

  // --- Computed ---
  readonly providers = computed(
    () => this.overview()?.providers ?? [],
  );
  readonly totals = computed(
    () => this.overview()?.totals ?? null,
  );
  readonly dates = computed<string[]>(() => {
    const o = this.overview();
    if (!o) return [];
    const first = o.providers[0];
    return first?.days.map((d) => d.date) ?? [];
  });

  readonly freeSlotsToday = computed(() => {
    const o = this.overview();
    if (!o) return 0;
    const today = this.formatDateInput(new Date());
    return o.providers.reduce((sum, p) => {
      const day = p.days.find((d) => d.date === today);
      return sum + (day?.free_slots ?? 0);
    }, 0);
  });

  readonly upcomingBookings = computed(() => {
    const o = this.overview();
    if (!o) return 0;
    const today = this.formatDateInput(new Date());
    return o.providers.reduce((sum, p) => {
      const futureDays = p.days.filter(
        (d: ProviderAvailabilityDay) => d.date >= today,
      );
      return sum + futureDays.reduce((s, d) => s + d.booked_slots, 0);
    }, 0);
  });

  constructor() {
    // Auto-refresh when any input changes.
    //
    // The previous version used `effect()` + `loadOverview()` which
    // subscribed with `takeUntilDestroyed(this.destroyRef)` on every
    // effect run. `takeUntilDestroyed` only cancels on component
    // destroy — it does NOT cancel an in-flight request when the
    // effect re-runs because some other signal changed. So if the
    // operator changes dateFrom/dateTo/slotMinutes rapidly, you
    // get N parallel GET /availability/overview calls and the
    // dashboard paints whichever one resolves last (race condition).
    //
    // Fix: lift the params into a `computed` signal, convert to
    // observable, and use `switchMap` — the operator's natural
    // semantics for "the latest request wins". switchMap
    // automatically unsubscribes from the previous inner observable.
    const params = computed(() => {
      const prov = this.providerFilter();
      return {
        date_from: this.dateFrom(),
        date_to: this.dateTo(),
        slot_minutes: this.slotMinutes(),
        provider_id: prov ?? undefined,
      };
    });

    toObservable(params)
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap((p) => this.service.getAvailabilityOverview(p)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => {
          this.overview.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.toast.error('Error al cargar disponibilidad de proveedores');
          this.loading.set(false);
        },
      });
  }

  loadOverview(params: {
    date_from: string;
    date_to: string;
    slot_minutes: number;
    provider_id?: number;
  }): void {
    this.loading.set(true);
    this.service
      .getAvailabilityOverview(params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.overview.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.toast.error('Error al cargar disponibilidad de proveedores');
          this.loading.set(false);
        },
      });
  }

  setDateRange(days: number): void {
    this.dateFrom.set(this.formatDateInput(new Date()));
    this.dateTo.set(this.formatDateInput(this.addDays(new Date(), days - 1)));
  }

  occupancyClass(pct: number): string {
    if (pct >= 80) return 'occ-high';
    if (pct >= 50) return 'occ-mid';
    return 'occ-low';
  }

  private addDays(d: Date, n: number): Date {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
  }

  private formatDateInput(d: Date): string {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}