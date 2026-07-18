import {
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import {
  ButtonComponent,
  EmptyStateComponent,
  IconComponent,
  StatsCardComponent,
} from '../../../../../../shared/components';
import { ReservationsService } from '../../services/reservations.service';
import { BusinessHoursRow } from '../../interfaces/reservation.interface';

const DAY_LABELS: Array<{ dow: number; label: string; short: string }> = [
  { dow: 0, label: 'Domingo', short: 'Dom' },
  { dow: 1, label: 'Lunes', short: 'Lun' },
  { dow: 2, label: 'Martes', short: 'Mar' },
  { dow: 3, label: 'Miércoles', short: 'Mié' },
  { dow: 4, label: 'Jueves', short: 'Jue' },
  { dow: 5, label: 'Viernes', short: 'Vie' },
  { dow: 6, label: 'Sábado', short: 'Sáb' },
];

interface DayRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

/**
 * Master calendar of the store's open hours. The booking flow intersects
 * provider schedules against these windows so a provider can't be booked
 * outside the store's open hours.
 *
 * Save behavior: `PUT /store/business-hours` replaces every row for the
 * days listed. Days not listed are deactivated (closed). Closed days
 * keep their `is_active = false` flag so the panel re-loads cleanly.
 */
@Component({
  selector: 'app-business-hours',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    StatsCardComponent,
  ],
  templateUrl: './business-hours.component.html',
  styleUrls: ['./business-hours.component.scss'],
})
export class BusinessHoursComponent implements OnInit {
  private readonly reservations = inject(ReservationsService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly rows = signal<DayRow[]>([]);
  readonly errorMsg = signal<string | null>(null);
  readonly successMsg = signal<string | null>(null);

  readonly dayLabels = DAY_LABELS;
  readonly activeDays = computed(() =>
    this.rows().filter((r) => r.is_active && r.start_time && r.end_time).length,
  );

  ngOnInit(): void {
    this.reservations.getBusinessHours().subscribe({
      next: (data) => {
        const rows: DayRow[] = [];
        for (let dow = 0; dow <= 6; dow++) {
          const row = data.find((r) => r.day_of_week === dow);
          rows.push({
            day_of_week: dow,
            start_time: row?.start_time ?? '09:00',
            end_time: row?.end_time ?? '18:00',
            is_active: row?.is_active ?? false,
          });
        }
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: () => {
        // No rows yet — show empty state with default 09:00-18:00 for active days.
        const rows: DayRow[] = [];
        for (let dow = 0; dow <= 6; dow++) {
          rows.push({
            day_of_week: dow,
            start_time: '09:00',
            end_time: '18:00',
            is_active: dow >= 1 && dow <= 5, // Mon-Fri by default
          });
        }
        this.rows.set(rows);
        this.loading.set(false);
      },
    });
  }

  toggleDay(dow: number): void {
    this.rows.update((rows) =>
      rows.map((r) =>
        r.day_of_week === dow ? { ...r, is_active: !r.is_active } : r,
      ),
    );
  }

  updateField<K extends keyof DayRow>(
    dow: number,
    field: K,
    value: DayRow[K],
  ): void {
    this.rows.update((rows) =>
      rows.map((r) =>
        r.day_of_week === dow ? { ...r, [field]: value } : r,
      ),
    );
  }

  row(dow: number): DayRow | undefined {
    return this.rows().find((r) => r.day_of_week === dow);
  }

  save(): void {
    const activeRows = this.rows().filter((r) => r.is_active);
    if (activeRows.length === 0) {
      this.errorMsg.set('Debes activar al menos un día');
      return;
    }
    // Validate end > start for active rows.
    for (const r of activeRows) {
      if (r.start_time >= r.end_time) {
        const dayLabel = DAY_LABELS.find((d) => d.dow === r.day_of_week)?.label;
        this.errorMsg.set(
          `${dayLabel}: la hora de cierre debe ser mayor que la hora de apertura`,
        );
        return;
      }
    }
    this.errorMsg.set(null);
    this.saving.set(true);
    const payload: BusinessHoursRow[] = activeRows.map((r) => ({
      day_of_week: r.day_of_week,
      start_time: r.start_time,
      end_time: r.end_time,
      is_active: true,
    }));
    this.reservations.upsertBusinessHours(payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.successMsg.set('Horario guardado');
        setTimeout(() => this.successMsg.set(null), 3_000);
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMsg.set(err?.error?.message ?? 'No se pudo guardar');
      },
    });
  }
}