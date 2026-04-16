import { Component, inject, signal, DestroyRef } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { CustomerListComponent, CustomerModalComponent, CustomerBulkUploadModalComponent } from './components';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { CustomersService } from './services/customers.service';
import {
  Customer,
  CustomerStats,
  CreateCustomerRequest,
  UpdateCustomerRequest,
} from './models/customer.model';
import { ToastService, DialogService } from '../../../../shared/components';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';

@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [
    StatsComponent,
    CustomerListComponent,
    CustomerModalComponent,
    CustomerBulkUploadModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Grid -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total de Clientes"
          [value]="stats()?.total_customers || 0"
          smallText="+12% vs last month"
          iconName="users"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
        ></app-stats>

        <app-stats
          title="Clientes Activos"
          [value]="stats()?.active_customers || 0"
          smallText="+5% vs last month"
          iconName="user-check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Nuevos Este Mes"
          [value]="stats()?.new_customers_this_month || 0"
          smallText="+8% vs last month"
          iconName="user-plus"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Ingresos Totales"
          [value]="formatRevenue(stats()?.total_revenue || 0)"
          smallText="+15% vs last month"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- List -->
      <app-customer-list
        [customers]="customers()"
        [loading]="loading()"
        [totalItems]="totalItems()"
        [page]="page()"
        [limit]="limit()"
        (search)="onSearch($event)"
        (pageChange)="onPageChange($event)"
        (create)="openCreateModal()"
        (edit)="openEditModal($event)"
        (delete)="onDelete($event)"
        (viewDetail)="onViewDetail($event)"
        (bulkUpload)="openBulkUploadModal()"
      ></app-customer-list>

      <!-- Modal -->
      <app-customer-modal
        [isOpen]="isModalOpen()"
        [customer]="selectedCustomer()"
        [loading]="actionLoading()"
        (closed)="closeModal()"
        (save)="onSave($event)"
      ></app-customer-modal>

      <!-- Bulk Upload Modal -->
      <app-customer-bulk-upload-modal
        [isOpen]="isBulkUploadModalOpen()"
        (isOpenChange)="isBulkUploadModalOpen.set($event)"
        (uploadComplete)="onBulkUploadComplete()"
      ></app-customer-bulk-upload-modal>
    </div>
  `,
})
export class CustomersComponent {
  private destroyRef = inject(DestroyRef);
  private currencyService = inject(CurrencyFormatService);
  private customersService = inject(CustomersService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private authFacade = inject(AuthFacade);
  private router = inject(Router);

  stats = signal<CustomerStats | null>(null);
  customers = signal<Customer[]>([]);

  loading = signal(false);
  actionLoading = signal(false);
  private storeId = signal<string | null>(null);

  // Pagination
  page = signal(1);
  limit = signal(10);
  totalItems = signal(0);
  private searchQuery = signal('');

  // Modal
  isModalOpen = signal(false);
  selectedCustomer = signal<Customer | null>(null);

  // Bulk Upload Modal
  isBulkUploadModalOpen = signal(false);

  constructor() {
    // Asegurar que la moneda esté cargada
    this.currencyService.loadCurrency();

    // Subscribe to userStore$ observable to get the store ID
    this.authFacade.userStore$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((store: any) => {
        const storeId = store?.id;
        if (storeId && !this.storeId()) {
          this.storeId.set(String(storeId));
          this.loadStats();
        }
      });

    this.loadCustomers();
  }

  loadStats() {
    if (!this.storeId()) return;

    this.customersService
      .getStats(parseInt(this.storeId()!, 10))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats: CustomerStats) => this.stats.set(stats),
        error: (error: any) => {
          console.error('Error loading stats:', error);
          this.toastService.error('Error al cargar estadísticas');
        },
      });
  }

  loadCustomers() {
    this.loading.set(true);
    this.customersService
      .getCustomers(this.page(), this.limit(), { search: this.searchQuery() })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (response) => {
          this.customers.set(response.data);
          this.totalItems.set(response.meta.total);
        },
        error: () => {
          this.toastService.error('Error al cargar clientes');
        },
      });
  }

  onSearch(query: string) {
    this.searchQuery.set(query);
    this.page.set(1);
    this.loadCustomers();
  }

  onPageChange(page: number) {
    this.page.set(page);
    this.loadCustomers();
  }

  openCreateModal() {
    this.openModal();
  }

  openEditModal(customer: Customer) {
    this.openModal(customer);
  }

  openModal(customer?: Customer) {
    this.selectedCustomer.set(customer || null);
    this.isModalOpen.set(true);
  }

  closeModal() {
    this.isModalOpen.set(false);
    this.selectedCustomer.set(null);
  }

  onSave(data: CreateCustomerRequest) {
    this.actionLoading.set(true);

    const request$ = this.selectedCustomer()
      ? this.customersService.updateCustomer(this.selectedCustomer()!.id, data)
      : this.customersService.createCustomer(data);

    request$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.actionLoading.set(false)),
      )
      .subscribe({
        next: () => {
          this.toastService.success(
            `Cliente ${this.selectedCustomer() ? 'actualizado' : 'creado'} exitosamente`,
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

  formatRevenue(value: number): string {
    return this.currencyService.format(value || 0);
  }

  onViewDetail(customer: Customer) {
    this.router.navigate(['/admin/customers', customer.id]);
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
            .pipe(takeUntilDestroyed(this.destroyRef))
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

  openBulkUploadModal() {
    this.isBulkUploadModalOpen.set(true);
  }

  onBulkUploadComplete() {
    this.loadCustomers();
    this.loadStats();
  }
}
