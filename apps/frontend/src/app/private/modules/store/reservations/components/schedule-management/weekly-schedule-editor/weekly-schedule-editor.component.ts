import {
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  effect,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { ReservationsService } from '../../../services/reservations.service';
import { ProviderSchedule } from '../../../interfaces/reservation.interface';
import {
  IconComponent,
  SpinnerComponent,
  ToastService,
  ButtonComponent,
  ToggleComponent,
} from '../../../../../../../shared/components';

interface ScheduleDay {
  day_of_week: number;
  label: string;
  shortLabel: string;
  is_active: boolean;
  start_time: string;
  end_time: string;
  editing: boolean;
}

@Component({
  selector: 'app-weekly-schedule-editor',
  standalone: true,
  imports: [FormsModule, IconComponent, SpinnerComponent, ButtonComponent, ToggleComponent],
  templateUrl: './weekly-schedule-editor.component.html',
  styleUrls: ['./weekly-schedule-editor.component.scss'],
})
export class WeeklyScheduleEditorComponent {
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly providerId = input.required<number>();
  readonly scheduleChanged = output<{ activeDays: number; weeklyHours: number }>();

  days = signal<ScheduleDay[]>([]);
  loading = signal(false);
  saving = signal(false);

  // Timeline range: 6:00 AM to 10:00 PM (16 hours)
  readonly RANGE_START = 6; // 6 AM
  readonly RANGE_END = 22; // 10 PM
  readonly RANGE_HOURS = 16;

  // Hour markers for the timeline header
  readonly hourMarkers = Array.from({ length: 9 }, (_, i) => this.RANGE_START + i * 2); // [6, 8, 10, 12, 14, 16, 18, 20, 22]

  constructor() {
    effect(() => {
      const id = this.providerId();
      if (id) {
        untracked(() => this.loadSchedule(id));
      }
    });
  }

  private loadSchedule(providerId: number): void {
    this.loading.set(true);
    this.reservationsService
      .getProviderSchedule(providerId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (schedules) => this.initDays(schedules),
        error: () => {
          this.initDays([]);
          this.toastService.error('Error al cargar horario');
        },
      });
  }

  private initDays(schedules: ProviderSchedule[]): void {
    const dayNames = [
      { day: 1, label: 'Lunes', short: 'Lun' },
      { day: 2, label: 'Martes', short: 'Mar' },
      { day: 3, label: 'Miércoles', short: 'Mié' },
      { day: 4, label: 'Jueves', short: 'Jue' },
      { day: 5, label: 'Viernes', short: 'Vie' },
      { day: 6, label: 'Sábado', short: 'Sáb' },
      { day: 0, label: 'Domingo', short: 'Dom' },
    ];

    const scheduleMap = new Map<number, ProviderSchedule>();
    schedules.forEach((s) => scheduleMap.set(s.day_of_week, s));

    this.days.set(
      dayNames.map((dn) => {
        const schedule = scheduleMap.get(dn.day);
        return {
          day_of_week: dn.day,
          label: dn.label,
          shortLabel: dn.short,
          is_active: schedule?.is_active ?? false,
          start_time: schedule?.start_time ?? '09:00',
          end_time: schedule?.end_time ?? '18:00',
          editing: false,
        };
      }),
    );
    this.emitStats();
  }

  // Calculate bar position as percentage
  getBarLeft(day: ScheduleDay): number {
    if (!day.is_active) return 0;
    const startMinutes = this.timeToMinutes(day.start_time);
    const rangeStartMin = this.RANGE_START * 60;
    const totalMin = this.RANGE_HOURS * 60;
    return Math.max(0, ((startMinutes - rangeStartMin) / totalMin) * 100);
  }

  getBarWidth(day: ScheduleDay): number {
    if (!day.is_active) return 0;
    const startMinutes = this.timeToMinutes(day.start_time);
    const endMinutes = this.timeToMinutes(day.end_time);
    const totalMin = this.RANGE_HOURS * 60;
    return Math.max(0, ((endMinutes - startMinutes) / totalMin) * 100);
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  formatTimeShort(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return m === 0 ? `${hour}${ampm}` : `${hour}:${m.toString().padStart(2, '0')}${ampm}`;
  }

  formatHourMarker(hour: number): string {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    return `${h}${ampm}`;
  }

  private emitStats(): void {
    const days = this.days();
    const active = days.filter(d => d.is_active);
    let totalMin = 0;
    for (const d of active) {
      const [sh, sm] = d.start_time.split(':').map(Number);
      const [eh, em] = d.end_time.split(':').map(Number);
      totalMin += (eh * 60 + em) - (sh * 60 + sm);
    }
    this.scheduleChanged.emit({ activeDays: active.length, weeklyHours: Math.round(totalMin / 60) });
  }

  toggleDay(index: number): void {
    const updated = [...this.days()];
    updated[index] = { ...updated[index], is_active: !updated[index].is_active };
    this.days.set(updated);
    this.emitStats();
  }

  startEditing(index: number): void {
    const updated = this.days().map((d, i) => ({
      ...d,
      editing: i === index ? true : false,
    }));
    this.days.set(updated);
  }

  stopEditing(index: number): void {
    const updated = [...this.days()];
    updated[index] = { ...updated[index], editing: false };
    this.days.set(updated);
  }

  updateTime(index: number, field: 'start_time' | 'end_time', value: string): void {
    const updated = [...this.days()];
    updated[index] = { ...updated[index], [field]: value };
    this.days.set(updated);
    this.emitStats();
  }

  // Quick actions
  applyPreset(preset: 'weekdays-9-6' | 'weekdays-8-5' | 'all-week'): void {
    const updated = this.days().map((d) => {
      if (preset === 'weekdays-9-6') {
        const isWeekday = d.day_of_week >= 1 && d.day_of_week <= 5;
        return { ...d, is_active: isWeekday, start_time: '09:00', end_time: '18:00', editing: false };
      }
      if (preset === 'weekdays-8-5') {
        const isWeekday = d.day_of_week >= 1 && d.day_of_week <= 5;
        return { ...d, is_active: isWeekday, start_time: '08:00', end_time: '17:00', editing: false };
      }
      // all-week
      return { ...d, is_active: true, start_time: '08:00', end_time: '20:00', editing: false };
    });
    this.days.set(updated);
    this.emitStats();
  }

  copyToAll(): void {
    const activeDay = this.days().find((d) => d.is_active);
    if (!activeDay) return;
    const updated = this.days().map((d) => ({
      ...d,
      is_active: true,
      start_time: activeDay.start_time,
      end_time: activeDay.end_time,
      editing: false,
    }));
    this.days.set(updated);
    this.emitStats();
  }

  save(): void {
    this.saving.set(true);
    const items = this.days().map((d) => ({
      day_of_week: d.day_of_week,
      is_active: d.is_active,
      start_time: d.start_time,
      end_time: d.end_time,
    }));

    this.reservationsService
      .upsertProviderSchedule(this.providerId(), items)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => this.toastService.success('Horario guardado'),
        error: () => this.toastService.error('Error al guardar horario'),
      });
  }
}
