import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CustomersService } from '../services/customers.service';
import {
  Customer,
  CustomerQueryDto,
  CustomerStats,
  UserState,
} from '../interfaces/customer.interface';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { CustomerCreateModalComponent } from '../components/customer-create-modal';
import { CustomerDetailsModalComponent } from '../components/customer-details-modal';
import {
  TableColumn,
  TableAction,
  StatsComponent,
  ButtonComponent,
  IconComponent,
  InputsearchComponent,
  TableComponent,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-customer-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    StatsComponent,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
    TableComponent,
    CustomerCreateModalComponent,
    CustomerDetailsModalComponent,
  ],
  templateUrl: './customer-list.component.html',
  styleUrls: ['./customer-list.component.css'],
})
export class CustomerListComponent implements OnInit {
  private customersService = inject(CustomersService);
  private toastService = inject(ToastService);

  // Data
  customers: Customer[] = [];
  stats: CustomerStats = {
    total_customers: 0,
    active_customers: 0,
    new_customers_this_month: 0,
  };
  loading = false;
  searchTerm = '';

  // Query
  query: CustomerQueryDto = {
    page: 1,
    limit: 10,
  };

  // Modal states
  showCreateModal = false;
  showDetailsModal = false;
  selectedCustomerId: number | null = null;

