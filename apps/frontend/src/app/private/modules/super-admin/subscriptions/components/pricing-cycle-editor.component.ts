import { Component, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlanPricing } from '../interfaces/subscription-admin.interface';
import { InputComponent, SelectorComponent, ButtonComponent, IconComponent } from '../../../../../shared/components';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';

@Component({
  selector: 'app-pricing-cycle-editor',
  standalone: true,
  imports: [FormsModule, InputComponent, SelectorComponent, ButtonComponent, IconComponent],
  template: `
    <div class="space-y-3">
      @for (item of pricing(); track item.id || $index; let i = $index) {
        <div class="flex items-center gap-3 p-3 bg-surface rounded-lg border border-border">
          <div class="flex-1">
            <app-selector
              [options]="cycleOptions"
              [(ngModel)]="item.billing_cycle"
              (ngModelChange)="updateItem(i, 'billing_cycle', $event)"
              size="sm"
            ></app-selector>
          </div>
          <div class="flex-1">
            <app-input
              [currency]="true"
              [(ngModel)]="item.price"
              (ngModelChange)="updateItem(i, 'price', $event)"
              size="sm"
            >
              <span slot="prefix-icon">$</span>
            </app-input>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="p-1.5 rounded-md hover:bg-gray-100 text-text-secondary"
              [class.text-primary]="item.is_default"
              (click)="setDefault(i)"
              title="Set as default"
            >
              <app-icon name="star" [size]="16"></app-icon>
            </button>
            <button
              type="button"
              class="p-1.5 rounded-md hover:bg-red-50 text-text-secondary hover:text-red-500"
              (click)="removeItem(i)"
            >
              <app-icon name="trash-2" [size]="16"></app-icon>
            </button>
          </div>
        </div>
      }

      <app-button variant="outline" size="sm" (clicked)="addItem()">
        <app-icon name="plus" [size]="16" slot="icon"></app-icon>
        Add Cycle
      </app-button>
    </div>
  `,
})
export class PricingCycleEditorComponent {
  readonly pricing = signal<PlanPricing[]>([]);
  readonly valueChange = output<PlanPricing[]>();

  readonly cycleOptions = [
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'biannual', label: 'Biannual' },
    { value: 'annual', label: 'Annual' },
  ];

  readonly initialValue = input<PlanPricing[] | undefined>(undefined);

  private readonly userTouched = signal(false);

  constructor() {
    effect(() => {
      const v = this.initialValue();
      const touched = untracked(() => this.userTouched());
      if (touched) return;

      if (v && v.length > 0) {
        this.pricing.set(v);
      } else if (untracked(() => this.pricing().length) === 0) {
        this.pricing.set([
          { id: crypto.randomUUID(), billing_cycle: 'monthly', price: 0, currency_code: 'COP', is_default: true },
        ]);
      }
    });
  }

  private markTouched(): void {
    this.userTouched.set(true);
  }

  addItem(): void {
    this.markTouched();
    this.pricing.update((list) => [
      ...list,
      { id: crypto.randomUUID(), billing_cycle: 'monthly', price: 0, currency_code: 'COP', is_default: list.length === 0 },
    ]);
    this.emitChange();
  }

  removeItem(index: number): void {
    this.markTouched();
    this.pricing.update((list) => {
      const next = list.filter((_, i) => i !== index);
      if (next.length > 0 && !next.some((p) => p.is_default)) {
        next[0].is_default = true;
      }
      return next;
    });
    this.emitChange();
  }

  setDefault(index: number): void {
    this.markTouched();
    this.pricing.update((list) =>
      list.map((p, i) => ({ ...p, is_default: i === index })),
    );
    this.emitChange();
  }

  updateItem(index: number, key: keyof PlanPricing, value: any): void {
    this.markTouched();
    this.pricing.update((list) => {
      const next = [...list];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
    this.emitChange();
  }

  emitChange(): void {
    this.valueChange.emit(this.pricing());
  }
}
