import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

import { PopCartService } from '../services/pop-cart.service';
import type { PopCartSummary, PaymentTermPreset } from '../services/pop-cart.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

// Local constants
const PAYMENT_TERM_LABELS = {
  immediate: 'Pago Inmediato',
  net_15: '15 Días',
  net_30: '30 Días',
  net_60: '60 Días',
  net_90: '90 Días',
  custom: 'Personalizado',
} as const;

/**
 * POP Summary Component
 * Displays financial summary, notes, and action buttons
 */
@Component({
  selector: 'app-pop-summary',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    TextareaComponent,
    IconComponent,
  ],
  template: `
    <div class="bg-[var(--color-surface)] border-t border-[var(--color-border)] flex flex-col">
      <!-- Financial Summary -->
      <div class="p-4 border-b border-[var(--color-border)]">
        <h3 class="text-sm font-semibold text-[var(--color-text-secondary)] mb-3">Resumen Financiero</h3>

        <!-- Summary Rows -->
        <div class="space-y-2">
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-text-secondary)]">Subtotal</span>
            <span class="text-[var(--color-text-primary)] font-medium">{{ formatCurrency(summary.subtotal) }}</span>
          </div>

          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-text-secondary)]">Costo Envío</span>
            <div class="flex items-center gap-2">
              <input
                type="number"
                class="w-24 px-2 py-1 text-right border border-[var(--color-border)] rounded focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                [(ngModel)]="shippingCost"
                (ngModelChange)="onShippingCostChange($event)"
                [min]="0"
                [step]="0.01"
              />
              <span class="text-[var(--color-text-primary)] font-medium">{{ formatCurrency(shippingCost) }}</span>
            </div>
          </div>

          <div class="flex justify-between text-sm text-[var(--color-text-secondary)]">
            <span>Impuestos</span>
            <span>{{ formatCurrency(summary.tax_amount) }}</span>
          </div>

          <div class="h-px bg-[var(--color-border)] my-2"></div>

          <div class="flex justify-between">
            <span class="text-[var(--color-text-primary)] font-semibold">Total</span>
            <span class="text-[var(--color-text-primary)] text-lg font-bold">{{ formatCurrency(summary.total + shippingCost) }}</span>
          </div>
        </div>
      </div>

      <!-- Payment Terms -->
      <div class="p-4 border-b border-[var(--color-border)]">
        <label class="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
          Términos de Pago
        </label>
        <div class="flex gap-2">
          <select
            class="flex-1 px-3 py-2 border border-[var(--color-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] bg-[var(--color-surface)]"
            [(ngModel)]="selectedPaymentPreset"
            (change)="onPaymentPresetChange($event)"
          >
            <option value="">Seleccionar...</option>
            <option *ngFor="let preset of paymentTermPresets" [value]="preset.value">
              {{ preset.label }}
            </option>
            <option value="custom">Personalizado</option>
          </select>
          <input
            *ngIf="selectedPaymentPreset === 'custom' || !selectedPaymentPreset"
            type="text"
            class="flex-1 px-3 py-2 border border-[var(--color-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] bg-[var(--color-surface)]"
            [(ngModel)]="customPaymentTerms"
            (ngModelChange)="onCustomPaymentTermsChange($event)"
            placeholder="Especificar términos..."
          />
        </div>
      </div>

      <!-- Notes -->
      <div class="p-4 border-b border-[var(--color-border)]">
        <app-textarea
          label="Notas Generales"
          [(ngModel)]="notes"
          (ngModelChange)="onNotesChange($event)"
          placeholder="Notas visibles para el proveedor..."
          [rows]="2"
        ></app-textarea>
      </div>

      <!-- Internal Notes -->
      <div class="p-4 border-b border-[var(--color-border)]">
        <app-textarea
          label="Notas Internas"
          [(ngModel)]="internalNotes"
          (ngModelChange)="onInternalNotesChange($event)"
          placeholder="Notas internas, no visibles al proveedor..."
          [rows]="2"
        ></app-textarea>
      </div>

      <!-- Action Buttons -->
      <div class="p-4 flex flex-col gap-2">
        <!-- Primary Actions -->
        <div class="grid grid-cols-2 gap-3">
          <app-button
            variant="outline"
            (clicked)="saveAsDraft.emit()"
          >
            <app-icon name="save" class="mr-2"></app-icon>
            Guardar Borrador
          </app-button>

          <app-button
            variant="primary"
            (clicked)="submitOrder.emit()"
            [disabled]="!canSubmit()"
          >
            <app-icon name="send" class="mr-2"></app-icon>
            Enviar Orden
          </app-button>
        </div>

        <!-- Secondary Actions -->
        <div class="grid grid-cols-2 gap-3">
          <app-button
            variant="ghost"
            (clicked)="printOrder.emit()"
          >
            <app-icon name="printer" class="mr-2"></app-icon>
            Imprimir
          </app-button>

          <app-button
            variant="ghost"
            (clicked)="clearCart.emit()"
            class="text-[var(--color-destructive)]"
          >
            <app-icon name="trash" class="mr-2"></app-icon>
            Limpiar
          </app-button>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./pop-summary.component.scss'],
})
export class PopSummaryComponent implements OnInit {
  private currencyService = inject(CurrencyFormatService);

  @Input() summary!: PopCartSummary;
  @Output() saveAsDraft = new EventEmitter<void>();
  @Output() submitOrder = new EventEmitter<void>();
  @Output() printOrder = new EventEmitter<void>();
  @Output() clearCart = new EventEmitter<void>();

  shippingCost: number = 0;
  selectedPaymentPreset: string = '';
  customPaymentTerms: string = '';
  notes: string = '';
  internalNotes: string = '';

  paymentTermPresets = Object.entries(PAYMENT_TERM_LABELS).map(([value, label]) => ({ value, label }));

  constructor(private popCartService: PopCartService) { }

  ngOnInit(): void {
    this.initializeFromCart();
  }

  // ============================================================
  // Event Handlers
  // ============================================================

  onShippingCostChange(value: number): void {
    this.shippingCost = value || 0;
    this.popCartService.setShippingCost(this.shippingCost);
  }

  onPaymentPresetChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedPaymentPreset = select.value;

    if (select.value && select.value !== 'custom') {
      const label = (PAYMENT_TERM_LABELS as any)[select.value];
      this.customPaymentTerms = label;
      this.popCartService.setPaymentTerms(label);
    }
  }

  onCustomPaymentTermsChange(value: string): void {
    this.customPaymentTerms = value;
    this.popCartService.setPaymentTerms(value);
  }

  onNotesChange(value: string): void {
    this.popCartService.setNotes(value);
  }

  onInternalNotesChange(value: string): void {
    this.popCartService.setInternalNotes(value);
  }

  // ============================================================
  // Helpers
  // ============================================================

  private initializeFromCart(): void {
    const state = this.popCartService.currentState;
    this.shippingCost = state.shippingCost;
    this.notes = state.notes || '';
    this.internalNotes = state.internalNotes || '';

    // Set payment terms from state or find matching preset
    if (state.paymentTerms) {
      const matchingPreset = Object.entries(PAYMENT_TERM_LABELS).find(
        ([, label]) => label === state.paymentTerms
      );
      if (matchingPreset) {
        this.selectedPaymentPreset = matchingPreset[0];
      } else {
        this.selectedPaymentPreset = 'custom';
        this.customPaymentTerms = state.paymentTerms;
      }
    }
  }

  public canSubmit(): boolean {
    const state = this.popCartService.currentState;
    return !!(
      state.supplierId &&
      state.locationId &&
      state.items.length > 0
    );
  }

  public formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }
}
