import { Component, input, output } from '@angular/core';

import { TimeRange } from '../../interfaces';

@Component({
  selector: 'app-time-range-selector',
  standalone: true,
  imports: [],
  template: `
    <div class="inline-flex rounded-lg overflow-hidden" style="border: 1px solid var(--color-border);">
      @for (option of options; track trackByValue($index, option)) {
        <button
          (click)="select(option.value)"
          class="px-3 py-1.5 text-xs font-medium transition-colors duration-150"
          [style.background]="selected() === option.value ? 'var(--color-primary)' : 'var(--color-surface)'"
          [style.color]="selected() === option.value ? 'white' : 'var(--color-text-secondary)'"
          [style.border-right]="option.value !== '7d' ? '1px solid var(--color-border)' : 'none'"
          >
          {{ option.label }}
        </button>
      }
    </div>
    `,
})
export class TimeRangeSelectorComponent {
  readonly selected = input<TimeRange>('1h');
  readonly rangeChange = output<TimeRange>();

  readonly options: { label: string; value: TimeRange }[] = [
    { label: '1h', value: '1h' },
    { label: '6h', value: '6h' },
    { label: '24h', value: '24h' },
    { label: '7d', value: '7d' },
  ];

  trackByValue(index: number, option: { label: string; value: TimeRange }): string {
    return option.value;
  }

  select(value: TimeRange): void {
    this.rangeChange.emit(value);
  }
}
