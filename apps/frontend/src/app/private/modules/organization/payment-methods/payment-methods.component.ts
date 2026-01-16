import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

// Import components from shared
import {
  TableComponent,
  TableColumn,
  TableAction,
  ButtonComponent,
  IconComponent,
  InputsearchComponent,
  ToastService,
  DialogService,
} from '../../../../shared/components/index';

// Import local services and interfaces
import { OrganizationPaymentMethodsService } from './services/organization-payment-methods.service';
import {
  PaymentMethod,
  UpdatePaymentMethodsRequest,
} from './interfaces/payment-methods.interface';

@Component({
  selector: 'app-organization-payment-methods',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    TableComponent,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
  ],
  templateUrl: './payment-methods.component.html',
  styleUrls: ['./payment-methods.component.scss'],
})
export class PaymentMethodsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Forms and data
  searchCurrentForm: FormGroup;
  searchAvailableForm: FormGroup;
  allMethods: PaymentMethod[] = [];
  currentMethods: PaymentMethod[] = [];
  availableMethods: PaymentMethod[] = [];

  // UI states
  isLoading = false;
  isSaving = false;
  searchCurrentTerm = '';
  searchAvailableTerm = '';

  // Table configurations
  currentTableColumns: TableColumn[] = [
    {
      key: 'display_name',
      label: 'Nombre',
      sortable: true,
      priority: 1,
    },
    {
      key: 'type',
      label: 'Tipo',
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          cash: '#10b981',
          card: '#3b82f6',
          paypal: '#f59e0b',
          bank_transfer: '#8b5cf6',
          voucher: '#ef4444',
        },
      },
      priority: 2,
    },
    {
      key: 'provider',
      label: 'Proveedor',
      sortable: true,
      priority: 3,
    },
    {
      key: 'is_active',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          true: '#10b981',
          false: '#ef4444',
        },
      },
      priority: 4,
    },
    {
      key: 'min_amount',
      label: 'Monto Mín.',
      sortable: true,
      transform: (value: number) => (value ? `$${value.toFixed(2)}` : 'N/A'),
      priority: 5,
    },
    {
      key: 'max_amount',
      label: 'Monto Máx.',
      sortable: true,
      transform: (value: number) => (value ? `$${value.toFixed(2)}` : 'N/A'),
      priority: 6,
    },
    {
      key: 'actions',
      label: 'Acciones',
      priority: 7,
    },
  ];

  availableTableColumns: TableColumn[] = [
    {
      key: 'display_name',
      label: 'Nombre',
      sortable: true,
      priority: 1,
    },
    {
      key: 'type',
      label: 'Tipo',
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          cash: '#10b981',
          card: '#3b82f6',
          paypal: '#f59e0b',
          bank_transfer: '#8b5cf6',
          voucher: '#ef4444',
        },
      },
      priority: 2,
    },
    {
      key: 'provider',
      label: 'Proveedor',
      sortable: true,
      priority: 3,
    },
    {
      key: 'is_active',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          true: '#10b981',
          false: '#ef4444',
        },
      },
      priority: 4,
    },
    {
      key: 'min_amount',
      label: 'Monto Mín.',
      sortable: true,
      transform: (value: number) => (value ? `$${value.toFixed(2)}` : 'N/A'),
      priority: 5,
    },
    {
      key: 'max_amount',
      label: 'Monto Máx.',
      sortable: true,
      transform: (value: number) => (value ? `$${value.toFixed(2)}` : 'N/A'),
      priority: 6,
    },
    {
      key: 'actions',
      label: 'Acciones',
      priority: 7,
    },
  ];

  currentTableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (method: PaymentMethod) => this.editMethod(method),
      variant: 'success',
    },
    {
      label: 'Quitar',
      icon: 'x-circle',
      action: (method: PaymentMethod) => this.removeMethod(method),
      variant: 'danger',
    },
  ];

  availableTableActions: TableAction[] = [
    {
      label: 'Agregar',
      icon: 'plus-circle',
      action: (method: PaymentMethod) => this.addMethod(method),
      variant: 'success',
    },
  ];

  constructor(
    private fb: FormBuilder,
    private paymentMethodsService: OrganizationPaymentMethodsService,
    private toastService: ToastService,
    private dialogService: DialogService,
  ) {
    this.searchCurrentForm = this.fb.group({
      searchCurrent: [''],
    });

    this.searchAvailableForm = this.fb.group({
      searchAvailable: [''],
    });
  }

  ngOnInit(): void {
    this.loadPaymentMethods();
    this.setupSearchListeners();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupSearchListeners(): void {
    this.searchCurrentForm.controls['searchCurrent']?.valueChanges
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe((value) => {
        this.searchCurrentTerm = value;
        this.filterCurrentMethods();
      });

    this.searchAvailableForm.controls['searchAvailable']?.valueChanges
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe((value) => {
        this.searchAvailableTerm = value;
        this.filterAvailableMethods();
      });
  }

  private loadPaymentMethods(): void {
    this.isLoading = true;
    this.paymentMethodsService.getAvailableMethods().subscribe({
      next: (methods) => {
        this.allMethods = methods;
        this.currentMethods = methods.filter((method) => method.is_allowed);
        this.availableMethods = methods.filter((method) => !method.is_allowed);
        this.filterCurrentMethods();
        this.filterAvailableMethods();
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading payment methods:', error);
        this.toastService.error('Error al cargar los métodos de pago');
        this.isLoading = false;
      },
    });
  }

  private filterCurrentMethods(): void {
    if (!this.searchCurrentTerm) {
      this.currentMethods = this.allMethods.filter(
        (method) => method.is_allowed,
      );
      return;
    }

    const term = this.searchCurrentTerm.toLowerCase();
    this.currentMethods = this.allMethods.filter(
      (method) =>
        method.is_allowed &&
        (method.display_name.toLowerCase().includes(term) ||
          method.name.toLowerCase().includes(term) ||
          method.provider.toLowerCase().includes(term) ||
          method.type.toLowerCase().includes(term)),
    );
  }

  private filterAvailableMethods(): void {
    if (!this.searchAvailableTerm) {
      this.availableMethods = this.allMethods.filter(
        (method) => !method.is_allowed,
      );
      return;
    }

    const term = this.searchAvailableTerm.toLowerCase();
    this.availableMethods = this.allMethods.filter(
      (method) =>
        !method.is_allowed &&
        (method.display_name.toLowerCase().includes(term) ||
          method.name.toLowerCase().includes(term) ||
          method.provider.toLowerCase().includes(term) ||
          method.type.toLowerCase().includes(term)),
    );
  }

  addMethod(method: PaymentMethod): void {
    this.dialogService
      .confirm({
        title: 'Agregar Método de Pago',
        message: `¿Estás seguro de agregar "${method.display_name}" a tus tiendas?`,
        confirmText: 'Agregar',
        cancelText: 'Cancelar',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.performAddMethod(method);
        }
      });
  }

  removeMethod(method: PaymentMethod): void {
    this.dialogService
      .confirm({
        title: 'Quitar Método de Pago',
        message: `¿Estás seguro de quitar "${method.display_name}" de tus tiendas?`,
        confirmText: 'Quitar',
        cancelText: 'Cancelar',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.performRemoveMethod(method);
        }
      });
  }

  editMethod(method: PaymentMethod): void {
    this.toastService.info(
      `Editando "${method.display_name}" - Función por implementar`,
    );
  }

  private performAddMethod(method: PaymentMethod): void {
    method.is_allowed = true;
    this.availableMethods = this.availableMethods.filter(
      (m) => m.id !== method.id,
    );
    this.currentMethods = [...this.currentMethods, method];
    this.toastService.success(`"${method.display_name}" agregado exitosamente`);
  }

  private performRemoveMethod(method: PaymentMethod): void {
    method.is_allowed = false;
    this.currentMethods = this.currentMethods.filter((m) => m.id !== method.id);
    this.availableMethods = [...this.availableMethods, method];
    this.toastService.success(`"${method.display_name}" quitado exitosamente`);
  }

  onSaveChanges(): void {
    if (this.currentMethods.length === 0) {
      this.toastService.warning(
        'Debes tener al menos un método de pago activo',
      );
      return;
    }

    this.dialogService
      .confirm({
        title: 'Guardar Cambios',
        message: `¿Estás seguro de guardar los cambios? Tus tiendas tendrán ${this.currentMethods.length} método(s) de pago disponibles.`,
        confirmText: 'Guardar',
        cancelText: 'Cancelar',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.performSave();
        }
      });
  }

  private performSave(): void {
    this.isSaving = true;

    const request: UpdatePaymentMethodsRequest = {
      allowed_methods: this.currentMethods.map((method) => method.name),
    };

    this.paymentMethodsService.updatePaymentMethods(request).subscribe({
      next: () => {
        this.toastService.success('Métodos de pago actualizados correctamente');
        this.loadPaymentMethods(); // Reload to get updated data
        this.isSaving = false;
      },
      error: (error) => {
        console.error('Error saving payment methods:', error);
        this.toastService.error('Error al guardar los métodos de pago');
        this.isSaving = false;
      },
    });
  }

  onResetChanges(): void {
    this.dialogService
      .confirm({
        title: 'Restablecer Cambios',
        message: '¿Estás seguro de restablecer todos los cambios no guardados?',
        confirmText: 'Restablecer',
        cancelText: 'Cancelar',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.loadPaymentMethods();
          this.toastService.info('Cambios restablecidos');
        }
      });
  }

  getStats(): { current: number; available: number; total: number } {
    const originalCurrentMethods = this.allMethods.filter(
      (method) => method.is_allowed,
    );
    const originalAvailableMethods = this.allMethods.filter(
      (method) => !method.is_allowed,
    );

    return {
      current: originalCurrentMethods.length,
      available: originalAvailableMethods.length,
      total: this.allMethods.length,
    };
  }

  getPaymentMethodTypeColor(type: string): string {
    const colorMap: Record<string, string> = {
      cash: '#10b981',
      card: '#3b82f6',
      paypal: '#f59e0b',
      bank_transfer: '#8b5cf6',
      voucher: '#ef4444',
    };
    return colorMap[type] || '#6b7280';
  }

  getPaymentMethodTypeLabel(type: string): string {
    const labelMap: Record<string, string> = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      paypal: 'PayPal',
      bank_transfer: 'Transferencia',
      voucher: 'Voucher',
    };
    return labelMap[type] || type;
  }

  // Computed properties for form controls
  get searchCurrentControl() {
    const control = this.searchCurrentForm.get('searchCurrent');
    return control as any;
  }

  get searchAvailableControl() {
    const control = this.searchAvailableForm.get('searchAvailable');
    return control as any;
  }
}
