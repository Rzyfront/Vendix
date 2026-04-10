import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
  OnChanges,
  OnDestroy,
} from '@angular/core';
import {
  FormsModule,
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
import { PosQueueService, QueueEntry } from '../services/pos-queue.service';
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
    FormsModule,
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
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [showCloseButton]="false"
    >
      <!-- Modal Header -->
      <div
        class="relative flex items-center gap-3 p-6 border-b border-[var(--color-border)]"
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
                  : currentStep === 'queue'
                    ? 'Cola de Clientes'
                    : 'Crear Cliente Rápido'
            }}
          </h2>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {{
              customer
                ? 'Edita la información del cliente seleccionado'
                : currentStep === 'search'
                  ? 'Busca un cliente existente o crea uno nuevo'
                  : currentStep === 'queue'
                    ? 'Selecciona un cliente de la cola de espera'
                    : 'Agrega un nuevo cliente para la venta actual'
            }}
          </p>
        </div>
        <button
          type="button"
          class="absolute top-4 right-4 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all duration-200 p-2 rounded-[var(--radius-md)] hover:bg-[var(--color-text-muted)]/20 focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          (click)="onModalClosed()"
          aria-label="Cerrar modal"
        >
          <svg
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <!-- Tab Navigation -->
      <div class="flex border-b border-[var(--color-border)]" *ngIf="!customer">
        <button
          (click)="switchToSearchMode()"
          class="flex-1 px-4 py-3 text-sm font-medium transition-colors"
          [class.text-[var(--color-primary)]]="currentStep === 'search'"
          [class.border-b-2]="currentStep === 'search'"
          [class.border-[var(--color-primary)]]="currentStep === 'search'"
          [class.text-[var(--color-text-secondary)]]="currentStep !== 'search'"
        >
          Buscar
        </button>
        <button
          (click)="switchToCreateMode()"
          class="flex-1 px-4 py-3 text-sm font-medium transition-colors"
          [class.text-[var(--color-primary)]]="currentStep === 'create'"
          [class.border-b-2]="currentStep === 'create'"
          [class.border-[var(--color-primary)]]="currentStep === 'create'"
          [class.text-[var(--color-text-secondary)]]="currentStep !== 'create'"
        >
          Crear
        </button>
        <button
          *ngIf="queueEnabled"
          (click)="switchToQueueMode()"
          class="flex-1 px-4 py-3 text-sm font-medium transition-colors relative"
          [class.text-[var(--color-primary)]]="currentStep === 'queue'"
          [class.border-b-2]="currentStep === 'queue'"
          [class.border-[var(--color-primary)]]="currentStep === 'queue'"
          [class.text-[var(--color-text-secondary)]]="currentStep !== 'queue'"
        >
          Cola
          <span *ngIf="queueEntries.length > 0" class="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-[var(--color-primary)] rounded-full">
            {{ queueEntries.length }}
          </span>
        </button>
      </div>

      <!-- Modal Content -->
      <div class="p-6">
        <!-- Search Step -->
        <div *ngIf="currentStep === 'search'" class="space-y-4">
          <!-- Document Quick Lookup -->
          <div class="mb-4 p-4 bg-[var(--color-primary-light)]/30 rounded-lg border border-[var(--color-primary)]/20">
            <label class="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
              Búsqueda rápida por documento
            </label>
            <div class="flex gap-2">
              <div class="flex-1">
                <app-input
                  [ngModel]="documentLookupQuery"
                  (ngModelChange)="documentLookupQuery = $event"
                  placeholder="Ingrese cédula o NIT..."
                  type="text"
                  [size]="'md'"
                  (keydown.enter)="onDocumentLookup()"
                ></app-input>
              </div>
              <app-button
                variant="primary"
                size="md"
                (clicked)="onDocumentLookup()"
                [loading]="lookupLoading"
                [disabled]="!documentLookupQuery || documentLookupQuery.length < 5"
              >
                <app-icon name="search" [size]="16" slot="icon"></app-icon>
                Buscar
              </app-button>
            </div>

            <!-- Lookup Result: Found -->
            <div *ngIf="lookupPerformed && lookupResult" class="mt-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
              <div class="flex items-center justify-between">
                <div>
                  <p class="font-medium text-[var(--color-text-primary)]">
                    {{ lookupResult.first_name }} {{ lookupResult.last_name }}
                  </p>
                  <p class="text-sm text-[var(--color-text-secondary)]">{{ lookupResult.email }}</p>
                  <p class="text-xs text-[var(--color-text-muted)]">
                    {{ lookupResult.document_type || 'Doc' }}: {{ lookupResult.document_number }}
                  </p>
                </div>
                <app-button variant="primary" size="sm" (clicked)="selectCustomer(lookupResult!)">
                  Seleccionar
                </app-button>
              </div>
            </div>

            <!-- Lookup Result: Not Found -->
            <div *ngIf="lookupPerformed && !lookupResult && !lookupLoading" class="mt-3 text-center">
              <p class="text-sm text-[var(--color-text-secondary)] mb-2">
                No se encontró cliente con este documento
              </p>
              <app-button variant="outline" size="sm" (clicked)="createFromLookup()">
                <app-icon name="user-plus" [size]="16" slot="icon"></app-icon>
                Crear con este documento
              </app-button>
            </div>
          </div>

          <!-- Divider -->
          <div class="relative my-4">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t border-[var(--color-border)]"></div>
            </div>
            <div class="relative flex justify-center text-sm">
              <span class="px-2 bg-[var(--color-surface)] text-[var(--color-text-muted)]">o buscar por nombre</span>
            </div>
          </div>

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
          <div *ngIf="customer" class="flex items-center gap-2 mb-4">
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
                customWrapperClass="mt-0"
              >
              </app-input>
            </div>
          </form>
        </div>

        <!-- Queue Step -->
        <div *ngIf="currentStep === 'queue'" class="space-y-4">
          <div *ngIf="queueLoading" class="flex justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"></div>
          </div>

          <div *ngIf="!queueLoading && queueEntries.length === 0" class="text-center py-8">
            <app-icon name="users" [size]="48" color="var(--color-text-muted)" class="mx-auto mb-4"></app-icon>
            <p class="text-[var(--color-text-secondary)] mb-4">No hay clientes en la cola</p>
            <div *ngIf="queueQrData" class="mt-4">
              <p class="text-sm text-[var(--color-text-muted)] mb-2">Comparte este QR para que los clientes se registren:</p>
              <img [src]="queueQrData.qr_data_url" alt="QR Cola" class="mx-auto w-40 h-40">
              <p class="text-xs text-[var(--color-text-muted)] mt-2">{{ queueQrData.url }}</p>
              <app-button variant="outline" size="sm" (clicked)="printQueueQr()" class="mt-3">
                <app-icon name="printer" [size]="14" slot="icon"></app-icon>
                Imprimir QR
              </app-button>
            </div>
          </div>

          <div *ngIf="!queueLoading && queueEntries.length > 0" class="space-y-2 max-h-64 overflow-y-auto">
            <div
              *ngFor="let entry of queueEntries; let i = index"
              class="p-3 border border-[var(--color-border)] rounded-lg transition-colors"
              [class.bg-yellow-50]="entry.status === 'selected'"
              [class.border-yellow-300]="entry.status === 'selected'"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <span class="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] text-sm font-bold">
                    {{ i + 1 }}
                  </span>
                  <div>
                    <p class="font-medium text-[var(--color-text-primary)]">
                      {{ entry.first_name }} {{ entry.last_name }}
                    </p>
                    <p class="text-xs text-[var(--color-text-muted)]">
                      {{ entry.document_type }}: {{ entry.document_number }}
                    </p>
                    <p *ngIf="entry.status === 'selected'" class="text-xs text-yellow-600 font-medium">
                      Seleccionado
                    </p>
                  </div>
                </div>
                <div class="flex gap-2">
                  <app-button
                    *ngIf="entry.status === 'waiting'"
                    variant="primary"
                    size="sm"
                    (clicked)="onSelectFromQueue(entry)"
                  >
                    Seleccionar
                  </app-button>
                  <app-button
                    *ngIf="entry.status === 'selected'"
                    variant="outline"
                    size="sm"
                    (clicked)="onReleaseFromQueue(entry)"
                  >
                    Liberar
                  </app-button>
                </div>
              </div>
            </div>
          </div>

          <!-- QR Code section when queue has entries -->
          <div *ngIf="!queueLoading && queueEntries.length > 0 && queueQrData" class="pt-4 border-t border-[var(--color-border)]">
            <details class="text-center">
              <summary class="text-sm text-[var(--color-text-muted)] cursor-pointer">Mostrar QR de registro</summary>
              <img [src]="queueQrData.qr_data_url" alt="QR Cola" class="mx-auto w-32 h-32 mt-2">
              <p class="text-xs text-[var(--color-text-muted)] mt-1">{{ queueQrData.url }}</p>
              <app-button variant="outline" size="sm" (clicked)="printQueueQr()" class="mt-2">
                <app-icon name="printer" [size]="14" slot="icon"></app-icon>
                Imprimir QR
              </app-button>
            </details>
          </div>
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
export class PosCustomerModalComponent implements OnInit, OnDestroy, OnChanges {
  @Input() isOpen = false;
  @Input() customer: PosCustomer | null = null;
  @Input() openInQueueMode = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();
  @Output() customerSelected = new EventEmitter<PosCustomer>();
  @Output() customerCreated = new EventEmitter<PosCustomer>();
  @Output() customerUpdated = new EventEmitter<PosCustomer>();

