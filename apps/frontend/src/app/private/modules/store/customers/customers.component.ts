import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil, finalize } from 'rxjs';
import { CustomerListComponent, CustomerModalComponent } from './components';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { CustomersService } from './services/customers.service';
import {
  Customer,
  CustomerStats,
  CreateCustomerRequest,
  UpdateCustomerRequest,
} from './models/customer.model';
import { ToastService, DialogService } from '../../../../shared/components';

@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    CustomerListComponent,
    CustomerModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Grid -->
      <div
        class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6 mb-4 md:mb-6 lg:mb-8"
      >
        <app-stats
          title="Total de Clientes"
          [value]="stats?.total_customers || 0"
          smallText="+12% vs last month"
          iconName="users"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
        ></app-stats>

        <app-stats
          title="Clientes Activos"
          [value]="stats?.active_customers || 0"
          smallText="+5% vs last month"
          iconName="user-check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Nuevos Este Mes"
          [value]="stats?.new_customers_this_month || 0"
          smallText="+8% vs last month"
          iconName="user-plus"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Ingresos Totales"
          [value]="(stats?.total_revenue || 0 | currency) || '$0.00'"
          smallText="+15% vs last month"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- List -->
      <app-customer-list
        [customers]="customers"
        [loading]="loading"
        [totalItems]="totalItems"
        (search)="onSearch($event)"
        (create)="openCreateModal()"
        (edit)="openEditModal($event)"
        (delete)="onDelete($event)"
        (refresh)="loadCustomers()"
      ></app-customer-list>

      <!-- Modal -->
      <app-customer-modal
        [isOpen]="isModalOpen"
        [customer]="selectedCustomer"
        [loading]="actionLoading"
        (closed)="closeModal()"
        (save)="onSave($event)"
      ></app-customer-modal>
    </div>
  `,
})
export class CustomersComponent implements OnInit, OnDestroy {
  stats: CustomerStats | null = null;
  customers: Customer[] = [];

  loading = false;
  actionLoading = false;

  // Pagination
  page = 1;
  limit = 10;
  totalItems = 0;
  searchQuery = '';

  // Modal
  isModalOpen = false;
  selectedCustomer: Customer | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private customersService: CustomersService,
    private toastService: ToastService,
    private dialogService: DialogService,
  ) { }

  ngOnInit(): void {
    this.loadStats();
    this.loadCustomers();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadStats() {
    this.customersService
      .getStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe((stats) => (this.stats = stats));
  }

  loadCustomers() {
    this.loading = true;
    this.customersService
      .getCustomers(this.page, this.limit, { search: this.searchQuery })
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => (this.loading = false)),
      )
      .subscribe({
        next: (response) => {
          this.customers = response.data;
          this.totalItems = response.meta.total;
        },
        error: () => {
          this.toastService.error('Error al cargar clientes');
        },
      });
  }

  onSearch(query: string) {
    this.searchQuery = query;
    this.page = 1;
    this.loadCustomers();
  }

  onPageChange(page: number) {
    this.page = page;
    this.loadCustomers();
  }

  openCreateModal() {
    this.openModal();
  }

  openEditModal(customer: Customer) {
    this.openModal(customer);
  }

  openModal(customer?: Customer) {
    this.selectedCustomer = customer || null;
    this.isModalOpen = true;
  }

  closeModal() {
    this.isModalOpen = false;
    this.selectedCustomer = null;
  }

  onSave(data: CreateCustomerRequest) {
    this.actionLoading = true;

    const request$ = this.selectedCustomer
      ? this.customersService.updateCustomer(this.selectedCustomer.id, data)
      : this.customersService.createCustomer(data);

    request$
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => (this.actionLoading = false)),
      )
      .subscribe({
        next: () => {
          this.toastService.success(
            `Cliente ${this.selectedCustomer ? 'actualizado' : 'creado'} exitosamente`,
          );
          this.closeModal();
          this.loadCustomers();
          this.loadStats(); // Refresh stats too
        },
        error: (err) => {
          console.error(err);
          this.toastService.error('Operación fallida');
        },
      });
  }

  onDelete(customer: Customer) {
    this.dialogService
      .confirm({
        title: 'Eliminar Cliente',
        message: `¿Estás seguro de que quieres eliminar ${customer.first_name} ${customer.last_name}?`,
        confirmVariant: 'danger',
        confirmText: 'Eliminar',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.customersService
            .deleteCustomer(customer.id)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.toastService.success('Cliente eliminado');
                this.loadCustomers();
                this.loadStats();
              },
              error: () => {
                this.toastService.error('Error al eliminar cliente');
              },
            });
        }
      });
  }
}
