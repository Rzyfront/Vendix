import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-margin-cap-input',
  standalone: true,
  imports: [FormsModule, InputComponent],
  template: `
    <div class="space-y-2">
      <app-input
        type="number"
        label="Partner Margin %"
        [(ngModel)]="percent"
        (ngModelChange)="emitChange()"
        [min]="0"
        [max]="100"
        helpText="Percentage of each subscription the partner earns"
      >
        <span slot="suffix">%</span>
      </app-input>

      <app-input
        [currency]="true"
        label="Margin Cap (optional)"
        [(ngModel)]="cap"
        (ngModelChange)="emitChange()"
        helpText="Maximum monthly payout per store"
      >
        <span slot="prefix-icon">$</span>
      </app-input>
    </div>
  `,
})
export class MarginCapInputComponent {
  readonly percent = signal(10);
  readonly cap = signal<number | null>(null);

  readonly initialPercent = input<number | undefined>(undefined);
  readonly initialCap = input<number | null | undefined>(undefined);

  readonly valueChange = output<{ percent: number; cap: number | null }>();

  constructor() {
    const p = this.initialPercent();
    if (p !== undefined) this.percent.set(p);
    const c = this.initialCap();
    if (c !== undefined) this.cap.set(c);
  }

  emitChange(): void {
    this.valueChange.emit({ percent: this.percent(), cap: this.cap() });
  }
}
