import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-grace-threshold-editor',
  standalone: true,
  imports: [FormsModule, InputComponent],
  template: `
    <div class="space-y-4">
      <div class="flex items-center gap-4">
        <app-input
          type="number"
          label="Grace Period (days)"
          [(ngModel)]="days"
          (ngModelChange)="emitChange()"
          [min]="0"
          [max]="90"
        ></app-input>
      </div>

      <div class="flex flex-wrap gap-2">
        @for (preset of presets; track preset) {
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded-lg border border-border bg-surface hover:bg-gray-50 transition-colors"
            [class.bg-primary\/10]="days() === preset"
            [class.border-primary]="days() === preset"
            [class.text-primary]="days() === preset"
            (click)="setDays(preset)"
          >
            {{ preset }} days
          </button>
        }
      </div>

      <p class="text-sm text-text-secondary">
        Subscriptions will enter grace period for <strong>{{ days() }}</strong> days after the billing cycle ends before suspension.
      </p>
    </div>
  `,
})
export class GraceThresholdEditorComponent {
  readonly days = signal(7);
  readonly valueChange = output<number>();

  readonly initialValue = input<number | undefined>(undefined);
  readonly presets = [3, 7, 14, 30];

  constructor() {
    const initial = this.initialValue();
    if (initial !== undefined) {
      this.days.set(initial);
    }
  }

  setDays(value: number): void {
    this.days.set(value);
    this.emitChange();
  }

  emitChange(): void {
    this.valueChange.emit(this.days());
  }
}
