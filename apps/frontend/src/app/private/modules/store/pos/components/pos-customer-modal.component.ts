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
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { CommonModule } from '@angular/common';

import {
  ButtonComponent,
  ModalComponent,
  InputComponent,
  SelectorComponent,
  IconComponent,
  InputsearchComponent,
  DialogService,
} from '../../../../../shared/components';
import { PosCustomerService } from '../services/pos-customer.service';
import {
  PosCustomer,
  CreatePosCustomerRequest,
  PaginatedCustomersResponse,
} from '../models/customer.model';
import { StoreContextService } from '../../../../../core/services/store-context.service';

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
    InputsearchComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'lg'"
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
            name="user"
            [size]="20"
            color="var(--color-primary)"
          ></app-icon>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">
            {{
              customer
                ? 'Editar Cliente'
                : currentStep === 'search'
                  ? 'Buscar Cliente'
                  : 'Crear Cliente Rápido'
            }}
          </h2>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {{
              customer
                ? 'Edita la información del cliente seleccionado'
                : currentStep === 'search'
                  ? 'Busca un cliente existente o crea uno nuevo'
                  : 'Agrega un nuevo cliente para la venta actual'
            }}
          </p>
        </div>
      </div>

      <!-- Modal Content -->
      <div class="p-6">
        <!-- Search Step -->
        <div *ngIf="currentStep === 'search'" class="space-y-4">
          <app-inputsearch
            placeholder="Buscar por nombre, email o documento..."
            (search)="onSearch($event)"
            [debounceTime]="300"
          ></app-inputsearch>

          <!-- Search Results -->
          <div *ngIf="searchResults.length > 0" class="space-y-2">
            <h3 class="text-sm font-medium text-[var(--color-text-secondary)]">
              Resultados de búsqueda:
            </h3>
            <div class="max-h-48 overflow-y-auto space-y-2">
              <div
                *ngFor="let customer of searchResults"
                (click)="selectCustomer(customer)"
                class="p-3 border border-[var(--color-border)] rounded-lg cursor-pointer hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)] transition-colors"
              >
                <div class="flex items-center justify-between">
                  <div>
                    <p class="font-medium text-[var(--color-text-primary)]">
                      {{ customer.first_name }} {{ customer.last_name }}
                    </p>
                    <p class="text-sm text-[var(--color-text-secondary)]">
                      {{ customer.email }}
                    </p>
                    <p
                      *ngIf="customer.document_number"
                      class="text-xs text-[var(--color-text-muted)]"
                    >
                      Doc: {{ customer.document_number }}
                    </p>
                  </div>
                  <app-icon
                    name="chevron-right"
                    [size]="16"
                    color="var(--color-text-secondary)"
                  ></app-icon>
                </div>
              </div>
            </div>
          </div>

          <!-- No Results -->
          <div
            *ngIf="searchPerformed && searchResults.length === 0"
            class="text-center py-8"
          >
            <app-icon
              name="user-x"
              [size]="48"
              color="var(--color-text-muted)"
              class="mx-auto mb-4"
            ></app-icon>
            <p class="text-[var(--color-text-secondary)] mb-4">
              No se encontraron clientes con esos criterios
            </p>
            <app-button
              variant="primary"
              size="sm"
              (clicked)="switchToCreateMode()"
            >
              <app-icon name="user-plus" [size]="16" slot="icon"></app-icon>
              Crear Nuevo Cliente
            </app-button>
          </div>

          <!-- Quick Create Option -->
          <div
            *ngIf="!searchPerformed"
            class="text-center py-4 border-t border-[var(--color-border)]"
          >
            <p class="text-sm text-[var(--color-text-secondary)] mb-2">
              ¿No quieres buscar?
            </p>
            <app-button
              variant="outline"
              size="sm"
              (clicked)="switchToCreateMode()"
            >
              <app-icon name="user-plus" [size]="16" slot="icon"></app-icon>
              Crear Cliente Rápido
            </app-button>
          </div>
        </div>

        <!-- Create Step -->
        <div *ngIf="currentStep === 'create'" class="space-y-4">
          <div class="flex items-center gap-2 mb-4">
            <app-button
              variant="ghost"
              size="sm"
              (clicked)="switchToSearchMode()"
            >
              <app-icon name="arrow-left" [size]="16" slot="icon"></app-icon>
              Volver a buscar
            </app-button>
          </div>

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
            <div class="grid grid-cols-2 gap-4">
              <app-input
                formControlName="firstName"
                label="Nombre *"
                placeholder="Juan"
                type="text"
                [size]="'md'"
                [error]="getFieldError('firstName')"
                (blur)="onFieldBlur('firstName')"
              >
              </app-input>

              <app-input
                formControlName="lastName"
                label="Apellido"
                placeholder="Pérez"
                type="text"
                [size]="'md'"
                [error]="getFieldError('lastName')"
                (blur)="onFieldBlur('lastName')"
              >
              </app-input>
            </div>

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
                label="Número *"
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
      </div>

      <!-- Modal Footer -->
      <div
        *ngIf="currentStep === 'create'"
        class="flex justify-between items-center p-6 border-t border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <app-button variant="secondary" size="md" (clicked)="onCancel()">
          Cancelar
        </app-button>

        <app-button
          variant="primary"
          size="md"
          (clicked)="onSave()"
          [loading]="loading"
          [disabled]="!customerForm.valid || loading"
        >
          <app-icon name="save" [size]="16" slot="icon"></app-icon>
          Crear Cliente
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PosCustomerModalComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() customer: PosCustomer | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() customerSelected = new EventEmitter<PosCustomer>();
  @Output() customerCreated = new EventEmitter<PosCustomer>();
  @Output() customerUpdated = new EventEmitter<PosCustomer>();

  customerForm: FormGroup;
  loading = false;
  currentStep: 'search' | 'create' = 'search';
  searchResults: PosCustomer[] = [];
  searchPerformed = false;

  documentTypeOptions = [
    { value: 'dni', label: 'DNI' },
    { value: 'passport', label: 'Pasaporte' },
    { value: 'cedula', label: 'Cédula' },
    { value: 'other', label: 'Otro' },
  ];

  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();

  constructor(
    private dialogService: DialogService,
    private fb: FormBuilder,
    private customerService: PosCustomerService,
    private storeContextService: StoreContextService,
  ) {
    this.customerForm = this.createCustomerForm();
  }

  ngOnInit(): void {
    this.setupFormListeners();
    this.setupSearchSubscription();

    // If customer is provided, populate form for editing
    if (this.customer) {
      this.populateFormForEdit();
      this.currentStep = 'create';
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private createCustomerForm(): FormGroup {
    return this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      phone: [''],
      documentType: [''],
      documentNumber: ['', [Validators.required]],
      address: [''],
    });
  }

  private setupFormListeners(): void {
    // Auto-validate document number when document type changes
    this.customerForm
      .get('documentType')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((documentType) => {
        const documentNumberControl = this.customerForm.get('documentNumber');
        if (documentType && documentNumberControl) {
          documentNumberControl.setValidators([
            Validators.required,
            Validators.minLength(5),
          ]);
          documentNumberControl.updateValueAndValidity();
        }
      });
  }

  private setupSearchSubscription(): void {
    this.searchSubject$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((query) => {
        if (query.trim()) {
          this.performSearch(query);
        } else {
          this.searchResults = [];
          this.searchPerformed = false;
        }
      });
  }

  onSearch(query: string): void {
    this.searchSubject$.next(query);
  }

  private performSearch(query: string): void {
    this.loading = true;
    this.customerService
      .searchCustomers({ query: query, limit: 10 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.searchResults = response.data || [];
          this.searchPerformed = true;
          this.loading = false;
        },
        error: (error) => {
          this.loading = false;
          this.searchResults = [];
          this.searchPerformed = true;
        },
      });
  }

  selectCustomer(customer: PosCustomer): void {
    this.customerSelected.emit(customer);
    this.onModalClosed();
  }

  switchToCreateMode(): void {
    this.currentStep = 'create';
  }

  private populateFormForEdit(): void {
    if (this.customer) {
      this.customerForm.patchValue({
        email: this.customer.email,
        firstName: this.customer.first_name,
        lastName: this.customer.last_name,
        phone: this.customer.phone || '',
        documentType: this.customer.document_type || '',
        documentNumber: this.customer.document_number || '',
        address: this.customer.address || '',
      });
    }
  }

  switchToSearchMode(): void {
    this.currentStep = 'search';
    this.customerForm.reset();
    this.searchResults = [];
    this.searchPerformed = false;
  }

  getFieldError(fieldName: string): string | undefined {
    const field = this.customerForm.get(fieldName);
    if (field && field.errors && field.touched) {
      if (field.errors['required']) {
        return 'Este campo es requerido';
      }
      if (field.errors['email']) {
        return 'Email inválido';
      }
      if (field.errors['minlength']) {
        return `Mínimo ${field.errors['minlength'].requiredLength} caracteres`;
      }
    }
    return undefined;
  }

  onFieldBlur(fieldName: string): void {
    const field = this.customerForm.get(fieldName);
    if (field) {
      field.markAsTouched();
    }
  }

  onCancel(): void {
    this.customerForm.reset();
    this.onModalClosed();
  }

  onSave(): void {
    if (!this.customerForm.valid) {
      this.markFormGroupTouched();
      return;
    }

    this.loading = true;

    // Get current store ID
    const currentStoreId = this.storeContextService.getStoreIdOrThrow();

    const formData = this.customerForm.value;
    const customerData: CreatePosCustomerRequest = {
      email: formData.email,
      first_name: formData.firstName,
      last_name: formData.lastName || undefined,
      phone: formData.phone || undefined,
      document_type: formData.documentType,
      document_number: formData.documentNumber,
      address: formData.address || undefined,
      store_id: currentStoreId,
    };

    if (this.customer) {
      // Update existing customer
      this.customerService
        .updateCustomer(this.customer.id, customerData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (updatedCustomer) => {
            this.loading = false;
            this.customerUpdated.emit(updatedCustomer);
            this.onModalClosed();
          },
          error: (error) => {
            this.loading = false;
          },
        });
    } else {
      // Create new customer
      this.customerService
        .createCustomer(customerData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (newCustomer) => {
            this.loading = false;
            this.customerCreated.emit(newCustomer);
            this.onModalClosed();
          },
          error: (error) => {
            this.loading = false;
          },
        });
    }
  }

  private markFormGroupTouched(): void {
    Object.keys(this.customerForm.controls).forEach((key) => {
      const control = this.customerForm.get(key);
      if (control) {
        control.markAsTouched();
      }
    });
  }

  onModalClosed(): void {
    this.customerForm.reset();
    this.currentStep = 'search';
    this.searchResults = [];
    this.searchPerformed = false;
    this.closed.emit();
  }
}
