import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
  OnDestroy,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';

import {
  ButtonComponent,
  ModalComponent,
  InputComponent,
  SelectorComponent,
  ToastService,
  IconComponent,
} from '../../../../../shared/components';
import { PosCustomerService } from '../services/pos-customer.service';
import {
  PosCustomer,
  CreatePosCustomerRequest,
} from '../models/customer.model';

@Component({
  selector: 'app-pos-customer-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    SelectorComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'md'"
      (closed)="onModalClosed()"
      [showCloseButton]="true"
    >
      <!-- Modal Header -->
      <div
        class="flex items-center gap-3 p-6 border-b border-[var(--color-border)]"
      >
        <div
          class="w-10 h-10 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center"
        >
          <app-icon
            name="user-plus"
            [size]="20"
            color="var(--color-primary)"
          ></app-icon>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">
            {{ isEditMode ? 'Editar Cliente' : 'Crear Cliente Rápido' }}
          </h2>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {{
              isEditMode
                ? 'Actualiza los datos del cliente'
                : 'Agrega un nuevo cliente para la venta actual'
            }}
          </p>
        </div>
      </div>

      <!-- Modal Content -->
      <div class="p-6">
        <form [formGroup]="customerForm" class="space-y-4">
          <!-- Email -->
          <app-input
            formControlName="email"
            label="Email *"
            placeholder="cliente@ejemplo.com"
            type="email"
            [size]="'md'"
            [error]="getFieldError('email')"
            (blur)="onFieldBlur('email')"
          >
          </app-input>

          <!-- Name -->
          <app-input
            formControlName="name"
            label="Nombre Completo *"
            placeholder="Juan Pérez"
            type="text"
            [size]="'md'"
            [error]="getFieldError('name')"
            (blur)="onFieldBlur('name')"
          >
          </app-input>

          <!-- Phone -->
          <app-input
            formControlName="phone"
            label="Teléfono"
            placeholder="+54 9 11 1234-5678"
            type="tel"
            [size]="'md'"
            [error]="getFieldError('phone')"
            (blur)="onFieldBlur('phone')"
          >
          </app-input>

          <!-- Document Type and Number -->
          <div class="grid grid-cols-2 gap-4">
            <app-selector
              formControlName="documentType"
              label="Tipo Doc."
              [options]="documentTypeOptions"
              [size]="'md'"
              [placeholder]="'Seleccionar'"
            >
            </app-selector>

            <app-input
              formControlName="documentNumber"
              label="Número"
              placeholder="12345678"
              type="text"
              [size]="'md'"
              [error]="getFieldError('documentNumber')"
              (blur)="onFieldBlur('documentNumber')"
            >
            </app-input>
          </div>

          <!-- Address -->
          <app-input
            formControlName="address"
            label="Dirección"
            placeholder="Calle 123, Ciudad"
            type="text"
            [size]="'md'"
            (blur)="onFieldBlur('address')"
          >
          </app-input>
        </form>
      </div>

      <!-- Modal Footer -->
      <div
        class="flex justify-between items-center p-6 border-t border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <app-button variant="secondary" size="md" (clicked)="onCancel()">
          Cancelar
        </app-button>

        <div class="flex gap-3">
          <app-button
            *ngIf="!isEditMode"
            variant="outline"
            size="md"
            (clicked)="onCreateAndContinue()"
            [loading]="loading"
            [disabled]="!customerForm.valid || loading"
          >
            Crear y Continuar
          </app-button>

          <app-button
            variant="primary"
            size="md"
            (clicked)="onSave()"
            [loading]="loading"
            [disabled]="!customerForm.valid || loading"
          >
            <app-icon name="save" [size]="16" slot="icon"></app-icon>
            {{ isEditMode ? 'Actualizar' : 'Crear Cliente' }}
          </app-button>
        </div>
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
export class PosCustomerModalComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() customer: PosCustomer | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() customerCreated = new EventEmitter<PosCustomer>();
  @Output() customerUpdated = new EventEmitter<PosCustomer>();

  customerForm: FormGroup;
  loading = false;
  isEditMode = false;

  documentTypeOptions = [
    { value: 'dni', label: 'DNI' },
    { value: 'passport', label: 'Pasaporte' },
    { value: 'cedula', label: 'Cédula' },
    { value: 'other', label: 'Otro' },
  ];

  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private customerService: PosCustomerService,
    private toastService: ToastService,
  ) {
    this.customerForm = this.createCustomerForm();
  }

  ngOnInit(): void {
    this.setupFormListeners();

    if (this.customer) {
      this.isEditMode = true;
      this.populateForm(this.customer);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private createCustomerForm(): FormGroup {
    return this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      name: ['', [Validators.required, Validators.minLength(2)]],
      phone: [''],
      documentType: [''],
      documentNumber: [''],
      address: [''],
    });
  }

  private setupFormListeners(): void {
    // Auto-validate document number when document type changes
    this.customerForm
      .get('documentType')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((value) => {
        const documentNumberControl = this.customerForm.get('documentNumber');
        if (value && documentNumberControl?.value) {
          documentNumberControl.updateValueAndValidity();
        }
      });
  }

  private populateForm(customer: PosCustomer): void {
    this.customerForm.patchValue({
      email: customer.email,
      name: customer.name,
      phone: customer.phone || '',
      documentType: customer.documentType || '',
      documentNumber: customer.documentNumber || '',
      address: customer.address || '',
    });
  }

  getFieldError(fieldName: string): string | undefined {
    const field = this.customerForm.get(fieldName);
    if (!field || !field.errors || !field.touched) {
      return undefined;
    }

    const errors = field.errors;
    if (errors['required']) {
      return 'Este campo es requerido';
    }
    if (errors['email']) {
      return 'Email inválido';
    }
    if (errors['minlength']) {
      return `Mínimo ${errors['minlength'].requiredLength} caracteres`;
    }

    return undefined;
  }

  onFieldBlur(fieldName: string): void {
    const field = this.customerForm.get(fieldName);
    if (field) {
      field.markAsTouched();
      field.updateValueAndValidity();
    }
  }

  onCancel(): void {
    this.closed.emit();
  }

  onCreateAndContinue(): void {
    this.saveCustomer(true);
  }

  onSave(): void {
    this.saveCustomer(false);
  }

  private saveCustomer(continueAfterCreate: boolean): void {
    if (!this.customerForm.valid) {
      this.markAllFieldsAsTouched();
      this.toastService.error('Por favor completa los campos requeridos');
      return;
    }

    this.loading = true;
    const formData = this.customerForm.value;

    if (this.isEditMode && this.customer) {
      this.updateCustomer(formData);
    } else {
      this.createCustomer(formData, continueAfterCreate);
    }
  }

  private createCustomer(
    data: CreatePosCustomerRequest,
    continueAfterCreate: boolean,
  ): void {
    this.customerService
      .createQuickCustomer(data)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (customer) => {
          this.loading = false;
          this.toastService.success('Cliente creado correctamente');
          this.customerCreated.emit(customer);

          if (continueAfterCreate) {
            // Reset form for next customer
            this.customerForm.reset();
            this.isEditMode = false;
          } else {
            this.closed.emit();
          }
        },
        error: (error) => {
          this.loading = false;
          this.toastService.error(error.message || 'Error al crear cliente');
        },
      });
  }

  private updateCustomer(data: Partial<CreatePosCustomerRequest>): void {
    if (!this.customer) return;

    this.customerService
      .updateCustomer(this.customer.id, data)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (customer) => {
          this.loading = false;
          this.toastService.success('Cliente actualizado correctamente');
          this.customerUpdated.emit(customer);
          this.closed.emit();
        },
        error: (error) => {
          this.loading = false;
          this.toastService.error(
            error.message || 'Error al actualizar cliente',
          );
        },
      });
  }

  private markAllFieldsAsTouched(): void {
    Object.keys(this.customerForm.controls).forEach((key) => {
      const control = this.customerForm.get(key);
      control?.markAsTouched();
    });
  }

  onModalClosed(): void {
    this.closed.emit();
  }
}
