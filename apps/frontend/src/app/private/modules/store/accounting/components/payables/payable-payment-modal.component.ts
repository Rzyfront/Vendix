import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';

import { CarteraService } from '../../services/cartera.service';
import { AccountPayable } from '../../interfaces/cartera.interface';
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
  selector: 'vendix-payable-payment-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Registrar Pago"
      size="md"
    >
      @if (payable) {
        <div class="p-4 space-y-4">
          <!-- Account Info -->
          <div class="p-3 bg-gray-50 rounded-lg space-y-1">
            <div class="flex justify-between text-sm">
              <span class="text-gray-500">Proveedor</span>
              <span class="font-medium">{{
                payable.supplier?.name || '—'
              }}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-gray-500">Documento</span>
              <span class="font-mono">{{
                payable.document_number || '—'
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
              label="Monto del Pago"
              formControlName="amount"
              [control]="form.get('amount')"
              [required]="true"
              [currency]="true"
              placeholder="0"
            ></app-input>

            <!-- Payment Method (required) -->
            <app-selector
              label="Metodo de Pago"
              formControlName="payment_method"
              [options]="payment_method_options"
              placeholder="Seleccionar metodo"
              [required]="true"
              (valueChange)="form.get('payment_method')!.setValue('' + $event)"
            ></app-selector>

            <!-- Reference -->
            <app-input
              label="Referencia"
              formControlName="reference"
              [control]="form.get('reference')"
              placeholder="Numero de transaccion, cheque, etc."
            ></app-input>

            <!-- Bank Export Reference -->
            <app-input
              label="Ref. Exportacion Bancaria"
              formControlName="bank_export_ref"
              [control]="form.get('bank_export_ref')"
              placeholder="Referencia para exportacion bancaria"
            ></app-input>

            <!-- Notes -->
            <app-textarea
              label="Notas"
              formControlName="notes"
              [control]="form.get('notes')"
              placeholder="Notas adicionales del pago..."
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
              [loading]="is_submitting"
              [disabled]="form.invalid || is_submitting"
            >
              Registrar Pago
            </app-button>
          </div>
        </div>
      }
    </app-modal>
  `,
})
export class PayablePaymentModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Input() payable: AccountPayable | null = null;
  @Output() saved = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private carteraService = inject(CarteraService);
  private currencyService = inject(CurrencyFormatService);
  private toastService = inject(ToastService);

  is_submitting = false;

  payment_method_options = [
    { value: 'cash', label: 'Efectivo' },
    { value: 'bank_transfer', label: 'Transferencia Bancaria' },
    { value: 'check', label: 'Cheque' },
  ];

  form = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(1)]],
    payment_method: ['', [Validators.required]],
    reference: [''],
    bank_export_ref: [''],
    notes: [''],
  });

  get formatted_balance(): string {
    return this.currencyService.format(this.payable?.balance || 0);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.payable) {
      this.form.reset();
      this.form.patchValue({ amount: this.payable.balance });
    }
  }

  onSubmit(): void {
    if (this.form.invalid || !this.payable) return;

    const val = this.form.value;
    this.is_submitting = true;

    this.carteraService
      .registerApPayment(this.payable.id, {
        amount: Number(val.amount),
        payment_method: val.payment_method!,
        reference: val.reference || undefined,
        bank_export_ref: val.bank_export_ref || undefined,
        notes: val.notes || undefined,
      })
      .subscribe({
        next: () => {
          this.is_submitting = false;
          this.toastService.success('Pago registrado exitosamente');
          this.saved.emit();
          this.onClose();
        },
        error: () => {
          this.is_submitting = false;
          this.toastService.error('Error al registrar el pago');
        },
      });
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
