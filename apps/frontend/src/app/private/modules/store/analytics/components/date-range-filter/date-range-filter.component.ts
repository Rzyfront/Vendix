import { Component, input, output, signal, inject, effect } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';
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
          placeholder="Período"
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
    const range = this.getDateRange(preset as DatePreset);
    if (range) {
      this.startDate.set(range.start_date);
      this.endDate.set(range.end_date);
      this.dateRangeSync.setDateRange(range);
      this.valueChange.emit(range);
    }
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
