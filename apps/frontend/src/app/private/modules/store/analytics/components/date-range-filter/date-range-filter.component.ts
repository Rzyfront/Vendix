import { Component, input, output, signal, computed } from '@angular/core';

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
  | 'lastYear'
  | 'custom';

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

      <!-- Date Range Inputs (only when custom is selected) -->
      @if (selectedPreset() === 'custom') {
        <div class="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="date"
            [ngModel]="customStartDate()"
            (ngModelChange)="onStartDateChange($event)"
            class="flex-1 sm:flex-none px-3 py-2 text-sm border-[3px] border-black rounded-2xl bg-background text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors w-full sm:w-32"
          />
          <span class="text-text-secondary text-sm">-</span>
          <input
            type="date"
            [ngModel]="customEndDate()"
            (ngModelChange)="onEndDateChange($event)"
            class="flex-1 sm:flex-none px-3 py-2 text-sm border-[3px] border-black rounded-2xl bg-background text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors w-full sm:w-32"
          />
        </div>
      } @else {
        <!-- Compact date range display pill -->
        <div class="hidden sm:flex items-center gap-2 text-sm">
          <span class="px-3 py-1.5 bg-background text-text-primary rounded-2xl border-[3px] border-black font-medium">
            {{ dateRangeLabel() }}
          </span>
        </div>
      }
    </div>
  `,
})
export class DateRangeFilterComponent {
  value = input<DateRangeFilter | undefined>();
  valueChange = output<DateRangeFilter>();

  selectedPreset = signal<DatePreset>('thisMonth');
  customStartDate = signal<string>('');
  customEndDate = signal<string>('');

  presetOptions: SelectorOption[] = [
    { value: 'today', label: 'Hoy' },
    { value: 'yesterday', label: 'Ayer' },
    { value: 'thisWeek', label: 'Esta Semana' },
    { value: 'lastWeek', label: 'Semana Pasada' },
    { value: 'thisMonth', label: 'Este Mes' },
    { value: 'lastMonth', label: 'Mes Pasado' },
    { value: 'thisYear', label: 'Este Año' },
    { value: 'lastYear', label: 'Año Pasado' },
    { value: 'custom', label: 'Personalizado' },
  ];

  dateRangeLabel = computed(() => {
    const range = this.getDateRange(this.selectedPreset());
    if (!range) return '';
    const start = new Date(range.start_date).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });
    const end = new Date(range.end_date).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });
    return `${start} - ${end}`;
  });

  constructor() {
    const initialValue = this.value();
    if (initialValue?.preset) {
      this.selectedPreset.set(initialValue.preset);
    }
    if (initialValue?.start_date) {
      this.customStartDate.set(initialValue.start_date);
    }
    if (initialValue?.end_date) {
      this.customEndDate.set(initialValue.end_date);
    }

    if (!this.customStartDate() || !this.customEndDate()) {
      const defaultRange = this.getDateRange(this.selectedPreset());
      if (defaultRange) {
        this.customStartDate.set(defaultRange.start_date);
        this.customEndDate.set(defaultRange.end_date);
      }
    }
  }

  onPresetChange(preset: string): void {
    this.selectedPreset.set(preset as DatePreset);
    if (preset !== 'custom') {
      const range = this.getDateRange(preset as DatePreset);
      if (range) {
        this.customStartDate.set(range.start_date);
        this.customEndDate.set(range.end_date);
        this.valueChange.emit(range);
      }
    }
  }

  onStartDateChange(date: string): void {
    this.customStartDate.set(date);
    this.selectedPreset.set('custom');
    this.emitCustomRange();
  }

  onEndDateChange(date: string): void {
    this.customEndDate.set(date);
    this.selectedPreset.set('custom');
    this.emitCustomRange();
  }

  private emitCustomRange(): void {
    const start = this.customStartDate();
    const end = this.customEndDate();
    if (start && end) {
      this.valueChange.emit({
        start_date: start,
        end_date: end,
        preset: 'custom',
      });
    }
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
