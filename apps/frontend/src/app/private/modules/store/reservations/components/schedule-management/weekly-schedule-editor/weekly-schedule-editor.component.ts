import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription, finalize, map } from 'rxjs';
import { ReservationsService } from '../../../services/reservations.service';
import { ServiceStationsService } from '../../service-stations/service-stations.service';
import { SpinnerComponent, ToastService } from '../../../../../../../shared/components';
import { WeeklyHoursEditorComponent } from '../../../../../../../shared/components/weekly-hours-editor/weekly-hours-editor.component';
import {
  WeekHoursDay,
  WeeklyRowLike,
  openDaysCount,
  sameWeek,
  weekFromBlockRows,
  weekToBlockRows,
  weeklyHours,
} from '../../../../../../../shared/components/weekly-hours-editor/weekly-hours.util';

/**
 * Loads and saves the week of a provider (own schedule, or the store hours
 * read-only when it works them) or of a station, and edits it with the shared
 * weekly editor (`app-weekly-hours-editor`).
 */
@Component({
  selector: 'app-weekly-schedule-editor',
  standalone: true,
  imports: [SpinnerComponent, WeeklyHoursEditorComponent],
  template: `
    @if (loading()) {
      <app-spinner size="sm" [center]="true" />
    } @else {
      <app-weekly-hours-editor
        [days]="days()"
        (daysChange)="onDaysChange($event)"
        [readOnly]="readOnly()"
        [showSave]="!readOnly()"
        [saving]="saving()"
        [dirty]="dirty()"
        [saved]="justSaved()"
        (save)="save($event)"
      />
    }
  `,
})
export class WeeklyScheduleEditorComponent {
  private readonly reservationsService = inject(ReservationsService);
  private readonly serviceStationsService = inject(ServiceStationsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Whose week is edited: a specialist, or a station (hours may cross midnight too). */
  readonly providerId = input<number | null>(null);
  readonly stationId = input<number | null>(null);
  /** The provider works the store hours: the store week (inherited rows) is shown, read-only. */
  readonly readOnly = input(false);
  readonly scheduleChanged = output<{ activeDays: number; weeklyHours: number }>();
  /** Emitted after a successful save. */
  readonly saved = output<void>();

  readonly days = signal<WeekHoursDay[]>([]);
  private readonly savedDays = signal<WeekHoursDay[]>([]);
  readonly dirty = computed(() => !sameWeek(this.days(), this.savedDays()));
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly justSaved = signal(false);
  private loadSub?: Subscription;

  constructor() {
    effect(() => {
      const stationId = this.stationId();
      const providerId = this.providerId();
      // Switching between store hours and own schedule reloads the week.
      this.readOnly();
      if (stationId || providerId) {
        untracked(() => this.loadSchedule());
      }
    });
  }

  /** Station rows use `weekday`; the editor works in `day_of_week` like the specialist rows. */
  private fetchSchedule(): Observable<WeeklyRowLike[]> {
    const stationId = this.stationId();
    if (stationId) {
      return this.serviceStationsService.getSchedules(stationId).pipe(
        map((rows) =>
          (rows ?? [])
            .filter((row) => row.is_active !== false)
            .map((row) => ({
              day_of_week: row.weekday,
              block_order: row.block_order ?? 0,
              start_time: row.start_time,
              end_time: row.end_time,
            })),
        ),
      );
    }
    return this.reservationsService
      .getProviderSchedule(this.providerId()!)
      .pipe(map((rows) => (rows ?? []).filter((row) => row.is_active !== false)));
  }

  private loadSchedule(): void {
    this.loadSub?.unsubscribe();
    this.loading.set(true);
    this.justSaved.set(false);
    this.loadSub = this.fetchSchedule()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (rows) => this.setSaved(weekFromBlockRows(rows)),
        error: () => {
          this.setSaved(weekFromBlockRows([]));
          this.toastService.error('No se pudo cargar el horario');
        },
      });
  }

  private setSaved(week: WeekHoursDay[]): void {
    this.days.set(week);
    this.savedDays.set(week);
    this.emitStats();
  }

  private emitStats(): void {
    this.scheduleChanged.emit({ activeDays: openDaysCount(this.days()), weeklyHours: weeklyHours(this.days()) });
  }

  onDaysChange(week: WeekHoursDay[]): void {
    if (this.readOnly()) return;
    this.days.set(week);
    this.justSaved.set(false);
    this.emitStats();
  }

  save(week: WeekHoursDay[]): void {
    if (this.readOnly()) return;
    const items = weekToBlockRows(week);
    const stationId = this.stationId();
    const request: Observable<unknown> = stationId
      ? this.serviceStationsService.setSchedules(
          stationId,
          // The station DTO has no `block_order` (unknown fields are rejected); the API orders blocks by start time.
          items.map((item) => ({
            weekday: item.day_of_week,
            start_time: item.start_time,
            end_time: item.end_time,
            is_active: item.is_active,
          })),
        )
      : this.reservationsService.upsertProviderSchedule(this.providerId()!, items);
    this.saving.set(true);
    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => {
          this.savedDays.set(week);
          this.justSaved.set(true);
          this.toastService.success('Horario guardado');
          this.saved.emit();
        },
        error: (err) => this.toastService.error(err?.error?.message || 'No se pudo guardar el horario'),
      });
  }
}
