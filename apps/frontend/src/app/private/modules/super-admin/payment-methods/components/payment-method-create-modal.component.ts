import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  inject,
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
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [size]="'lg'"
      title="Crear Nuevo Método de Pago"
    >
      <form [formGroup]="paymentMethodForm" (ngSubmit)="onSubmit()">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            formControlName="name"
            label="Nombre (Identificador)"
            placeholder="Ej: stripe_card"
            [required]="true"
            [control]="paymentMethodForm.get('name')"
            [disabled]="isSubmitting"
          ></app-input>

          <app-input
            formControlName="display_name"
            label="Nombre a Mostrar"
            placeholder="Ej: Tarjeta de Crédito"
            [required]="true"
            [control]="paymentMethodForm.get('display_name')"
            [disabled]="isSubmitting"
          ></app-input>

          <app-input
            formControlName="provider"
            label="Proveedor"
            placeholder="Ej: stripe, paypal, manual"
            [required]="true"
            [control]="paymentMethodForm.get('provider')"
            [disabled]="isSubmitting"
          ></app-input>

          <app-input
            formControlName="logo_url"
            label="URL del Logo (Opcional)"
            type="url"
            placeholder="https://example.com/logo.png"
            [control]="paymentMethodForm.get('logo_url')"
            [disabled]="isSubmitting"
          ></app-input>

          <!-- Type Select -->
          <div class="space-y-2">
            <label class="block text-sm font-medium text-[var(--color-text-primary)]">
              Tipo de Método
            </label>
            <select
              formControlName="type"
              class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
              [disabled]="isSubmitting"
            >
              <option value="">Seleccionar tipo...</option>
              <option [value]="PaymentMethodType.CASH">Efectivo</option>
              <option [value]="PaymentMethodType.CARD">Tarjeta</option>
              <option [value]="PaymentMethodType.PAYPAL">PayPal</option>
              <option [value]="PaymentMethodType.BANK_TRANSFER">Transferencia Bancaria</option>
              <option [value]="PaymentMethodType.VOUCHER">Voucher</option>
            </select>
            <div
              *ngIf="paymentMethodForm.get('type')?.invalid && paymentMethodForm.get('type')?.touched"
              class="text-red-600 text-xs mt-1"
            >
              Campo requerido
            </div>
          </div>

          <!-- Requires Config Checkbox -->
          <div class="flex items-center">
            <input
              type="checkbox"
              id="requires_config"
              formControlName="requires_config"
              class="h-4 w-4 text-[var(--color-primary)] focus:ring-[var(--color-primary)] border-[var(--color-border)] rounded"
              [disabled]="isSubmitting"
            />
            <label
              for="requires_config"
              class="ml-2 block text-sm text-[var(--color-text-primary)]"
            >
              Requiere configuración
            </label>
          </div>

          <!-- Estado del Método de Pago -->
          <div class="md:col-span-2 bg-gray-50 rounded-lg p-4">
            <h3 class="text-sm font-medium text-gray-700 mb-2">Estado del Método de Pago</h3>
            <div class="flex items-center gap-2 mb-3">
              <span class="px-3 py-1 rounded-full text-sm font-medium" [class]="paymentMethodForm.get('is_active')?.value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'">
                {{ paymentMethodForm.get('is_active')?.value ? 'Activo' : 'Inactivo' }}
              </span>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" (click)="setActive(true)" class="px-3 py-2 text-sm border rounded-lg font-medium hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" [class]="paymentMethodForm.get('is_active')?.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'" [disabled]="isSubmitting">
                Activo
              </button>
              <button type="button" (click)="setActive(false)" class="px-3 py-2 text-sm border rounded-lg font-medium hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" [class]="!paymentMethodForm.get('is_active')?.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'" [disabled]="isSubmitting">
                Inactivo
              </button>
            </div>
          </div>

          <!-- Description (full width) -->
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
              Descripción
            </label>
            <textarea
              formControlName="description"
              rows="3"
              class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)] resize-none"
              placeholder="Descripción del método de pago..."
              [disabled]="isSubmitting"
            ></textarea>
          </div>

          <!-- Processing Fee Section -->
          <div class="md:col-span-2 space-y-4">
            <h4 class="text-sm font-medium text-[var(--color-text-primary)]">
              Configuración de Comisiones
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Processing Fee Type -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                  Tipo de Comisión
                </label>
                <select
                  formControlName="processing_fee_type"
                  class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
                  [disabled]="isSubmitting"
                >
                  <option value="">Sin comisión</option>
                  <option [value]="ProcessingFeeType.FIXED">Fijo</option>
                  <option [value]="ProcessingFeeType.PERCENTAGE">Porcentaje</option>
                  <option [value]="ProcessingFeeType.MIXED">Mixto</option>
                </select>
              </div>

              <!-- Processing Fee Value -->
              <app-input
                formControlName="processing_fee_value"
                label="Valor de Comisión"
                type="number"
                placeholder="0.00"
                step="0.01"
                min="0"
                [control]="paymentMethodForm.get('processing_fee_value')"
                [disabled]="isSubmitting"
              ></app-input>
            </div>
          </div>

          <!-- Amount Limits Section -->
          <div class="md:col-span-2 space-y-4">
            <h4 class="text-sm font-medium text-[var(--color-text-primary)]">
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
                [disabled]="isSubmitting"
              ></app-input>

              <app-input
                formControlName="max_amount"
                label="Monto Máximo"
                type="number"
                placeholder="0.00"
                step="0.01"
                min="0"
                [control]="paymentMethodForm.get('max_amount')"
                [disabled]="isSubmitting"
              ></app-input>
            </div>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isSubmitting"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="paymentMethodForm.invalid || isSubmitting"
          [loading]="isSubmitting"
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
export class PaymentMethodCreateModalComponent implements OnInit, OnDestroy, OnChanges {
  @Input() isOpen: boolean = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onPaymentMethodCreated = new EventEmitter<CreatePaymentMethodDto>();

