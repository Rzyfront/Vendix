import { Component, input, output, signal, inject, effect } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { DateRangeSyncService } from '../../../shared/services/date-range-sync.service';

type DatePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear';

@Component({
  selector: 'vendix-date-range-filter',
  standalone: true,
  imports: [FormsModule, InputComponent, SelectorComponent],
  template: `
    <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
      <!-- Preset Selector -->
      <div class="w-full sm:w-40 flex-shrink-0">
        <app-selector
          [options]="presetOptions"
          [ngModel]="selectedPreset()"
          (ngModelChange)="onPresetChange($event)"
          size="sm"
          label="Período"
          placeholder="Selecciona un período"
        ></app-selector>
      </div>

      <!-- Start date -->
      <div class="w-full sm:w-40 flex-shrink-0">
        <app-input
          type="date"
          size="sm"
          [label]="'Desde'"
          [ngModel]="startDate()"
          (ngModelChange)="onStartDateChange($event)"
          [max]="endDate() || undefined"
        ></app-input>
      </div>

      <!-- End date -->
      <div class="w-full sm:w-40 flex-shrink-0">
        <app-input
          type="date"
          size="sm"
          [label]="'Hasta'"
          [ngModel]="endDate()"
          (ngModelChange)="onEndDateChange($event)"
          [min]="startDate() || undefined"
        ></app-input>
      </div>

      <!--
        QUI-609 chip — when a preset is active and the local dates are empty
        (meaning the backend resolves the range against stores.timezone),
        surface that fact so the user knows why the inputs look blank and what
        the analytics screen will compute against. The fully resolved range
        (e.g. "1–4 ago 2026 · hora de la tienda") would require every analytics
        response to carry period: { start_date, end_date, label } — a follow-up
        change. For now the chip shows the preset name as the visible anchor of
        "what range is active".
      -->
      @if (selectedPreset() && (selectedPreset() as string) !== 'custom' && !startDate() && !endDate()) {
        <span
          class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200"
          data-testid="date-range-resolved-chip"
          aria-live="polite"
        >
          {{ activePresetLabel() }} · hora de la tienda
        </span>
      }
    </div>
  `,
})
export class DateRangeFilterComponent {
  private readonly dateRangeSync = inject(DateRangeSyncService);

  value = input<DateRangeFilter | undefined>();
  valueChange = output<DateRangeFilter>();

  selectedPreset = signal<DatePreset>('thisMonth');
  startDate = signal<string>('');
  endDate = signal<string>('');

  presetOptions: SelectorOption[] = [
    { value: 'today', label: 'Hoy' },
    { value: 'yesterday', label: 'Ayer' },
    { value: 'thisWeek', label: 'Esta Semana' },
    { value: 'lastWeek', label: 'Semana Pasada' },
    { value: 'thisMonth', label: 'Este Mes' },
    { value: 'lastMonth', label: 'Mes Pasado' },
    { value: 'thisYear', label: 'Este Año' },
    { value: 'lastYear', label: 'Año Pasado' },
  ];

  constructor() {
    // React to external value changes (e.g., navigation from analytics to reports)
    effect(() => {
      const v = this.value();
      if (v?.preset && v.preset !== 'custom') {
        this.selectedPreset.set(v.preset as DatePreset);
      }
      if (v?.start_date) {
        this.startDate.set(v.start_date);
      }
      if (v?.end_date) {
        this.endDate.set(v.end_date);
      }
    });
  }

  onPresetChange(preset: string): void {
    this.selectedPreset.set(preset as DatePreset);
    // QUIs-609: the device clock does NOT define "today" — the store's timezone
    // does. We let the backend resolve the preset against `stores.timezone`
    // (via `localCalendarRange` in `store-timezone.util`), so we no longer
    // derive `start_date` / `end_date` locally. Empty strings are sent so the
    // service knows to drop them and forward `date_preset` instead. The
    // resolved range comes back via `value()` from the parent and the effect
    // above repopulates the inputs.
    this.startDate.set('');
    this.endDate.set('');
    this.emitRange(preset as DatePreset);
  }

  onStartDateChange(date: string): void {
    this.startDate.set(date);
    // Clamp end_date if it is now before start_date.
    const end = this.endDate();
    const clampedEnd = end && end < date ? date : end;
    if (clampedEnd !== end) {
      this.endDate.set(clampedEnd!);
    }
    this.emitRange('custom');
  }

  onEndDateChange(date: string): void {
    this.endDate.set(date);
    this.emitRange('custom');
  }

  private emitRange(preset: DateRangeFilter['preset']): void {
    const range: DateRangeFilter = {
      start_date: this.startDate(),
      end_date: this.endDate(),
      preset,
    };
    this.dateRangeSync.setDateRange(range);
    this.valueChange.emit(range);
  }

  /** Human label for the chip, derived from the active preset. */
  activePresetLabel(): string {
    const opt = this.presetOptions.find((o) => o.value === this.selectedPreset());
    return opt?.label ?? String(this.selectedPreset());
  }
}
