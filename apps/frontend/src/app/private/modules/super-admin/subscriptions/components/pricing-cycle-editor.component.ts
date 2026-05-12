import { Component, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlanPricing } from '../interfaces/subscription-admin.interface';
import { InputComponent, SelectorComponent, ButtonComponent, IconComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-pricing-cycle-editor',
  standalone: true,
  imports: [FormsModule, InputComponent, SelectorComponent, ButtonComponent, IconComponent],
  template: `
    <div class="space-y-3">
      @if (isFreePlan()) {
        <div class="rounded-lg border border-border bg-background p-3 text-sm text-text-secondary">
          Plan gratuito activo: los ciclos siguen definiendo la periodicidad, pero el importe se
          guarda como cero para evitar cobros accidentales.
        </div>
      }

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
              [disabled]="isFreePlan()"
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
              title="Marcar como ciclo principal"
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
        Agregar ciclo
      </app-button>
    </div>
  `,
})
export class PricingCycleEditorComponent {
  readonly pricing = signal<PlanPricing[]>([]);
  readonly valueChange = output<PlanPricing[]>();
  readonly isFreePlan = input(false);

  readonly cycleOptions = [
    { value: 'monthly', label: 'Mensual' },
    { value: 'quarterly', label: 'Trimestral' },
    { value: 'semiannual', label: 'Semestral' },
    { value: 'annual', label: 'Anual' },
  ];

  readonly initialValue = input<PlanPricing[] | undefined>(undefined);

  private lastInitialSnapshot = '';

  constructor() {
    effect(() => {
      const v = this.initialValue();
      const snapshot = JSON.stringify(v ?? []);
      if (snapshot === this.lastInitialSnapshot) return;

      if (v && v.length > 0) {
        this.lastInitialSnapshot = snapshot;
        this.pricing.set(v.map((item) => ({ ...item })));
      } else if (untracked(() => this.pricing().length) === 0) {
        this.lastInitialSnapshot = snapshot;
        this.pricing.set([
          { id: crypto.randomUUID(), billing_cycle: 'monthly', price: 0, currency_code: 'COP', is_default: true },
        ]);
      }
    });

    effect(() => {
      if (!this.isFreePlan()) return;
      const current = this.pricing();
      if (current.some((item) => Number(item.price) !== 0)) {
        this.pricing.set(current.map((item) => ({ ...item, price: 0 })));
        this.emitChange();
      }
    });
  }

  addItem(): void {
    this.pricing.update((list) => [
      ...list,
      { id: crypto.randomUUID(), billing_cycle: 'monthly', price: 0, currency_code: 'COP', is_default: list.length === 0 },
    ]);
    this.emitChange();
  }

  removeItem(index: number): void {
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
    this.pricing.update((list) =>
      list.map((p, i) => ({ ...p, is_default: i === index })),
    );
    this.emitChange();
  }

  updateItem(index: number, key: keyof PlanPricing, value: any): void {
    this.pricing.update((list) => {
      const next = [...list];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
    this.emitChange();
  }

  emitChange(): void {
    const next = this.isFreePlan()
      ? this.pricing().map((item) => ({ ...item, price: 0 }))
      : this.pricing();
    this.valueChange.emit(next);
  }
}
