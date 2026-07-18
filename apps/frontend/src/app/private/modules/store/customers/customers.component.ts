import { Component, inject, signal, DestroyRef } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { CustomerListComponent, CustomerModalComponent, CustomerBulkUploadModalComponent } from './components';
import { translateCustomerError } from './utils/customer-error.translator';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { CustomersService } from './services/customers.service';
import {
  Customer,
  CustomerStats,
  CreateCustomerRequest,
  UpdateCustomerRequest,
} from './models/customer.model';
import { ToastService, DialogService, type AddressPayload } from '../../../../shared/components';
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
          title="Total clientes"
          [value]="stats()?.total_customers || 0"
          smallText="+12% vs el mes pasado"
          iconName="users"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
        ></app-stats>

        <app-stats
          title="Clientes activos"
          [value]="stats()?.active_customers || 0"
          smallText="+5% vs el mes pasado"
          iconName="user-check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Nuevos este mes"
          [value]="stats()?.new_customers_this_month || 0"
          smallText="+8% vs el mes pasado"
          iconName="user-plus"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Ingresos totales"
          [value]="formatRevenue(stats()?.total_revenue || 0)"
          smallText="+15% vs el mes pasado"
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
        (addressData)="onAddressData($event)"
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

  /**
   * Captura la dirección emitida por `<app-customer-modal>` en crear-mode
   * (`addressData` output). El modal emite `save` primero y `addressData`
   * justo después, pero el padre solo conoce el nuevo `customer_id` tras la
   * respuesta async de `createCustomer`. Guardamos el payload aquí y lo
   * persistimos vía `customersService.createCustomerAddress` en el callback
   * `next` de `onSave`. El signal se limpia tanto en éxito como en error para
   * evitar reutilizar una dirección de una sesión anterior.
   */
  private pendingAddress = signal<AddressPayload | null>(null);

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
          this.toastService.error(
            translateCustomerError(error, 'No se pudieron cargar las estadísticas'),
            'Error al cargar estadísticas',
          );
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
        error: (error) => {
          this.toastService.error(
            translateCustomerError(error, 'No se pudieron cargar los clientes'),
            'Error al cargar clientes',
          );
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

    const isCreate = !this.selectedCustomer();
    const request$ = this.selectedCustomer()
      ? this.customersService.updateCustomer(this.selectedCustomer()!.id, data)
      : this.customersService.createCustomer(data);

    request$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.actionLoading.set(false)),
      )
      .subscribe({
        next: (customer: Customer) => {
          this.toastService.success(
            this.selectedCustomer()
              ? 'Cliente actualizado correctamente'
              : 'Cliente creado correctamente',
          );
          // En crear-mode, si el modal capturó una dirección, persistirla ahora
          // que ya conocemos el `customer.id`. El modal emite `addressData`
          // solo en alta (en edición la persiste él mismo), y en editar-mode
          // `pendingAddress` siempre estará vacío. No bloqueamos el éxito del
          // cliente si la dirección falla: lanzamos un toast y seguimos.
          if (isCreate) {
            const addr = this.pendingAddress();
            this.pendingAddress.set(null);
            if (addr) {
              this.persistCustomerAddress(customer.id, addr);
            }
          }
          this.closeModal();
          this.loadCustomers();
          this.loadStats(); // Refresh stats too
        },
        error: (error) => {
          console.error('Error saving customer:', error);
          // Limpiar la dirección pendiente si la creación falló, para no
          // arrastrarla a una próxima alta.
          if (isCreate) this.pendingAddress.set(null);
          this.toastService.error(
            translateCustomerError(error),
            this.selectedCustomer()
              ? 'Error al actualizar cliente'
              : 'Error al crear cliente',
          );
        },
      });
  }

  /**
   * Handler del output `addressData` del customer-modal en crear-mode. Solo
   * captura el payload; la persistencia ocurre en `onSave` tras crear el
   * cliente (cuando ya hay `customer_id`).
   */
  onAddressData(payload: AddressPayload): void {
    this.pendingAddress.set(payload);
  }

  /**
   * Mapea `AddressPayload` (claves del schema Prisma: address_line1,
   * state_province, country_code) al DTO del backend (`address_line_1`,
   * `state`, `country` con guion bajo y nombres cortos) y persiste la
   * dirección de envío vía `POST /store/addresses`. No bloquea el flujo
   * principal del cliente: un fallo aquí solo emite un toast.
   */
  private persistCustomerAddress(customerId: number, payload: AddressPayload): void {
    const dto = {
      address_line_1: payload.address_line1 ?? '',
      address_line_2: payload.address_line2 ?? undefined,
      city: payload.city ?? '',
      state: payload.state_province ?? '',
      country: payload.country_code ?? '',
      postal_code: payload.postal_code ?? undefined,
      type: 'shipping' as const,
      is_primary: true,
      customer_id: customerId,
      latitude: payload.latitude != null ? String(payload.latitude) : undefined,
      longitude: payload.longitude != null ? String(payload.longitude) : undefined,
    };
    this.customersService
      .createCustomerAddress(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Dirección de envío guardada.');
          // Refrescar la lista para que el detalle del cliente muestre la
          // dirección recién creada si el usuario abre el cliente.
          this.loadCustomers();
        },
        error: (err: unknown) => {
          console.error('Error persisting customer address:', err);
          this.toastService.error(
            'No se pudo guardar la dirección de envío. El cliente fue creado correctamente.',
          );
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
        title: '¿Eliminar cliente?',
        message: `Esta acción no se puede deshacer. Se eliminará a ${customer.first_name} ${customer.last_name}.`,
        confirmVariant: 'danger',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
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
              error: (error) => {
                this.toastService.error(
                  translateCustomerError(error, 'No se pudo eliminar el cliente'),
                  'Error al eliminar cliente',
                );
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
