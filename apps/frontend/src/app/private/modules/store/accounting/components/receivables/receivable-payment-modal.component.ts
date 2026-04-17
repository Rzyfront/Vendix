import {
  Component,
  input,
  output,
  model,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';

import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { take } from 'rxjs/operators';

import { CarteraService } from '../../services/cartera.service';
import { AccountReceivable } from '../../interfaces/cartera.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'vendix-receivable-payment-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Registrar Cobro"
      size="md"
    >
      @if (receivable(); as receivableData) {
        <div class="p-4 space-y-4">
          <!-- Account Info -->
          <div class="p-3 bg-gray-50 rounded-lg space-y-1">
            <div class="flex justify-between text-sm">
              <span class="text-gray-500">Cliente</span>
              <span class="font-medium">{{
                receivableData.customer?.name || '—'
              }}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-gray-500">Documento</span>
              <span class="font-mono">{{
                receivableData.document_number || '—'
              }}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-gray-500">Saldo Pendiente</span>
              <span class="font-semibold text-primary font-mono">{{
                formatted_balance
              }}</span>
            </div>
          </div>

          <form [formGroup]="form" class="space-y-4">
            <!-- Amount -->
            <app-input
              label="Monto del Cobro"
              formControlName="amount"
              [control]="form.get('amount')"
              [required]="true"
              [currency]="true"
              placeholder="0"
            ></app-input>

            <!-- Payment Method (optional for AR) -->
            <app-selector
              label="Método de Pago"
              formControlName="payment_method"
              [options]="payment_method_options"
              placeholder="Seleccionar método"
              (valueChange)="form.get('payment_method')!.setValue('' + $event)"
            ></app-selector>

            <!-- Reference -->
            <app-input
              label="Referencia"
              formControlName="reference"
              [control]="form.get('reference')"
              placeholder="Número de transacción, recibo, etc."
            ></app-input>

            <!-- Notes -->
            <app-textarea
              label="Notas"
              formControlName="notes"
              [control]="form.get('notes')"
              placeholder="Notas adicionales del cobro..."
              [rows]="3"
            ></app-textarea>
          </form>

          <!-- Actions -->
          <div class="flex justify-end gap-3 pt-2 border-t border-border">
            <app-button variant="outline" (clicked)="onClose()">
              Cancelar
            </app-button>
            <app-button
              variant="primary"
              (clicked)="onSubmit()"
              [loading]="is_submitting()"
              [disabled]="form.invalid || is_submitting()"
            >
              Registrar Cobro
            </app-button>
          </div>
        </div>
      }
    </app-modal>
  `,
})
export class ReceivablePaymentModalComponent implements OnChanges {
  readonly isOpen = model<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly receivable = model<AccountReceivable | null>(null);
  readonly saved = output<void>();

  private fb = inject(FormBuilder);
  private carteraService = inject(CarteraService);
  private currencyService = inject(CurrencyFormatService);
  private toastService = inject(ToastService);

  readonly is_submitting = signal(false);

  payment_method_options = [
    { value: 'cash', label: 'Efectivo' },
    { value: 'bank_transfer', label: 'Transferencia Bancaria' },
    { value: 'check', label: 'Cheque' },
  ];

  form = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(1)]],
    payment_method: [''],
    reference: [''],
    notes: [''],
  });

  get formatted_balance(): string {
    const rec = this.receivable();
    return this.currencyService.format(rec?.balance || 0);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const currentRec = this.receivable();
    if (changes['isOpen'] && this.isOpen() && currentRec) {
      this.form.reset();
      this.form.patchValue({ amount: currentRec.balance });
    }
  }

  onSubmit(): void {
    const currentRec = this.receivable();
    if (this.form.invalid || !currentRec) return;

    const val = this.form.value;
    this.is_submitting.set(true);

    this.carteraService
      .registerArPayment(currentRec.id, {
        amount: Number(val.amount),
        payment_method: val.payment_method || undefined,
        reference: val.reference || undefined,
        notes: val.notes || undefined,
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.is_submitting.set(false);
          this.toastService.success('Cobro registrado exitosamente');
          this.saved.emit();
          this.onClose();
        },
        error: () => {
          this.is_submitting.set(false);
          this.toastService.error('Error al registrar el cobro');
        },
      });
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
