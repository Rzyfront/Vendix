import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TimeRange } from '../../interfaces';

@Component({
  selector: 'app-time-range-selector',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="inline-flex rounded-lg overflow-hidden" style="border: 1px solid var(--color-border);">
      <button
        *ngFor="let option of options"
        (click)="select(option.value)"
        class="px-3 py-1.5 text-xs font-medium transition-colors duration-150"
        [style.background]="selected === option.value ? 'var(--color-primary)' : 'var(--color-surface)'"
        [style.color]="selected === option.value ? 'white' : 'var(--color-text-secondary)'"
        [style.border-right]="option.value !== '7d' ? '1px solid var(--color-border)' : 'none'"
      >
        {{ option.label }}
      </button>
    </div>
  `,
})
export class TimeRangeSelectorComponent {
  @Input() selected: TimeRange = '1h';
  @Output() rangeChange = new EventEmitter<TimeRange>();

  readonly options: { label: string; value: TimeRange }[] = [
    { label: '1h', value: '1h' },
    { label: '6h', value: '6h' },
    { label: '24h', value: '24h' },
    { label: '7d', value: '7d' },
  ];

  select(value: TimeRange): void {
    this.rangeChange.emit(value);
  }
}
