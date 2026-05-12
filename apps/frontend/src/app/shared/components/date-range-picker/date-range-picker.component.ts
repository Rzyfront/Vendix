import {
  Component,
  input,
  output,
  signal,
  model,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { toLocalDateString, toUTCDateString } from '../../utils/date.util';

export interface DateRange {
  from: string | null;
  to: string | null;
}

@Component({
  selector: 'app-date-range-picker',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="flex flex-col md:flex-row gap-2 items-center" [formGroup]="rangeForm">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-500">Desde</label>
        <input
          type="date"
          formControlName="from"
          class="px-3 py-2 border border-border rounded-button bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-shadow"
          [max]="rangeForm.get('to')?.value || undefined"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-500">Hasta</label>
        <input
          type="date"
          formControlName="to"
          class="px-3 py-2 border border-border rounded-button bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-shadow"
          [min]="rangeForm.get('from')?.value || undefined"
        />
      </div>
      @if (showClear() && hasValue()) {
        <button
          type="button"
          (click)="clear()"
          class="mt-5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-button transition-colors"
        >
          Limpiar
        </button>
      }
    </div>
  `,
})
export class DateRangePickerComponent {
  readonly initialFrom = input<string | null>(null);
  readonly initialTo = input<string | null>(null);
  readonly showClear = input<boolean>(true);

  readonly dateRangeChange = output<DateRange>();

  readonly rangeForm: FormGroup;
  private destroyRef = inject(DestroyRef);

  constructor() {
    this.rangeForm = new FormGroup({
      from: new FormControl(this.initialFrom()),
      to: new FormControl(this.initialTo()),
    });

    this.rangeForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.dateRangeChange.emit({
          from: value.from,
          to: value.to,
        });
      });
  }

  hasValue(): boolean {
    const from = this.rangeForm.get('from')?.value;
    const to = this.rangeForm.get('to')?.value;
    return !!(from || to);
  }

  clear(): void {
    this.rangeForm.reset({ from: null, to: null });
  }

  setRange(from: string | null, to: string | null): void {
    this.rangeForm.setValue({ from, to });
  }
}
