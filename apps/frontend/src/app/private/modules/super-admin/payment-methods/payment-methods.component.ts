import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import {
  PaymentMethod,
  PaymentMethodQueryDto,
  PaymentMethodStats,
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
} from './interfaces/payment-method.interface';
import { SuperAdminPaymentMethodsService } from './services/payment-methods.service';
import {
  PaymentMethodStatsComponent,
  PaymentMethodCreateModalComponent,
  PaymentMethodEditModalComponent,
  PaymentMethodEmptyStateComponent,
} from './components/index';

// Import components from shared
import {
  TableComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  DialogService,
  ToastService,
} from '../../../../shared/components/index';

import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';

@Component({
  selector: 'app-payment-methods',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    PaymentMethodStatsComponent,
    PaymentMethodCreateModalComponent,
    PaymentMethodEditModalComponent,
    PaymentMethodEmptyStateComponent,
    TableComponent,
    InputsearchComponent,
    IconComponent,
    ButtonComponent,
  ],
  templateUrl: './payment-methods.component.html',

})
export class PaymentMethodsComponent implements OnInit, OnDestroy {
  paymentMethods: PaymentMethod[] = [];
  paymentMethodStats: PaymentMethodStats = {
    total_methods: 0,
    active_methods: 0,
    inactive_methods: 0,
    methods_requiring_config: 0,
    total_stores_using_methods: 0,
  };
  isLoading = false;
  currentPaymentMethod: PaymentMethod | null = null;
  showCreateModal = false;
  showEditModal = false;
  paymentMethodToDelete: PaymentMethod | null = null;
  searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();
  isCreatingPaymentMethod = false;
  isUpdatingPaymentMethod = false;