  customerForm: FormGroup;
  loading = false;
  currentStep: 'search' | 'create' | 'queue' = 'search';
  searchResults: PosCustomer[] = [];
  searchPerformed = false;

  // Queue
  @Input() queueEnabled = false;
  queueEntries: QueueEntry[] = [];
  queueLoading = false;
  queueQrData: { qr_data_url: string; url: string } | null = null;

  documentTypeOptions = [
    { value: 'CC', label: 'Cédula de Ciudadanía' },
    { value: 'NIT', label: 'NIT' },
    { value: 'CE', label: 'Cédula de Extranjería' },
    { value: 'PP', label: 'Pasaporte' },
    { value: 'TI', label: 'Tarjeta de Identidad' },
  ];

  // Document lookup
  documentLookupQuery = '';
  lookupResult: PosCustomer | null = null;
  lookupPerformed = false;
  lookupLoading = false;

  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();

  constructor(
    private dialogService: DialogService,
    private fb: FormBuilder,
    private customerService: PosCustomerService,
    private storeContextService: StoreContextService,
    private queueService: PosQueueService,
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

  ngOnChanges(): void {
    if (this.openInQueueMode && this.queueEnabled && this.isOpen) {
      this.switchToQueueMode();
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

  onDocumentLookup(): void {
    if (!this.documentLookupQuery || this.documentLookupQuery.length < 5) return;

    this.lookupLoading = true;
    this.lookupPerformed = false;
    this.lookupResult = null;

    this.customerService
      .lookupByDocument(this.documentLookupQuery.trim())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.lookupResult = result;
          this.lookupPerformed = true;
          this.lookupLoading = false;
        },
        error: () => {
          this.lookupResult = null;
          this.lookupPerformed = true;
          this.lookupLoading = false;
        },
      });
  }

