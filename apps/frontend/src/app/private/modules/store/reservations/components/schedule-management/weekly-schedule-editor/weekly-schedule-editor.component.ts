import {
  Component,
  OnDestroy,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
  effect,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, finalize } from 'rxjs';
import { ReservationsService } from '../../../services/reservations.service';
import { ServiceSchedule } from '../../../interfaces/reservation.interface';
import {
  ButtonComponent,
  IconComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../../shared/components';

interface ScheduleRow {
  day_of_week: number;
  label: string;
  is_active: boolean;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  capacity: number;
  buffer_minutes: number;
}

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const DURATION_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 20, label: '20 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hora' },
  { value: 90, label: '1h 30min' },
  { value: 120, label: '2 horas' },
];

@Component({
  selector: 'app-weekly-schedule-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent, SpinnerComponent],
  templateUrl: './weekly-schedule-editor.component.html',
  styleUrls: ['./weekly-schedule-editor.component.scss'],
})
export class WeeklyScheduleEditorComponent implements OnDestroy {
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  readonly productId = input.required<number>();

  rows = signal<ScheduleRow[]>([]);
  loading = signal(false);
  saving = signal(false);

  readonly durationOptions = DURATION_OPTIONS;

  constructor() {
    effect(() => {
      const id = this.productId();
      if (id) {
        untracked(() => this.loadSchedule(id));
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadSchedule(productId: number): void {
    this.loading.set(true);
    this.reservationsService
      .getServiceSchedules(productId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (schedules) => this.buildRows(schedules),
        error: () => {
          this.buildRows([]);
          this.toastService.error('Error al cargar el horario');
        },
      });
  }

  private buildRows(schedules: ServiceSchedule[]): void {
    const scheduleMap = new Map<number, ServiceSchedule>();
    schedules.forEach((s) => scheduleMap.set(s.day_of_week, s));

    // Show Monday (1) to Sunday (0) in logical order
    const orderedDays = [1, 2, 3, 4, 5, 6, 0];

    const rows: ScheduleRow[] = orderedDays.map((dayIndex) => {
      const existing = scheduleMap.get(dayIndex);
      return {
        day_of_week: dayIndex,
        label: DAY_NAMES[dayIndex],
        is_active: existing?.is_active ?? false,
        start_time: existing?.start_time ?? '08:00',
        end_time: existing?.end_time ?? '18:00',
        slot_duration_minutes: existing?.slot_duration_minutes ?? 30,
        capacity: existing?.capacity ?? 1,
        buffer_minutes: existing?.buffer_minutes ?? 0,
      };
    });

    this.rows.set(rows);
  }

  onToggleDay(index: number): void {
    const current = [...this.rows()];
    current[index] = { ...current[index], is_active: !current[index].is_active };
    this.rows.set(current);
  }

  onFieldChange(index: number, field: keyof ScheduleRow, value: any): void {
    const current = [...this.rows()];
    current[index] = { ...current[index], [field]: value };
    this.rows.set(current);
  }

  saveSchedule(): void {
    this.saving.set(true);
    const items = this.rows().map((row) => ({
      day_of_week: row.day_of_week,
      is_active: row.is_active,
      start_time: row.start_time,
      end_time: row.end_time,
      slot_duration_minutes: row.slot_duration_minutes,
      capacity: row.capacity,
      buffer_minutes: row.buffer_minutes,
    }));

    this.reservationsService
      .upsertSchedule(this.productId(), items)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => this.toastService.success('Horario guardado exitosamente'),
        error: () => this.toastService.error('Error al guardar el horario'),
      });
  }
}