  // Form for filters
  filterForm: FormGroup;

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'display_name',
      label: 'Nombre Mostrado',
      sortable: true,
      priority: 2,
    },
    {
      key: 'type',
      label: 'Tipo',
      sortable: true,
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          cash: '#10b981', // Green
          card: '#3b82f6', // Blue
          paypal: '#f59e0b', // Amber
          bank_transfer: '#8b5cf6', // Purple
          voucher: '#ef4444', // Red
        },
      },
      transform: (value: string) =>
        this.paymentMethodsService.getPaymentMethodTypeLabel(value),
    },
    { key: 'provider', label: 'Proveedor', sortable: true, priority: 2 },
    {
      key: 'is_active',
      label: 'Estado',
      sortable: true,
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          true: '#10b981', // Green
          false: '#ef4444', // Red
        },
      },
      transform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
    },
    {
      key: '_count.store_payment_methods',
      label: 'Tiendas',
      sortable: true,
      defaultValue: '0',
      priority: 3,
    },
    {
      key: 'created_at',
      label: 'Fecha Creación',
      sortable: true,
      priority: 3,
      transform: (value: string) => this.formatDate(value),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (paymentMethod: PaymentMethod) =>
        this.editPaymentMethod(paymentMethod),
      variant: 'success',
    },
    {
      label: 'Toggle Estado',
      icon: 'toggle',
      action: (paymentMethod: PaymentMethod) =>
        this.togglePaymentMethod(paymentMethod),
      variant: 'secondary',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (paymentMethod: PaymentMethod) =>
        this.confirmDelete(paymentMethod),
      variant: 'danger',
    },
  ];

  // Filter states
  paymentMethodTypes = [
    { value: '', label: 'Todos los tipos' },
    { value: 'cash', label: 'Efectivo' },
    { value: 'card', label: 'Tarjeta' },
    { value: 'paypal', label: 'PayPal' },
    { value: 'bank_transfer', label: 'Transferencia' },
    { value: 'voucher', label: 'Voucher' },
  ];

  constructor(
    private paymentMethodsService: SuperAdminPaymentMethodsService,
    private fb: FormBuilder,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) {
    this.filterForm = this.fb.group({
      search: [''],
      type: [''],
      is_active: [''],
    });

    // Setup search debounce
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((searchTerm: string) => {
        this.filterForm.patchValue(
          { search: searchTerm },
          { emitEvent: false },
        );
        this.loadPaymentMethods();
      });
  }

  ngOnInit(): void {
    this.loadPaymentMethods();
    console.log('metodos de pago:', this.paymentMethods);
    this.loadPaymentMethodStats();

    // Subscribe to form changes
    this.filterForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadPaymentMethods();
      });

    // Subscribe to service loading states
    this.paymentMethodsService.isCreatingPaymentMethod
      .pipe(takeUntil(this.destroy$))
      .subscribe((isCreating) => {
        this.isCreatingPaymentMethod = isCreating || false;
      });

    this.paymentMethodsService.isUpdatingPaymentMethod
      .pipe(takeUntil(this.destroy$))
      .subscribe((isUpdating) => {
        this.isUpdatingPaymentMethod = isUpdating || false;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadPaymentMethods(): void {
    this.isLoading = true;
    const filters = this.filterForm.value;
    const query: PaymentMethodQueryDto = {
      search: filters.search || undefined,
      type: filters.type || undefined,
      is_active: filters.is_active ? filters.is_active === 'true' : undefined,
    };

    this.paymentMethodsService
      .getPaymentMethods(query)
      .subscribe({
        next: (response) => {
          this.paymentMethods = response || [];
          console.log('metodos de pago cargados:', this.paymentMethods);
          console.log('Pago response:', response);

        },
        error: (error) => {
          console.error('Error loading payment methods:', error);
          this.paymentMethods = [];
        },
      })
      .add(() => {
        this.isLoading = false;
      });
  }

  loadPaymentMethodStats(): void {
    this.paymentMethodsService.getPaymentMethodsStats().subscribe({
      next: (stats: PaymentMethodStats) => {
        this.paymentMethodStats = stats;
      },
      error: (error: any) => {
        console.error('Error loading payment method stats:', error);
        this.paymentMethodStats = {
          total_methods: 0,
          active_methods: 0,
          inactive_methods: 0,
          methods_requiring_config: 0,
          total_stores_using_methods: 0,
        };
      },
    });
  }

  onSearchChange(searchTerm: string): void {
    this.searchSubject.next(searchTerm);
  }

  onSortChange(event: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    // TODO: Implement sorting logic
    console.log('Sort changed:', event.column, event.direction);
    this.loadPaymentMethods();
  }

  refreshPaymentMethods(): void {
    this.loadPaymentMethods();
  }

  createPaymentMethod(): void {
    this.showCreateModal = true;
  }

  onPaymentMethodCreated(paymentMethodData: CreatePaymentMethodDto): void {
    this.isCreatingPaymentMethod = true;
    this.paymentMethodsService
      .createPaymentMethod(paymentMethodData)
      .subscribe({
        next: () => {
          this.showCreateModal = false;
          this.loadPaymentMethods();
          this.loadPaymentMethodStats();
          this.toastService.success('Método de pago creado exitosamente');
        },
        error: (error) => {
          console.error('Error creating payment method:', error);
          this.toastService.error('Error al crear el método de pago');
        },
      })
      .add(() => {
        this.isCreatingPaymentMethod = false;
      });
  }

  editPaymentMethod(paymentMethod: PaymentMethod): void {
    this.currentPaymentMethod = paymentMethod;
    this.showEditModal = true;
  }

  onPaymentMethodUpdated(paymentMethodData: UpdatePaymentMethodDto): void {
    if (!this.currentPaymentMethod) return;

    this.isUpdatingPaymentMethod = true;
    this.paymentMethodsService
      .updatePaymentMethod(this.currentPaymentMethod.id, paymentMethodData)
      .subscribe({
        next: () => {
          this.showEditModal = false;
          this.currentPaymentMethod = null;
          this.loadPaymentMethods();
          this.loadPaymentMethodStats();
          this.toastService.success('Método de pago actualizado exitosamente');
        },
        error: (error) => {
          console.error('Error updating payment method:', error);
          this.toastService.error('Error al actualizar el método de pago');
        },
      })
      .add(() => {
        this.isUpdatingPaymentMethod = false;
      });
  }

  togglePaymentMethod(paymentMethod: PaymentMethod): void {
    this.paymentMethodsService.togglePaymentMethod(paymentMethod.id).subscribe({
      next: () => {
        this.loadPaymentMethods();
        this.loadPaymentMethodStats();
        this.toastService.success(
          `Método de pago ${paymentMethod.is_active ? 'desactivado' : 'activado'} exitosamente`,
        );
      },
      error: (error) => {
        console.error('Error toggling payment method:', error);
        this.toastService.error('Error al cambiar estado del método de pago');
      },
    });
  }

  confirmDelete(paymentMethod: PaymentMethod): void {
    if (
      paymentMethod._count &&
      paymentMethod._count.store_payment_methods > 0
    ) {
      this.toastService.warning(
        'No se puede eliminar un método de pago que está siendo utilizado por tiendas.',
      );
      return;
    }

    this.dialogService
      .confirm({
        title: 'Eliminar Método de Pago',
        message: `¿Estás seguro de que deseas eliminar el método de pago "${paymentMethod.display_name}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.deletePaymentMethod(paymentMethod);
        }
      });
  }

  deletePaymentMethod(paymentMethod: PaymentMethod): void {
    this.paymentMethodsService.deletePaymentMethod(paymentMethod.id).subscribe({
      next: () => {
        this.loadPaymentMethods();
        this.loadPaymentMethodStats();
        this.toastService.success('Método de pago eliminado exitosamente');
      },
      error: (error) => {
        console.error('Error deleting payment method:', error);
        this.toastService.error('Error al eliminar el método de pago');
      },
    });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  getEmptyStateTitle(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.type || filters.is_active) {
      return 'No methods match your filters';
    }
    return 'No payment methods found';
  }

  getEmptyStateDescription(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.type || filters.is_active) {
      return 'Try adjusting your search terms or filters';
    }
    return 'Get started by creating your first payment method.';
  }
}
