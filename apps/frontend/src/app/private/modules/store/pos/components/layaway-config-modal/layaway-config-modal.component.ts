import { Component, input, output, signal, computed } from '@angular/core';

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
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent
],
  template: `
    <app-modal
      [isOpen]="true"
      (isOpenChange)="onIsOpenChange($event)"
      (cancel)="close.emit()"
      [dialog]="true"
      title="Configurar Plan Separé"
      subtitle="Define el abono inicial y las cuotas del plan"
      size="md"
      class="lw-aa-scope"
    >
      <!-- Header icon -->
      <div slot="header" class="lw-header-icon">
        <app-icon name="calendar" [size]="20"></app-icon>
      </div>

      <!-- Body -->
      <div class="lw-body">
        <!-- Summary Card -->
        <div class="lw-summary">
          <div class="lw-summary-customer">
            <div class="lw-summary-avatar">
              <app-icon name="user" [size]="20"></app-icon>
            </div>
            <div class="lw-summary-who">
              <p class="lw-summary-name">{{ customer()?.name || (customer()?.first_name + ' ' + customer()?.last_name) }}</p>
              <p class="lw-summary-email">{{ customer()?.email }}</p>
            </div>
          </div>
          <div class="lw-summary-total">
            <span class="lw-summary-total-label">Total del carrito</span>
            <span class="lw-summary-total-value">\${{ cartTotal().toLocaleString() }}</span>
          </div>
        </div>

        <!-- Down Payment -->
        <div>
          <label class="lw-label" for="lw-down-payment">Abono inicial</label>
          <div class="lw-money-wrap">
            <span class="lw-money-prefix" aria-hidden="true">$</span>
            <input
              id="lw-down-payment"
              type="number"
              [ngModel]="down_payment_amount()"
              (ngModelChange)="down_payment_amount.set($event)"
              min="0"
              [max]="cartTotal()"
              step="100"
              placeholder="0"
              aria-describedby="lw-down-payment-hint"
              class="lw-input lw-money-input"
            />
          </div>
          <p class="lw-hint" id="lw-down-payment-hint">Opcional. Se descuenta del total antes de generar cuotas.</p>
        </div>

        <!-- Frequency Selector -->
        <div>
          <span class="lw-label" id="lw-frequency-label">Periodicidad</span>
          <div class="lw-frequencies" role="radiogroup" aria-labelledby="lw-frequency-label">
            @for (opt of frequencyOptions; track opt.value) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="frequency() === opt.value"
                class="lw-frequency"
                [class.lw-frequency-selected]="frequency() === opt.value"
                (click)="frequency.set(opt.value)"
              >
                <app-icon [name]="opt.icon" [size]="18" class="lw-frequency-icon"></app-icon>
                <span class="lw-frequency-label">{{ opt.label }}</span>
                <span class="lw-frequency-sublabel">{{ opt.sublabel }}</span>
              </button>
            }
          </div>
        </div>

        <!-- Number of Installments -->
        <div>
          <label class="lw-label" for="lw-installments">Número de cuotas</label>
          <input
            id="lw-installments"
            type="number"
            [ngModel]="num_installments()"
            (ngModelChange)="num_installments.set($event)"
            min="1"
            max="60"
            class="lw-input"
          />
        </div>

        <!-- Remaining Balance -->
        <div class="lw-balance">
          <span class="lw-balance-label">Saldo a financiar</span>
          <span
            class="lw-balance-value"
            [class.lw-balance-zero]="remaining_balance() <= 0"
          >\${{ remaining_balance().toLocaleString() }}</span>
        </div>

        <!-- Installments Preview -->
        @if (installments_preview().length > 0) {
          <div>
            <span class="lw-label" id="lw-preview-label">Vista previa de cuotas</span>
            <div class="lw-preview" role="list" aria-labelledby="lw-preview-label">
              @for (inst of installments_preview(); track inst.due_date; let i = $index) {
                <div class="lw-preview-row" role="listitem">
                  <div class="lw-preview-when">
                    <span class="lw-preview-index">{{ i + 1 }}</span>
                    <span class="lw-preview-date">{{ inst.due_date }}</span>
                  </div>
                  <span class="lw-preview-amount">\${{ inst.amount.toLocaleString() }}</span>
                </div>
              }
            </div>
          </div>
        }

        <!-- Notes -->
        <div>
          <label class="lw-label" for="lw-notes">Notas (opcional)</label>
          <textarea
            id="lw-notes"
            [ngModel]="notes()"
            (ngModelChange)="notes.set($event)"
            rows="2"
            placeholder="Notas visibles para el cliente..."
            class="lw-input lw-textarea"
          ></textarea>
        </div>

        <div>
          <label class="lw-label" for="lw-internal-notes">Notas internas (opcional)</label>
          <textarea
            id="lw-internal-notes"
            [ngModel]="internal_notes()"
            (ngModelChange)="internal_notes.set($event)"
            rows="2"
            placeholder="Solo visible para el equipo..."
            class="lw-input lw-textarea"
          ></textarea>
        </div>
      </div>

      <!-- Footer -->
      <div slot="footer" class="lw-footer">
        <app-button variant="secondary" size="md" (clicked)="close.emit()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="md"
          (clicked)="onSave()"
          [disabled]="!isValid() || isSaving()"
          [loading]="isSaving()"
        >
          <app-icon name="calendar" [size]="16" slot="icon" ></app-icon>
          Crear Plan Separé
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    /* Stitch paso 8 — separé: mismo lenguaje de modales del paso 7 (icono en
       slot header, radiogroup con borde 2px + fondo al seleccionar, inputs
       44px con foco 3px primary, secundarios en neutral-600 sólido). Tinte
       warning a juego con el badge "Crear plan separé" del header del POS. */
    .lw-header-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: var(--color-warning-50);
      color: var(--color-warning-700);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .lw-body {
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 4px 0;
    }

    .lw-summary {
      border: 1px solid var(--color-warning-700);
      border-radius: 12px;
      background: var(--color-warning-50);
      padding: 16px;
    }

    .lw-summary-customer {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .lw-summary-avatar {
      width: 40px;
      height: 40px;
      border-radius: 999px;
      background: var(--color-surface);
      color: var(--color-warning-700);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .lw-summary-who {
      flex: 1;
      min-width: 0;
    }

    .lw-summary-name {
      font-size: 14px;
      font-weight: 700;
      color: var(--color-text-primary);
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lw-summary-email {
      font-size: 12px;
      color: var(--color-neutral-600);
      margin: 2px 0 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lw-summary-total {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--color-border);
    }

    .lw-summary-total-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--color-neutral-600);
    }

    .lw-summary-total-value {
      font-size: 18px;
      font-weight: 800;
      color: var(--color-text-primary);
    }

    .lw-label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: var(--color-text-primary);
      margin-bottom: 6px;
    }

    .lw-input {
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text-primary);
      font-size: 14px;
      transition: border-color 0.2s ease;
    }

    .lw-input::placeholder {
      color: var(--color-neutral-600);
      opacity: 0.8;
    }

    .lw-input:focus-visible {
      outline: 3px solid var(--color-primary);
      outline-offset: 2px;
      border-color: var(--color-primary);
    }

    .lw-money-wrap {
      position: relative;
    }

    .lw-money-prefix {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 14px;
      font-weight: 500;
      color: var(--color-neutral-600);
    }

    .lw-money-input {
      padding-left: 28px;
    }

    .lw-textarea {
      resize: none;
    }

    .lw-hint {
      font-size: 12px;
      color: var(--color-neutral-600);
      margin: 4px 0 0;
    }

    .lw-frequencies {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .lw-frequency {
      min-height: 44px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 12px 8px;
      border-radius: 12px;
      border: 2px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-neutral-600);
      text-align: center;
      cursor: pointer;
      transition: border-color 0.2s ease, background-color 0.2s ease;
    }

    .lw-frequency:hover {
      border-color: var(--color-warning-700);
      background: var(--color-warning-50);
    }

    .lw-frequency:focus-visible {
      outline: 3px solid var(--color-primary);
      outline-offset: 2px;
    }

    .lw-frequency-selected {
      border-color: var(--color-warning-700);
      background: var(--color-warning-50);
      color: var(--color-warning-700);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    .lw-frequency-icon {
      display: block;
      margin-bottom: 4px;
    }

    .lw-frequency-label {
      font-size: 12px;
      font-weight: 600;
    }

    .lw-frequency-sublabel {
      font-size: 11px;
      font-weight: 500;
      color: var(--color-neutral-600);
    }

    .lw-frequency-selected .lw-frequency-sublabel {
      color: inherit;
    }

    .lw-balance {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 12px;
      background: var(--color-surface-secondary);
      padding: 12px;
    }

    .lw-balance-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--color-neutral-600);
    }

    .lw-balance-value {
      font-size: 16px;
      font-weight: 800;
      color: var(--color-text-primary);
    }

    .lw-balance-zero {
      color: var(--color-error-700);
    }

    .lw-preview {
      max-height: 192px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-right: 4px;
    }

    .lw-preview-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
    }

    .lw-preview-when {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .lw-preview-index {
      width: 24px;
      height: 24px;
      border-radius: 999px;
      background: var(--color-warning-50);
      color: var(--color-warning-700);
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .lw-preview-date {
      font-size: 12px;
      color: var(--color-neutral-600);
    }

    .lw-preview-amount {
      font-size: 14px;
      font-weight: 700;
      color: var(--color-text-primary);
    }

    .lw-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    /* Stitch 11b (8) — submit "Crear Plan Separé" de app-button (compartido,
       fuera de alcance): blanco sobre primary #2ecc71 (2.1:1). Se remapea la
       var heredada a success-700 (~5.0:1). Solo afecta a este subárbol. */
    .lw-aa-scope {
      --color-primary: var(--color-success-700);
      --color-text-secondary: var(--color-neutral-600);
      --color-text-muted: var(--color-neutral-500);
    }
  `],
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