  PaymentMethodType = PaymentMethodType;
  ProcessingFeeType = ProcessingFeeType;

  paymentMethodForm: FormGroup;
  isSubmitting: boolean = false;

  private destroy$ = new Subject<void>();

  constructor(private fb: FormBuilder) {
    this.paymentMethodForm = this.fb.group({
      name: ['', [Validators.required]],
      display_name: ['', [Validators.required]],
      description: [''],
      type: ['', [Validators.required]],
      provider: ['', [Validators.required]],
      logo_url: [''],
      requires_config: [false],
      is_active: [true],
      processing_fee_type: [''],
      processing_fee_value: [null],
      min_amount: [null],
      max_amount: [null],
    });
  }

  ngOnInit(): void { }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && changes['isOpen'].currentValue === true) {
      this.resetForm();
    }
  }

  onSubmit(): void {
    if (this.paymentMethodForm.invalid || this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;
    const formData: any = { ...this.paymentMethodForm.value };

    // Remove empty fee fields if no fee type is selected
    if (!formData.processing_fee_type) {
      delete formData.processing_fee_type;
      delete formData.processing_fee_value;
    }

    // Remove empty optional fields
    Object.keys(formData).forEach(key => {
      if (formData[key] === '' || formData[key] === null || formData[key] === undefined) {
        delete formData[key];
      }
    });

    this.onPaymentMethodCreated.emit(formData as CreatePaymentMethodDto);
  }

  onCancel(): void {
    this.isOpen = false;
    this.resetForm();
  }

  setActive(value: boolean): void {
    this.paymentMethodForm.patchValue({ is_active: value });
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
      is_active: true,
      processing_fee_type: '',
      processing_fee_value: null,
      min_amount: null,
      max_amount: null,
    });
    this.isSubmitting = false;
  }
}
