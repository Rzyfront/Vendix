import {
  Component,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { PurchaseOrdersService } from '../../../services';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-po-payment-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalClose($event)"
      title="Registrar Pago"
      size="md"
    >
      <div class="space-y-4">
        <!-- Amount -->
        <div>
          <label for="payment-amount" class="text-sm font-medium text-text-primary block mb-1.5">Monto</label>
          <input
            id="payment-amount"
            type="number"
            class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            [(ngModel)]="amount"
            [min]="0"
            step="0.01"
            placeholder="0.00"
          >
          <p class="text-xs text-text-muted mt-1">
            Total orden: {{ formatCurrency(totalAmount()) }} · Pagado: {{ formatCurrency(paidAmount()) }}
          </p>
        </div>

        <!-- Date -->
        <div>
          <label for="payment-date" class="text-sm font-medium text-text-primary block mb-1.5">Fecha de pago</label>
          <input
            id="payment-date"
            type="date"
            class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            [(ngModel)]="paymentDate"
          >
        </div>

        <!-- Payment Method -->
        <div>
          <label for="payment-method" class="text-sm font-medium text-text-primary block mb-1.5">Metodo de pago</label>
          <select
            id="payment-method"
            class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            [(ngModel)]="paymentMethod"
          >
            <option value="cash">Efectivo</option>
            <option value="bank_transfer">Transferencia bancaria</option>
            <option value="check">Cheque</option>
            <option value="credit_card">Tarjeta de credito</option>
          </select>
        </div>

        <!-- Reference -->
        <div>
          <label for="payment-ref" class="text-sm font-medium text-text-primary block mb-1.5">Referencia</label>
          <input
            id="payment-ref"
            type="text"
            class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            [(ngModel)]="reference"
            placeholder="No. de transferencia, cheque, etc."
          >
        </div>

        <!-- Notes -->
        <div>
          <label for="payment-notes" class="text-sm font-medium text-text-primary block mb-1.5">Notas</label>
          <textarea
            id="payment-notes"
            class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            rows="2"
            [(ngModel)]="notes"
            placeholder="Notas opcionales..."
          ></textarea>
        </div>
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex gap-2 justify-end">
        <app-button variant="outline" (clicked)="onModalClose(false)">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="submit()"
          [disabled]="saving() || !isValid()"
          [loading]="saving()"
        >
          Registrar Pago
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    :host { display: block; }
    input::-webkit-outer-spin-button,
    input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    input[type=number] {
      -moz-appearance: textfield;
    }
  `],
})
export class PoPaymentModalComponent {
  private purchaseOrdersService = inject(PurchaseOrdersService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);

  readonly isOpen = input<boolean>(false);
  readonly orderId = input<number | null>(null);
  readonly totalAmount = input<number>(0);
  readonly paidAmount = input<number>(0);

  readonly close = output<void>();
  readonly paymentRegistered = output<void>();

  readonly saving = signal(false);

  readonly remaining = computed(() => {
    return Math.max(0, Number(this.totalAmount()) - Number(this.paidAmount()));
  });

  amount = 0;
  paymentDate = new Date().toISOString().split('T')[0];
  paymentMethod = 'bank_transfer';
  reference = '';
  notes = '';

  constructor() {
    // Initialize form when modal opens
    effect(() => {
      if (this.isOpen()) {
        this.resetForm();
      }
    });
  }

  private resetForm(): void {
    this.amount = this.remaining() || Number(this.totalAmount()) || 0;
    this.paymentDate = new Date().toISOString().split('T')[0];
    this.paymentMethod = 'bank_transfer';
    this.reference = '';
    this.notes = '';
  }

  onModalClose(value: boolean): void {
    if (!value) {
      this.close.emit();
    }
  }

  isValid(): boolean {
    return this.amount > 0 && !!this.paymentDate;
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  submit(): void {
    if (!this.isValid()) return;

    const id = this.orderId();
    if (!id) return;

    this.saving.set(true);

    const payload: Record<string, unknown> = {
      amount: this.amount,
      payment_date: this.paymentDate,
      payment_method: this.paymentMethod,
    };
    if (this.reference.trim()) payload['reference'] = this.reference.trim();
    if (this.notes.trim()) payload['notes'] = this.notes.trim();

    this.purchaseOrdersService.registerPurchaseOrderPayment(id, payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.toastService.success('Pago registrado correctamente');
        this.paymentRegistered.emit();
        this.close.emit();
      },
      error: (err: string) => {
        this.saving.set(false);
        this.toastService.error(err || 'Error al registrar pago');
      },
    });
  }
}