  // Table configuration
  tableColumns: TableColumn[] = [
    {
      key: 'avatar',
      label: '',
      sortable: false,
      width: '60px',
      transform: (row: Customer) => this.getCustomerInitials(row),
    },
    {
      key: 'name',
      label: 'Cliente',
      sortable: true,
      transform: (row: Customer) => {
        const firstName = row.first_name || '';
        const lastName = row.first_name || '';
        const fullName = `${firstName} ${lastName}`.trim();
        return fullName || row.username || 'Sin nombre';
      },
    },
    {
      key: 'email',
      label: 'Email',
      sortable: true,
    },
    {
      key: 'phone',
      label: 'Teléfono',
      sortable: false,
      transform: (row: Customer) => row.phone || 'Sin teléfono',
    },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      badge: true,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: UserState) => this.getStatusLabel(value),
    },
    {
      key: 'created_at',
      label: 'Creado',
      sortable: true,
      transform: (value: string) => new Date(value).toLocaleDateString('es-ES'),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Ver detalles',
      icon: 'eye',
      action: (row: Customer) => this.onCustomerClick(row),
      variant: 'ghost',
    },
    {
      label: 'Cambiar estado',
      icon: 'toggle',
      action: (row: Customer) => this.onChangeStatus(row),
      variant: 'ghost',
    },
  ];

  ngOnInit(): void {
    this.loadCustomers();
    this.loadStats();
  }

  loadCustomers(): void {
    this.loading = true;
    this.query.search = this.searchTerm || undefined;

    this.customersService.getCustomers(this.query).subscribe({
      next: (response: any) => {
        this.customers = response.data || response;
        this.loading = false;
      },
      error: (error: any) => {
        this.loading = false;
        this.toastService.error(
          'Failed to load customers',
          error.message || 'Please try again',
        );
      },
    });
  }

  onSearch(): void {
    this.query.page = 1; // Reset to first page on search
    this.loadCustomers();
  }

  loadStats(): void {
    this.customersService.getCustomerStats().subscribe({
      next: (stats: CustomerStats) => {
        this.stats = stats;
      },
      error: (error: any) => {
        console.error('Error loading stats:', error);
        // Don't show toast for stats errors to avoid spam
      },
    });
  }

  refreshCustomers(): void {
    this.loadCustomers();
    this.loadStats();
  }

  onTableSort(event: any): void {
    // Handle table sorting if needed
    console.log('Table sort:', event);
  }

  formatNumber(value: number): string {
    return value?.toLocaleString('es-ES') || '0';
  }

  getGrowthPercentage(growth: number): string {
    if (!growth) return '0%';
    const sign = growth > 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}%`;
  }

  onCustomerClick(customer: Customer): void {
    this.selectedCustomerId = customer.id;
    this.showDetailsModal = true;
  }

  onCreateCustomer(): void {
    this.showCreateModal = true;
  }

  onChangeStatus(customer: Customer): void {
    // Toggle between active and inactive for demo
    const newStatus =
      customer.state === UserState.ACTIVE
        ? UserState.INACTIVE
        : UserState.ACTIVE;

    this.customersService
      .changeCustomerStatus(customer.id, newStatus)
      .subscribe({
        next: () => {
          this.toastService.success('Estado actualizado exitosamente');
          this.loadCustomers(); // Refresh list
        },
        error: (error: any) => {
          const message =
            error.error?.message || error.message || 'Error al cambiar estado';
          this.toastService.error('Error al cambiar estado', message);
        },
      });
  }

  onCustomerCreated(): void {
    this.showCreateModal = false;
    this.loadCustomers(); // Refresh list
  }

  onCustomerUpdated(): void {
    this.showDetailsModal = false;
    this.loadCustomers(); // Refresh list
  }

  closeCreateModal(): void {
    this.showCreateModal = false;
  }

  closeDetailsModal(): void {
    this.showDetailsModal = false;
    this.selectedCustomerId = null;
  }

  // Helper methods for template
  getStatusLabel(status: UserState): string {
    const statusMap = {
      [UserState.ACTIVE]: 'Activo',
      [UserState.INACTIVE]: 'Inactivo',
      [UserState.PENDING_VERIFICATION]: 'Pendiente',
      [UserState.SUSPENDED]: 'Suspendido',
      [UserState.ARCHIVED]: 'Archivado',
    };
    return statusMap[status] || status;
  }

  getStatusColor(status: UserState): string {
    const colorMap = {
      [UserState.ACTIVE]: 'bg-green-100 text-green-800',
      [UserState.INACTIVE]: 'bg-gray-100 text-gray-800',
      [UserState.PENDING_VERIFICATION]: 'bg-yellow-100 text-yellow-800',
      [UserState.SUSPENDED]: 'bg-red-100 text-red-800',
      [UserState.ARCHIVED]: 'bg-gray-100 text-gray-800',
    };
    return colorMap[status] || 'bg-gray-100 text-gray-800';
  }

  getCustomerInitials(customer: Customer): string {
    const firstName = customer.first_name || '';
    const lastName = customer.last_name || '';
    const username = customer.username || '';

    if (firstName && lastName) {
      return (firstName[0] + lastName[0]).toUpperCase();
    }

    if (firstName) {
      return firstName[0].toUpperCase();
    }

    if (username) {
      return username[0].toUpperCase();
    }

    return '?';
  }

  // Empty state methods
  getEmptyStateTitle(): string {
    return this.searchTerm
      ? 'No se encontraron clientes'
      : 'No hay clientes registrados';
  }

  getEmptyStateDescription(): string {
    return this.searchTerm
      ? `No se encontraron clientes que coincidan con "${this.searchTerm}".`
      : 'Comienza registrando tu primer cliente para gestionar tu base de datos.';
  }

  // Modal handlers
  onCreateModalChange(event: any): void {
    this.showCreateModal = typeof event === 'boolean' ? event : false;
  }

  onCreateModalCancel(): void {
    this.showCreateModal = false;
  }

  onCustomerCreatedFromModal(customerData: any): void {
    // Handle customer creation from modal
    this.customersService.createCustomer(customerData).subscribe({
      next: () => {
        this.toastService.success('Cliente creado exitosamente');
        this.showCreateModal = false;
        this.refreshCustomers();
      },
      error: (error: any) => {
        const message =
          error.error?.message || error.message || 'Error al crear cliente';
        this.toastService.error('Error al crear cliente', message);
      },
    });
  }

  onDetailsModalChange(event: any): void {
    this.showDetailsModal = typeof event === 'boolean' ? event : false;
    if (!this.showDetailsModal) {
      this.selectedCustomerId = null;
    }
  }
}
