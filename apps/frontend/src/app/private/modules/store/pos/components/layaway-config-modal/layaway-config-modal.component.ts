import { Component, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';

export interface LayawayConfigResult {
  down_payment_amount: number;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  num_installments: number;
  notes?: string;
  internal_notes?: string;
  installments: { amount: number; due_date: string }[];
}

@Component({
  selector: 'app-layaway-config-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      (isOpenChange)="onIsOpenChange($event)"
      (cancel)="close.emit()"
      title="Configurar Plan Separé"
      size="md"
    >
      <div class="p-4 space-y-5">
        <!-- Summary Card -->
        <div class="bg-primary/5 border border-primary/20 rounded-xl p-4">
          <div class="flex items-center gap-3 mb-2">
            <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <app-icon name="user" [size]="20" class="text-primary"></app-icon>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-bold text-text-primary truncate">{{ customer()?.name || (customer()?.first_name + ' ' + customer()?.last_name) }}</p>
              <p class="text-xs text-text-secondary truncate">{{ customer()?.email }}</p>
            </div>
          </div>
          <div class="flex justify-between items-center pt-2 border-t border-primary/10">
            <span class="text-xs text-text-secondary font-medium">Total del carrito</span>
            <span class="text-lg font-extrabold text-primary">\${{ cartTotal().toLocaleString() }}</span>
          </div>
        </div>

        <!-- Down Payment -->
        <div>
          <label class="block text-sm font-semibold text-text-primary mb-1.5">Abono inicial</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm font-medium">$</span>
            <input
              type="number"
              [ngModel]="down_payment_amount()"
              (ngModelChange)="down_payment_amount.set($event)"
              min="0"
              [max]="cartTotal()"
              step="100"
              placeholder="0"
              class="w-full pl-7 pr-3 py-2.5 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <p class="text-xs text-text-muted mt-1">Opcional. Se descuenta del total antes de generar cuotas.</p>
        </div>

        <!-- Frequency Selector -->
        <div>
          <label class="block text-sm font-semibold text-text-primary mb-1.5">Periodicidad</label>
          <div class="grid grid-cols-3 gap-2">
            @for (opt of frequencyOptions; track opt.value) {
              <button
                type="button"
                class="flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 transition-all text-center"
                [class]="frequency() === opt.value
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border bg-surface text-text-secondary hover:border-primary/30'"
                (click)="frequency.set(opt.value)"
              >
                <app-icon [name]="opt.icon" [size]="18"></app-icon>
                <span class="text-xs font-semibold">{{ opt.label }}</span>
                <span class="text-[10px] opacity-70">{{ opt.sublabel }}</span>
              </button>
            }
          </div>
        </div>

        <!-- Number of Installments -->
        <div>
          <label class="block text-sm font-semibold text-text-primary mb-1.5">Número de cuotas</label>
          <input
            type="number"
            [ngModel]="num_installments()"
            (ngModelChange)="num_installments.set($event)"
            min="1"
            max="60"
            class="w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
        </div>

        <!-- Remaining Balance -->
        <div class="bg-muted/30 rounded-xl p-3 flex justify-between items-center">
          <span class="text-sm font-medium text-text-secondary">Saldo a financiar</span>
          <span class="text-base font-extrabold" [class]="remaining_balance() > 0 ? 'text-text-primary' : 'text-destructive'">\${{ remaining_balance().toLocaleString() }}</span>
        </div>

        <!-- Installments Preview -->
        @if (installments_preview().length > 0) {
          <div>
            <label class="block text-sm font-semibold text-text-primary mb-2">Vista previa de cuotas</label>
            <div class="max-h-48 overflow-y-auto space-y-1.5 pr-1">
              @for (inst of installments_preview(); track inst.due_date; let i = $index) {
                <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-surface border border-border/50">
                  <div class="flex items-center gap-2">
                    <span class="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{{ i + 1 }}</span>
                    <span class="text-xs text-text-secondary">{{ inst.due_date }}</span>
                  </div>
                  <span class="text-sm font-bold text-text-primary">\${{ inst.amount.toLocaleString() }}</span>
                </div>
              }
            </div>
          </div>
        }

        <!-- Notes -->
        <div>
          <label class="block text-sm font-semibold text-text-primary mb-1.5">Notas (opcional)</label>
          <textarea
            [ngModel]="notes()"
            (ngModelChange)="notes.set($event)"
            rows="2"
            placeholder="Notas visibles para el cliente..."
            class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none"
          ></textarea>
        </div>

        <div>
          <label class="block text-sm font-semibold text-text-primary mb-1.5">Notas internas (opcional)</label>
          <textarea
            [ngModel]="internal_notes()"
            (ngModelChange)="internal_notes.set($event)"
            rows="2"
            placeholder="Solo visible para el equipo..."
            class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none"
          ></textarea>
        </div>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" (clicked)="close.emit()">Cancelar</app-button>
          <app-button
            variant="primary"
            (clicked)="onSave()"
            [disabled]="!isValid() || isSaving()"
            [loading]="isSaving()"
          >
            <app-icon name="calendar" [size]="16" slot="icon"></app-icon>
            Crear Plan Separé
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class LayawayConfigModalComponent {
  // Inputs
  readonly cartItems = input.required<any[]>();
  readonly cartTotal = input.required<number>();
  readonly customer = input.required<any>();
  readonly isSaving = input<boolean>(false);

  // Outputs
  readonly save = output<LayawayConfigResult>();
  readonly close = output<void>();

  // Form state
  readonly down_payment_amount = signal<number>(0);
  readonly frequency = signal<'weekly' | 'biweekly' | 'monthly'>('monthly');
  readonly num_installments = signal<number>(3);
  readonly notes = signal<string>('');
  readonly internal_notes = signal<string>('');

  readonly frequencyOptions = [
    { value: 'weekly' as const, label: 'Semanal', sublabel: 'Cada 7 días', icon: 'calendar' },
    { value: 'biweekly' as const, label: 'Quincenal', sublabel: 'Cada 14 días', icon: 'calendar' },
    { value: 'monthly' as const, label: 'Mensual', sublabel: 'Cada 30 días', icon: 'calendar' },
  ];

  readonly remaining_balance = computed(() => {
    return Math.max(0, this.cartTotal() - (this.down_payment_amount() || 0));
  });

  readonly installments_preview = computed(() => {
    const total = this.remaining_balance();
    const n = this.num_installments();
    const freq = this.frequency();
    if (n <= 0 || total <= 0) return [];

    const amount = Math.round((total / n) * 100) / 100;
    const freq_days: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30 };

    return Array.from({ length: n }, (_, i) => {
      const due = new Date();
      due.setDate(due.getDate() + freq_days[freq] * (i + 1));
      return {
        amount: i === n - 1 ? Math.round((total - amount * (n - 1)) * 100) / 100 : amount,
        due_date: toLocalDateString(due),
      };
    });
  });

  readonly isValid = computed(() => {
    return this.num_installments() > 0
      && this.remaining_balance() > 0
      && (this.down_payment_amount() || 0) >= 0
      && (this.down_payment_amount() || 0) < this.cartTotal();
  });

  onIsOpenChange(isOpen: boolean): void {
    if (!isOpen) {
      this.close.emit();
    }
  }

  onSave(): void {
    if (!this.isValid()) return;

    this.save.emit({
      down_payment_amount: this.down_payment_amount() || 0,
      frequency: this.frequency(),
      num_installments: this.num_installments(),
      notes: this.notes() || undefined,
      internal_notes: this.internal_notes() || undefined,
      installments: this.installments_preview(),
    });
  }
}