  createFromLookup(): void {
    this.currentStep = 'create';
    this.customerForm.patchValue({
      documentNumber: this.documentLookupQuery,
    });
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
      });
    }
  }

  switchToSearchMode(): void {
    this.currentStep = 'search';
    this.customerForm.reset();
    this.searchResults = [];
    this.searchPerformed = false;
    this.documentLookupQuery = '';
    this.lookupResult = null;
    this.lookupPerformed = false;
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
    this.isOpenChange.emit(false);
  }

  onSave(): void {
    if (!this.customerForm.valid) {
      this.markFormGroupTouched();
      return;
    }

    this.loading = true;

    const formData = this.customerForm.value;
    const customerData: CreatePosCustomerRequest = {
      email: formData.email,
      first_name: formData.firstName,
      last_name: formData.lastName || undefined,
      phone: formData.phone || undefined,
      document_type: formData.documentType,
      document_number: formData.documentNumber,
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

  // Queue methods

  switchToQueueMode(): void {
    this.currentStep = 'queue';
    this.loadQueueData();
  }

  private loadQueueData(): void {
    this.queueLoading = true;
    this.queueService.loadQueue().pipe(takeUntil(this.destroy$)).subscribe({
      next: (entries) => {
        this.queueEntries = entries;
        this.queueLoading = false;
      },
      error: () => {
        this.queueEntries = [];
        this.queueLoading = false;
      },
    });

    if (!this.queueQrData) {
      this.queueService.getQrCode().pipe(takeUntil(this.destroy$)).subscribe({
        next: (data) => this.queueQrData = data,
        error: () => {},
      });
    }
  }

  onSelectFromQueue(entry: QueueEntry): void {
    this.queueService.selectEntry(entry.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (selected) => {
        // Map queue entry to PosCustomer format and emit
        const customer: PosCustomer = {
          id: 0,
          email: entry.email || '',
          first_name: entry.first_name,
          last_name: entry.last_name,
          name: `${entry.first_name} ${entry.last_name}`,
          phone: entry.phone,
          document_type: entry.document_type,
          document_number: entry.document_number,
          created_at: new Date(),
          updated_at: new Date(),
          queueEntryId: entry.id,
          fromQueue: true,
        };
        this.customerSelected.emit(customer);
        this.onModalClosed();
      },
      error: () => {},
    });
  }

  onReleaseFromQueue(entry: QueueEntry): void {
    this.queueService.releaseEntry(entry.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => this.loadQueueData(),
      error: () => {},
    });
  }

  printQueueQr(): void {
    if (!this.queueQrData) return;
    const win = window.open('', '_blank', 'width=400,height=500');
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>QR Cola Virtual</title>
        <style>
          body { margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: sans-serif; }
          img { width: 250px; height: 250px; }
          p { font-size: 12px; color: #555; margin-top: 8px; word-break: break-all; text-align: center; max-width: 280px; }
          h2 { font-size: 16px; margin-bottom: 12px; }
          @media print { body { min-height: auto; } }
        </style>
      </head>
      <body>
        <h2>Registro en Cola Virtual</h2>
        <img src="${this.queueQrData.qr_data_url}" alt="QR Cola">
        <p>${this.queueQrData.url}</p>
        <script>window.onload = function() { window.print(); window.close(); }<\/script>
      </body>
      </html>
    `);
    win.document.close();
  }

  // queueEnabled is now an @Input from the parent POS component

  onModalClosed(): void {
    this.customerForm.reset();
    this.currentStep = 'search';
    this.searchResults = [];
    this.searchPerformed = false;
    this.documentLookupQuery = '';
    this.lookupResult = null;
    this.lookupPerformed = false;
    this.queueEntries = [];
    this.queueQrData = null;
    this.closed.emit();
  }
}
