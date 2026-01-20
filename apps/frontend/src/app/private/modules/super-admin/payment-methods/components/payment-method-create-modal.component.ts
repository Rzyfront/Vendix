import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
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
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Crear Nuevo Método de Pago"
      (closed)="onModalClose()"
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

          <!-- Status Selection Section -->
          <div class="md:col-span-2">
            <div class="bg-gray-50 rounded-lg p-4">
              <h3 class="text-sm font-medium text-gray-700 mb-2">
                Estado del Método de Pago
              </h3>
              <div class="flex items-center gap-2 mb-3">
                <span
                  class="px-3 py-1 rounded-full text-sm font-medium"
                  [class.bg-green-100]="selectedStatus === 'active'"
                  [class.text-green-800]="selectedStatus === 'active'"
                  [class.bg-red-100]="selectedStatus === 'inactive'"
                  [class.text-red-800]="selectedStatus === 'inactive'"
                  [class.bg-gray-100]="selectedStatus === 'archived'"
                  [class.text-gray-800]="selectedStatus === 'archived'"
                >
                  {{ getStatusLabel(selectedStatus) }}
                </span>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  (click)="selectStatus('active')"
                  [disabled]="isSubmitting"
                  [class.bg-blue-600]="selectedStatus === 'active'"
                  [class.text-white]="selectedStatus === 'active'"
                  [class.border-blue-600]="selectedStatus === 'active'"
                  [class.bg-white]="selectedStatus !== 'active'"
                  [class.text-gray-700]="selectedStatus !== 'active'"
                  [class.border-gray-300]="selectedStatus !== 'active'"
                  class="px-3 py-2 text-sm border rounded-lg font-medium hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Active
                </button>
                <button
                  type="button"
                  (click)="selectStatus('inactive')"
                  [disabled]="isSubmitting"
                  [class.bg-blue-600]="selectedStatus === 'inactive'"
                  [class.text-white]="selectedStatus === 'inactive'"
                  [class.border-blue-600]="selectedStatus === 'inactive'"
                  [class.bg-white]="selectedStatus !== 'inactive'"
                  [class.text-gray-700]="selectedStatus !== 'inactive'"
                  [class.border-gray-300]="selectedStatus !== 'inactive'"
                  class="px-3 py-2 text-sm border rounded-lg font-medium hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Inactive
                </button>
                <button
                  type="button"
                  (click)="selectStatus('archived')"
                  [disabled]="isSubmitting"
                  [class.bg-blue-600]="selectedStatus === 'archived'"
                  [class.text-white]="selectedStatus === 'archived'"
                  [class.border-blue-600]="selectedStatus === 'archived'"
                  [class.bg-white]="selectedStatus !== 'archived'"
                  [class.text-gray-700]="selectedStatus !== 'archived'"
                  [class.border-gray-300]="selectedStatus !== 'archived'"
                  class="px-3 py-2 text-sm border rounded-lg font-medium hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Archived
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
export class PaymentMethodCreateModalComponent implements OnInit, OnDestroy {
  @Input() isOpen: boolean = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onPaymentMethodCreated = new EventEmitter<CreatePaymentMethodDto>();

  PaymentMethodType = PaymentMethodType;
  ProcessingFeeType = ProcessingFeeType;

  paymentMethodForm: FormGroup;
  isSubmitting: boolean = false;
  selectedStatus: 'active' | 'inactive' | 'archived' = 'active';

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
      processing_fee_type: [''],
      processing_fee_value: [null],
      min_amount: [null],
      max_amount: [null],
      is_active: [true],
    });
  }

  ngOnInit(): void { }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onModalOpen(): void {
    // Reset form and submission state when modal opens
    this.isSubmitting = false;
    this.resetForm();
  }

  onModalClose(): void {
    // Reset form and submission state when modal closes
    this.isSubmitting = false;
    this.resetForm();
  }

  selectStatus(status: 'active' | 'inactive' | 'archived'): void {
    this.selectedStatus = status;
    this.paymentMethodForm.patchValue({
      is_active: status === 'active',
    });
  }

  getStatusLabel(status: 'active' | 'inactive' | 'archived' | string): string {
    const labels: Record<string, string> = {
      active: 'Active',
      inactive: 'Inactive',
      archived: 'Archived',
    };
    return labels[status] || status;
  }

  onSubmit(): void {
    if (this.paymentMethodForm.invalid || this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;
    const formData: CreatePaymentMethodDto = this.paymentMethodForm.value;

    // Remove empty fee fields if no fee type is selected
    if (!formData.processing_fee_type) {
      delete formData.processing_fee_type;
      delete formData.processing_fee_value;
    }

    this.onPaymentMethodCreated.emit(formData);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetForm();
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
    this.selectedStatus = 'active';
    this.isSubmitting = false;
  }
}
