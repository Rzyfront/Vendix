import { Component, OnInit, OnDestroy, inject } from '@angular/core';
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
  TableColumn,
  TableAction,
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  SelectorComponent,
  DialogService,
  ToastService,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
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
    ResponsiveDataViewComponent,
    InputsearchComponent,
    SelectorComponent,
    IconComponent,
    ButtonComponent,
  ],
  templateUrl: './payment-methods.component.html',

})
export class PaymentMethodsComponent implements OnInit, OnDestroy {
  private readonly paymentMethodsService = inject(SuperAdminPaymentMethodsService);
  private readonly fb = inject(FormBuilder);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);

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
  isCreatingPaymentMethod = false;
  isUpdatingPaymentMethod = false;

  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();

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

  paymentMethodTypes = [
    { value: '', label: 'Todos los tipos' },
    { value: 'cash', label: 'Efectivo' },
    { value: 'card', label: 'Tarjeta' },
    { value: 'paypal', label: 'PayPal' },
    { value: 'bank_transfer', label: 'Transferencia' },
    { value: 'voucher', label: 'Voucher' },
  ];

  activeStates = [
    { value: '', label: 'Todos los estados' },
    { value: 'true', label: 'Activo' },
    { value: 'false', label: 'Inactivo' },
  ];

  // Card configuration for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'display_name',
    badgeKey: 'type',
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
    badgeTransform: (value: string) =>
      this.paymentMethodsService.getPaymentMethodTypeLabel(value),
    detailKeys: [
      { key: 'provider', label: 'Proveedor', icon: 'credit-card' },
      { key: '_count.store_payment_methods', label: 'Tiendas', icon: 'shopping-bag' },
      { key: 'created_at', label: 'Fecha', transform: (v) => this.formatDate(v) },
    ],
    footerKey: 'is_active',
    footerTransform: (val) => (val ? 'Activo' : 'Inactivo'),
  };

  constructor() {
    this.filterForm = this.fb.group({
      search: [''],
      type: [''],
      is_active: [''],
    });
  }

  ngOnInit(): void {
    this.loadPaymentMethods();
    this.loadPaymentMethodStats();

    // Subscribe to form changes
    this.filterForm.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadPaymentMethods();
      });

    // Subscribe to service loading states
    this.paymentMethodsService.isLoading$
      .pipe(takeUntil(this.destroy$))
      .subscribe((loading) => (this.isLoading = loading));

    this.paymentMethodsService.isCreatingPaymentMethod$
      .pipe(takeUntil(this.destroy$))
      .subscribe((isCreating) => {
        this.isCreatingPaymentMethod = isCreating || false;
      });

    this.paymentMethodsService.isUpdatingPaymentMethod$
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
    this.filterForm.patchValue({ search: searchTerm });
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
      });
  }

  editPaymentMethod(paymentMethod: PaymentMethod): void {
    this.currentPaymentMethod = paymentMethod;
    this.showEditModal = true;
  }

  onPaymentMethodUpdated(paymentMethodData: UpdatePaymentMethodDto): void {
    if (!this.currentPaymentMethod) return;

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
      return 'No hay métodos que coincidan';
    }
    return 'No hay métodos de pago';
  }

  getEmptyStateDescription(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.type || filters.is_active) {
      return 'Intenta ajustar los filtros de búsqueda';
    }
    return 'Comienza creando tu primer método de pago.';
  }

  clearFilters(): void {
    this.filterForm.reset({
      search: '',
      type: '',
      is_active: '',
    });
  }
}
