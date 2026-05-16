import { Component, input, output, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';
import { DateRangeFilter } from '../../interfaces/analytics.interface';

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
  imports: [
    FormsModule,
    SelectorComponent,
  ],
  template: `
    <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
      <!-- Preset Selector -->
      <div class="w-full sm:w-40 flex-shrink-0">
        <app-selector
          [options]="presetOptions"
          [ngModel]="selectedPreset()"
          (ngModelChange)="onPresetChange($event)"
          size="sm"
          placeholder="Período"
        ></app-selector>
      </div>

      <!-- Date Input -->
      <input
        type="date"
        [ngModel]="selectedDate()"
        (ngModelChange)="onDateChange($event)"
        class="px-3 py-2 text-sm border border-black rounded-xl bg-[var(--color-background)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 transition-colors w-full sm:w-40"
      />
    </div>
  `,
})
export class DateRangeFilterComponent {
  value = input<DateRangeFilter | undefined>();
  valueChange = output<DateRangeFilter>();

  selectedPreset = signal<DatePreset>('thisMonth');
  selectedDate = signal<string>('');

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
    const initialValue = this.value();
    if (initialValue?.preset && initialValue.preset !== 'custom') {
      this.selectedPreset.set(initialValue.preset as DatePreset);
    }

    const range = this.getDateRange(this.selectedPreset());
    if (range) {
      this.selectedDate.set(range.start_date);
    }
  }

  onPresetChange(preset: string): void {
    this.selectedPreset.set(preset as DatePreset);
    const range = this.getDateRange(preset as DatePreset);
    if (range) {
      this.selectedDate.set(range.start_date);
      console.log('=== Preset changed ===', preset, JSON.stringify(range));
      this.valueChange.emit(range);
    }
  }

  onDateChange(date: string): void {
    this.selectedDate.set(date);
    const range: DateRangeFilter = {
      start_date: date,
      end_date: date,
      preset: this.selectedPreset(),
    };
    console.log('=== Date changed ===', date, JSON.stringify(range));
    this.valueChange.emit(range);
  }

  private getDateRange(preset: DatePreset): DateRangeFilter | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start: Date;
    let end: Date;

    switch (preset) {
      case 'today':
        start = today;
        end = today;
        break;
      case 'yesterday':
        start = new Date(today);
        start.setDate(start.getDate() - 1);
        end = start;
        break;
      case 'thisWeek':
        start = new Date(today);
        start.setDate(start.getDate() - start.getDay());
        end = today;
        break;
      case 'lastWeek':
        start = new Date(today);
        start.setDate(start.getDate() - start.getDay() - 7);
        end = new Date(start);
        end.setDate(end.getDate() + 6);
        break;
      case 'thisMonth':
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = today;
        break;
      case 'lastMonth':
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case 'thisYear':
        start = new Date(today.getFullYear(), 0, 1);
        end = today;
        break;
      case 'lastYear':
        start = new Date(today.getFullYear() - 1, 0, 1);
        end = new Date(today.getFullYear() - 1, 11, 31);
        break;
      default:
        return null;
    }

    return {
      start_date: toLocalDateString(start),
      end_date: toLocalDateString(end),
      preset,
    };
  }
}
