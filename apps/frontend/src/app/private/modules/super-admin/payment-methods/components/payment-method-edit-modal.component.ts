import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  OnChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  PaymentMethod,
  UpdatePaymentMethodDto,
  PaymentMethodType,
  ProcessingFeeType,
} from '../interfaces/payment-method.interface';
import {
  InputComponent,
  ButtonComponent,
  ModalComponent,
} from '../../../../../shared/components/index';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-payment-method-edit-modal',
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
      title="Editar Método de Pago"
      [subtitle]="paymentMethod ? 'Modificando ' + paymentMethod.display_name : ''"
    >
      <form [formGroup]="paymentMethodForm" (ngSubmit)="onSubmit()">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- ID (Readonly) -->
          <div class="space-y-2">
            <label class="block text-sm font-medium text-[var(--color-text-primary)]">
              ID
            </label>
            <input
              type="text"
              [value]="paymentMethod?.id"
              readonly
              class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]/50 text-[var(--color-text-secondary)] cursor-not-allowed"
            />
          </div>

          <!-- Name (Readonly) -->
          <div class="space-y-2">
            <label class="block text-sm font-medium text-[var(--color-text-primary)]">
              Nombre (Identificador)
            </label>
            <input
              type="text"
              [value]="paymentMethod?.name"
              readonly
              class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]/50 text-[var(--color-text-secondary)] cursor-not-allowed"
            />
            <p class="text-xs text-[var(--color-text-secondary)]">
              El nombre de identificador no se puede modificar
            </p>
          </div>

          <!-- Display Name -->
          <app-input
            formControlName="display_name"
            label="Nombre a Mostrar"
            placeholder="Ej: Tarjeta de Crédito"
            [required]="true"
            [control]="paymentMethodForm.get('display_name')"
            [disabled]="isSubmitting"
          ></app-input>

          <!-- Logo URL -->
          <app-input
            formControlName="logo_url"
            label="URL del Logo (Opcional)"
            type="url"
            placeholder="https://example.com/logo.png"
            [control]="paymentMethodForm.get('logo_url')"
            [disabled]="isSubmitting"
          ></app-input>

          <!-- Requires Config Checkbox -->
          <div class="flex items-center md:col-span-2">
            <input
              type="checkbox"
              id="requires_config_edit"
              formControlName="requires_config"
              class="h-4 w-4 text-[var(--color-primary)] focus:ring-[var(--color-primary)] border-[var(--color-border)] rounded"
              [disabled]="isSubmitting"
            />
            <label
              for="requires_config_edit"
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
          Actualizar Método
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
export class PaymentMethodEditModalComponent implements OnInit, OnDestroy, OnChanges {
  @Input() paymentMethod: PaymentMethod | null = null;
  @Input() isOpen: boolean = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onPaymentMethodUpdated = new EventEmitter<UpdatePaymentMethodDto>();

  ProcessingFeeType = ProcessingFeeType;

  paymentMethodForm: FormGroup;
  isSubmitting: boolean = false;

  private destroy$ = new Subject<void>();

  constructor(private fb: FormBuilder) {
    this.paymentMethodForm = this.fb.group({
      display_name: ['', [Validators.required]],
      description: [''],
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

  ngOnChanges(): void {
    if (this.paymentMethod) {
      this.paymentMethodForm.patchValue({
        display_name: this.paymentMethod.display_name,
        description: this.paymentMethod.description || '',
        logo_url: this.paymentMethod.logo_url || '',
        requires_config: this.paymentMethod.requires_config,
        processing_fee_type: this.paymentMethod.processing_fee_type || '',
        processing_fee_value: this.paymentMethod.processing_fee_value,
        min_amount: this.paymentMethod.min_amount,
        max_amount: this.paymentMethod.max_amount,
        is_active: this.paymentMethod.is_active,
      });
    }
  }

  onSubmit(): void {
    if (this.paymentMethodForm.invalid || this.isSubmitting || !this.paymentMethod) {
      return;
    }

    this.isSubmitting = true;
    const formData: UpdatePaymentMethodDto = this.paymentMethodForm.value;

    // Remove empty fee fields if no fee type is selected
    if (!formData.processing_fee_type) {
      delete formData.processing_fee_type;
      delete formData.processing_fee_value;
    }

    this.onPaymentMethodUpdated.emit(formData);
  }

  onCancel(): void {
    this.isOpen = false;
    this.resetForm();
  }

  private resetForm(): void {
    this.paymentMethodForm.reset({
      display_name: '',
      description: '',
      logo_url: '',
      requires_config: false,
      processing_fee_type: '',
      processing_fee_value: null,
      min_amount: null,
      max_amount: null,
      is_active: true,
    });
    this.isSubmitting = false;
  }
}
