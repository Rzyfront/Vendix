import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  input,
  output,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import {
  CreatePaymentMethodDto,
  PaymentMethodType,
  ProcessingFeeType,
} from '../interfaces/payment-method.interface';
import {
  InputComponent,
  ButtonComponent,
  ModalComponent,
  SelectorComponent,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-payment-method-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    ModalComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Crear Nuevo Método de Pago"
    >
      <form [formGroup]="paymentMethodForm" (ngSubmit)="onSubmit()" class="space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            formControlName="name"
            label="Nombre (Identificador)"
            placeholder="Ej: stripe_card"
            [required]="true"
            [control]="paymentMethodForm.get('name')"
          ></app-input>

          <app-input
            formControlName="display_name"
            label="Nombre a Mostrar"
            placeholder="Ej: Tarjeta de Crédito"
            [required]="true"
            [control]="paymentMethodForm.get('display_name')"
          ></app-input>

          <app-input
            formControlName="provider"
            label="Proveedor"
            placeholder="Ej: stripe, paypal, manual"
            [required]="true"
            [control]="paymentMethodForm.get('provider')"
          ></app-input>

          <app-input
            formControlName="logo_url"
            label="URL del Logo (Opcional)"
            type="url"
            placeholder="https://example.com/logo.png"
            [control]="paymentMethodForm.get('logo_url')"
          ></app-input>

          <!-- Type Selection -->
          <app-selector
            label="Tipo de Método"
            [options]="typeOptions"
            [formControl]="$any(paymentMethodForm.get('type'))"
            placeholder="Seleccionar tipo..."
            [required]="true"
            [errorText]="paymentMethodForm.get('type')?.touched && paymentMethodForm.get('type')?.invalid ? 'Campo requerido' : ''"
          ></app-selector>

          <!-- Requires Config Checkbox -->
          <div class="flex items-center pt-8">
            <input
              type="checkbox"
              id="requires_config"
              formControlName="requires_config"
              class="h-4 w-4 text-primary focus:ring-primary border-border rounded cursor-pointer"
            />
            <label
              for="requires_config"
              class="ml-2 block text-sm text-text-primary cursor-pointer"
            >
              Requiere configuración
            </label>
          </div>

          <!-- Description (full width) -->
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-text-primary mb-2">
              Descripción
            </label>
            <textarea
              formControlName="description"
              rows="3"
              class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none transition-all"
              placeholder="Descripción del método de pago..."
            ></textarea>
          </div>

          <!-- Processing Fee Section -->
          <div class="md:col-span-2 space-y-4 pt-2 border-t border-border mt-2">
            <h4 class="text-sm font-semibold text-text-primary uppercase tracking-wider">
              Configuración de Comisiones
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-selector
                label="Tipo de Comisión"
                [options]="feeTypeOptions"
                [formControl]="$any(paymentMethodForm.get('processing_fee_type'))"
                placeholder="Sin comisión"
              ></app-selector>

              <app-input
                formControlName="processing_fee_value"
                label="Valor de Comisión"
                type="number"
                placeholder="0.00"
                step="0.01"
                min="0"
                [control]="paymentMethodForm.get('processing_fee_value')"
              ></app-input>
            </div>
          </div>

          <!-- Amount Limits Section -->
          <div class="md:col-span-2 space-y-4 pt-2 border-t border-border mt-2">
            <h4 class="text-sm font-semibold text-text-primary uppercase tracking-wider">
              Límites de Monto
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-input
                formControlName="min_amount"
                label="Monto Mínimo"
                type="number"
                placeholder="0.00"
                step="0.01"
                min="0"
                [control]="paymentMethodForm.get('min_amount')"
              ></app-input>

              <app-input
                formControlName="max_amount"
                label="Monto Máximo"
                type="number"
                placeholder="0.00"
                step="0.01"
                min="0"
                [control]="paymentMethodForm.get('max_amount')"
              ></app-input>
            </div>
          </div>

          <!-- Status Section -->
          <div class="md:col-span-2 pt-2 border-t border-border mt-2">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-sm font-semibold text-text-primary">Estado Inicial</h4>
                <p class="text-xs text-text-secondary">Define si el método estará activo al crearse</p>
              </div>
              <div class="flex items-center gap-4">
                <button
                  type="button"
                  (click)="toggleStatus(true)"
                  [class]="'px-4 py-2 rounded-lg text-sm font-medium transition-all ' + (paymentMethodForm.get('is_active')?.value ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-surface text-text-secondary border border-border')"
                >
                  Activo
                </button>
                <button
                  type="button"
                  (click)="toggleStatus(false)"
                  [class]="'px-4 py-2 rounded-lg text-sm font-medium transition-all ' + (!paymentMethodForm.get('is_active')?.value ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-surface text-text-secondary border border-border')"
                >
                  Inactivo
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="paymentMethodForm.invalid || isSubmitting()"
          [loading]="isSubmitting()"
        >
          Crear Método
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class PaymentMethodCreateModalComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);

  isOpen = input<boolean>(false);
  isSubmitting = input<boolean>(false);
  isOpenChange = output<boolean>();
  onPaymentMethodCreated = output<CreatePaymentMethodDto>();

  paymentMethodForm: FormGroup;
  private destroy$ = new Subject<void>();

  typeOptions = [
    { value: PaymentMethodType.CASH, label: 'Efectivo' },
    { value: PaymentMethodType.CARD, label: 'Tarjeta' },
    { value: PaymentMethodType.PAYPAL, label: 'PayPal' },
    { value: PaymentMethodType.BANK_TRANSFER, label: 'Transferencia Bancaria' },
    { value: PaymentMethodType.VOUCHER, label: 'Voucher' },
  ];

  feeTypeOptions = [
    { value: ProcessingFeeType.FIXED, label: 'Valor Fijo' },
    { value: ProcessingFeeType.PERCENTAGE, label: 'Porcentaje' },
    { value: ProcessingFeeType.MIXED, label: 'Mixto' },
  ];

  constructor() {
    this.paymentMethodForm = this.fb.group({
      name: ['', [Validators.required]],
      display_name: ['', [Validators.required]],
      description: [''],
      type: ['', [Validators.required]],
      provider: ['', [Validators.required]],
      logo_url: [''],
      requires_config: [false],
      processing_fee_type: [''],
      processing_fee_value: [null],
      min_amount: [null],
      max_amount: [null],
      is_active: [true],
    });

    effect(() => {
      if (this.isOpen()) {
        this.resetForm();
      }
    });
  }

  ngOnInit(): void { }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleStatus(active: boolean): void {
    this.paymentMethodForm.patchValue({ is_active: active });
  }

  onSubmit(): void {
    if (this.paymentMethodForm.invalid) {
      this.paymentMethodForm.markAllAsTouched();
      return;
    }

    const formData: CreatePaymentMethodDto = this.paymentMethodForm.value;

    // Clean data
    if (!formData.processing_fee_type) {
      delete formData.processing_fee_type;
      delete formData.processing_fee_value;
    }

    this.onPaymentMethodCreated.emit(formData);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  private resetForm(): void {
    this.paymentMethodForm.reset({
      name: '',
      display_name: '',
      description: '',
      type: '',
      provider: '',
      logo_url: '',
      requires_config: false,
      processing_fee_type: '',
      processing_fee_value: null,
      min_amount: null,
      max_amount: null,
      is_active: true,
    });
  }
}
