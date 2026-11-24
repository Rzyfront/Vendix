import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import {
  ButtonComponent,
  IconComponent,
  ToggleComponent,
} from '../../../../../../shared/components';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ReservationsService } from '../../services/reservations.service';
import { StoreSettingsService } from '../../../settings/general/services/store-settings.service';
import {
  BusinessHoursDay,
  DAY_LABELS,
  MAX_BLOCKS_PER_DAY,
  daysFromRows,
  endsNextDay,
  toPayload,
  validateDays,
} from './business-hours.util';

/**
 * Store opening hours (Agenda → Configuración → Horario). It is the store's
 * ONE schedule: the same `settings.pos.business_hours` that Settings → Sales
 * edits and that bookings, the agenda and "open now" read. A block whose close
 * is at or before its open ends the next day (17:00–04:00); «24 horas» opens
 * the whole day, and consecutive 24 h days are continuous.
 */
@Component({
  selector: 'app-business-hours',
  standalone: true,
  imports: [RouterLink, CardComponent, ButtonComponent, IconComponent, ToggleComponent, StatsComponent],
  templateUrl: './business-hours.component.html',
  styleUrls: ['./business-hours.component.scss'],
})
export class BusinessHoursComponent implements OnInit {
  private readonly reservations = inject(ReservationsService);
  private readonly storeSettings = inject(StoreSettingsService);

  /** Settings → Sales, where the same schedule (and the POS rules) live. */
  readonly salesSettingsRoute = '/admin/settings/general/venta';
  readonly maxBlocks = MAX_BLOCKS_PER_DAY;
  readonly dayLabels = DAY_LABELS;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly days = signal<BusinessHoursDay[]>([]);
  readonly errorMsg = signal<string | null>(null);
  readonly successMsg = signal<string | null>(null);

  readonly activeDays = computed(() => this.days().filter((d) => d.is_active).length);
  readonly fullDays = computed(() => this.days().filter((d) => d.is_active && d.is_24h).length);

  ngOnInit(): void {
    this.reservations.getBusinessHours().subscribe({
      next: (rows) => {
        this.days.set(daysFromRows(rows));
        this.loading.set(false);
      },
      error: () => {
        this.days.set(daysFromRows([]));
        this.errorMsg.set('No se pudo cargar el horario de la tienda');
        this.loading.set(false);
      },
    });
  }

  day(dow: number): BusinessHoursDay | undefined {
    return this.days().find((d) => d.day_of_week === dow);
  }

  private patch(dow: number, change: (d: BusinessHoursDay) => BusinessHoursDay): void {
    this.days.update((days) => days.map((d) => (d.day_of_week === dow ? change(d) : d)));
    this.successMsg.set(null);
  }

  toggleDay(dow: number): void {
    this.patch(dow, (d) => ({ ...d, is_active: !d.is_active }));
  }

  toggle24h(dow: number): void {
    this.patch(dow, (d) => ({ ...d, is_24h: !d.is_24h }));
  }

  updateBlock(dow: number, index: number, field: 'start_time' | 'end_time', value: string): void {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? '')) return;
    this.patch(dow, (d) => ({
      ...d,
      blocks: d.blocks.map((b, i) => (i === index ? { ...b, [field]: value } : b)),
    }));
  }

  addBlock(dow: number): void {
    this.patch(dow, (d) =>
      d.blocks.length >= MAX_BLOCKS_PER_DAY
        ? d
        : { ...d, blocks: [...d.blocks, { start_time: '14:00', end_time: '18:00' }] },
    );
  }

  removeBlock(dow: number, index: number): void {
    this.patch(dow, (d) =>
      d.blocks.length <= 1 ? d : { ...d, blocks: d.blocks.filter((_, i) => i !== index) },
    );
  }

  endsNextDay = endsNextDay;

  save(): void {
    const problem = validateDays(this.days());
    if (problem) {
      this.errorMsg.set(problem);
      return;
    }
    this.errorMsg.set(null);
    this.saving.set(true);
    this.reservations.upsertBusinessHours(toPayload(this.days())).subscribe({
      next: (rows) => {
        if (Array.isArray(rows) && rows.length) this.days.set(daysFromRows(rows));
        this.saving.set(false);
        this.successMsg.set('Horario guardado. Ya aplica a reservas, agenda y Ajustes → Venta.');
        // The agenda grids and the POS read the schedule from the store
        // settings: refresh them so they use the new hours right away.
        this.storeSettings.getSettings({ forceRefresh: true }).subscribe({ error: () => undefined });
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMsg.set(err?.error?.message ?? 'No se pudo guardar');
      },
    });
  }
}
