import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { IconComponent, SpinnerComponent, ToastService } from '../../../../../../shared/components';
import { WeeklyHoursEditorComponent } from '../../../../../../shared/components/weekly-hours-editor/weekly-hours-editor.component';
import {
  WeekHoursDay,
  sameWeek,
  weekFromStoreRows,
  weekToStoreRows,
} from '../../../../../../shared/components/weekly-hours-editor/weekly-hours.util';
import { ReservationsService } from '../../services/reservations.service';
import { StoreSettingsService } from '../../../settings/general/services/store-settings.service';

/**
 * Agenda → Configuración → Horario de la tienda. It is the store's ONE
 * schedule (`settings.pos.business_hours`): the same one Ajustes → Venta edits
 * and the one bookings, the agenda, "open now" and every provider that works
 * the store hours read. Edited with the shared weekly editor.
 */
@Component({
  selector: 'app-business-hours',
  standalone: true,
  imports: [RouterLink, IconComponent, SpinnerComponent, WeeklyHoursEditorComponent],
  templateUrl: './business-hours.component.html',
})
export class BusinessHoursComponent {
  private readonly reservations = inject(ReservationsService);
  private readonly storeSettings = inject(StoreSettingsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Ajustes → Venta, where the same schedule (and the POS rules) live. */
  readonly salesSettingsRoute = '/admin/settings/general/venta';

  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly saving = signal(false);
  readonly justSaved = signal(false);
  readonly days = signal<WeekHoursDay[]>([]);
  private readonly savedDays = signal<WeekHoursDay[]>([]);
  readonly dirty = computed(() => !sameWeek(this.days(), this.savedDays()));

  /** Providers that work the store hours (null while unknown). */
  readonly inheritingProviders = signal<number | null>(null);

  constructor() {
    this.reservations
      .getBusinessHours()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (rows) => this.setSaved(weekFromStoreRows(rows ?? [])),
        error: () => {
          this.setSaved(weekFromStoreRows([]));
          this.loadError.set(true);
        },
      });
    this.reservations
      .getProviders()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (providers) =>
          this.inheritingProviders.set(
            (providers ?? []).filter((p) => p.is_active && p.uses_store_hours !== false).length,
          ),
        error: () => this.inheritingProviders.set(null),
      });
  }

  private setSaved(week: WeekHoursDay[]): void {
    this.days.set(week);
    this.savedDays.set(week);
  }

  onDaysChange(week: WeekHoursDay[]): void {
    this.days.set(week);
    this.justSaved.set(false);
  }

  save(week: WeekHoursDay[]): void {
    this.saving.set(true);
    this.reservations
      .upsertBusinessHours(weekToStoreRows(week))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (rows) => {
          this.setSaved(Array.isArray(rows) && rows.length ? weekFromStoreRows(rows) : week);
          this.justSaved.set(true);
          this.toast.success('Horario guardado. Ya aplica a reservas, agenda y Ajustes → Venta.');
          // The agenda grids and the POS read the schedule from the store
          // settings: refresh them so they use the new hours right away.
          this.storeSettings.getSettings({ forceRefresh: true }).subscribe({ error: () => undefined });
        },
        error: (err) => this.toast.error(err?.error?.message ?? 'No se pudo guardar el horario'),
      });
  }
}
