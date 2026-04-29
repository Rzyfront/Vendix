import {Component,
  OnInit,
  signal,
  model,
  computed,
  inject,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import {
  Domain,
  DomainStats,
  DomainQueryDto,
  DomainStatus,
  DomainOwnership,
  CreateDomainDto,
  UpdateDomainDto,
  VerifyDomainResult} from './interfaces/domain.interface';
import { OrganizationDomainsService } from './services/organization-domains.service';
import { OrganizationStoresService } from '../stores/services/organization-stores.service';
import { environment } from '../../../../../environments/environment';

import {
  DomainCreateModalComponent,
  DomainEditModalComponent,
  DomainDeleteConfirmationComponent,
  DomainVerifyModalComponent} from './components/index';

import {
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  ToastService,
  TableColumn,
  TableAction,
  StatsComponent,
  SelectorOption,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  EmptyStateComponent} from '../../../../shared/components/index';

interface StatItem {
  title: string;
  value: string | number;
  smallText: string;
  iconName: string;
  iconBgColor: string;
  iconColor: string;
}

interface StoreOption {
  id: number;
  name: string;
  slug: string;
}

@Component({
  selector: 'app-domains',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    StatsComponent,
    EmptyStateComponent,
    DomainCreateModalComponent,
    DomainEditModalComponent,
    DomainDeleteConfirmationComponent,
    DomainVerifyModalComponent,
    InputsearchComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
  ],
  template: `
    <div class="space-y-6">
      <!-- Stats Cards -->
      <div class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6">
        @for (item of statsItems(); track item) {
          <app-stats
            [title]="item.title"
            [value]="item.value"
            [smallText]="item.smallText"
            [iconName]="item.iconName"
            [iconBgColor]="item.iconBgColor"
            [iconColor]="item.iconColor"
          >
          </app-stats>
        }
      </div>

      <!-- Domains List -->
      <div class="bg-surface rounded-card shadow-card border border-border">
        <div class="px-6 py-4 border-b border-border">
          <div
            class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
          >
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                Todos los dominios ({{ domains().length }})
              </h2>
            </div>

            <div
              class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto"
            >
              <!-- Search Input -->
              <app-inputsearch
                class="w-full sm:w-64"
                size="sm"
                placeholder="Buscar dominios..."
                [debounceTime]="1000"
                (searchChange)="onSearchChange($event)"
              ></app-inputsearch>

              <!-- Status Filter -->
              <select
                class="px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary text-sm"
                (change)="onStatusChange($event)"
                [value]="selectedStatus()"
              >
                <option value="">Todos los Estados</option>
                <option value="active">Activo</option>
                <option value="pending_dns">Pendiente DNS</option>
                <option value="pending_ssl">Pendiente SSL</option>
                <option value="disabled">Deshabilitado</option>
              </select>

              <!-- Ownership Filter -->
              <select
                class="px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary text-sm"
                (change)="onOwnershipChange($event)"
                [value]="selectedOwnership()"
              >
                <option value="">Todos los Tipos</option>
                <option value="vendix_subdomain">Subdominio Vendix</option>
                <option value="custom_domain">Dominio Personalizado</option>
                <option value="custom_subdomain">
                  Subdominio Personalizado
                </option>
              </select>

              <!-- Store Filter -->
              <select
                class="px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary text-sm"
                (change)="onStoreChange($event)"
                [value]="selectedStoreId()"
              >
                <option value="">Todas las Tiendas</option>
                @for (store of stores(); track store) {
                  <option [value]="store.id">
                    {{ store.name }}
                  </option>
                }
              </select>

              <div class="flex gap-2 items-center">
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="refreshDomains()"
                  [disabled]="isLoading()"
                  title="Actualizar"
                >
                  <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
                </app-button>
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="openCreateModal()"
                  title="Nuevo Dominio"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  <span class="hidden sm:inline">Nuevo Dominio</span>
                </app-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        @if (isLoading()) {
          <div class="p-8 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando dominios...</p>
          </div>
        }

        <!-- Empty State -->
        @if (!isLoading() && domains().length === 0) {
          <app-empty-state
            icon="globe"
            [title]="getEmptyStateTitle()"
            [description]="getEmptyStateDescription()"
            actionButtonText="Crear Dominio"
            [showRefreshButton]="hasFilters()"
            [showClearFilters]="hasFilters()"
            (actionClick)="openCreateModal()"
            (refreshClick)="refreshDomains()"
            (clearFiltersClick)="clearFilters()"
          >
          </app-empty-state>
        }

        <!-- Domains Table -->
        @if (!isLoading() && domains().length > 0) {
          <div class="p-6">
            <app-responsive-data-view
              [data]="domains()"
              [columns]="tableColumns"
              [cardConfig]="cardConfig"
              [actions]="tableActions"
              [loading]="isLoading()"
              emptyMessage="No hay dominios registrados"
              emptyIcon="globe"
              (sort)="onTableSort($event)"
            >
            </app-responsive-data-view>
          </div>
        }
      </div>

      <!-- Create Domain Modal -->
      <app-domain-create-modal
        [(isOpen)]="isCreateModalOpen"
        [isSubmitting]="isCreatingDomain()"
        [stores]="stores()"
        (submit)="createDomain($event)"
        (cancel)="onCreateModalCancel()"
      ></app-domain-create-modal>

      <!-- Edit Domain Modal -->
      <app-domain-edit-modal
        [(isOpen)]="isEditModalOpen"
        [isSubmitting]="isUpdatingDomain()"
        [domain]="selectedDomain()"
        (submit)="updateDomain($event)"
        (cancel)="onEditModalCancel()"
      ></app-domain-edit-modal>

      <!-- Verify Domain Modal -->
      <app-domain-verify-modal
        [(isOpen)]="isVerifyModalOpen"
        [isVerifying]="isVerifyingDomain()"
        [domain]="selectedDomainForVerify()"
        [verificationResult]="verificationResult()"
        [edgeHost]="edgeHost()"
        (verify)="verifyDomain($event)"
        (cancel)="onVerifyModalCancel()"
      ></app-domain-verify-modal>

      <!-- Delete Domain Confirmation Modal -->
      <app-domain-delete-confirmation
        [(isOpen)]="isDeleteModalOpen"
        [domain]="selectedDomainForDelete()"
        (confirm)="confirmDeleteDomain($event)"
        (cancel)="onDeleteModalCancel()"
      ></app-domain-delete-confirmation>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ]})
export class DomainsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private domainsService = inject(OrganizationDomainsService);
  private storesService = inject(OrganizationStoresService);
  private toastService = inject(ToastService);

  readonly domains = signal<Domain[]>([]);
  readonly stores = signal<StoreOption[]>([]);
  readonly isLoading = signal(false);
  readonly searchTerm = signal('');
  readonly selectedStatus = signal('');
  readonly selectedOwnership = signal('');
  readonly selectedStoreId = signal('');

  // Table configuration
  tableColumns: TableColumn[] = [
    {
      key: 'hostname',
      label: 'Hostname',
      sortable: true,
      width: '250px',
      priority: 1},
    {
      key: 'store.name',
      label: 'Tienda',
      sortable: true,
      width: '150px',
      priority: 2,
      defaultValue: 'Organización'},
    {
      key: 'app_type',
      label: 'Tipo App',
      sortable: true,
      width: '120px',
      align: 'center',
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          STORE_ECOMMERCE: '#3b82f6',
          STORE_ADMIN: '#8b5cf6',
          STORE_LANDING: '#22c55e',
          ORG_ADMIN: '#f59e0b',
          ORG_LANDING: '#06b6d4'}},
      transform: (value: string) => this.formatAppType(value)},
    {
      key: 'ownership',
      label: 'Tipo',
      sortable: true,
      width: '140px',
      align: 'center',
      badge: true,
      priority: 3,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          vendix_subdomain: '#22c55e',
          custom_domain: '#3b82f6',
          custom_subdomain: '#8b5cf6',
          third_party_subdomain: '#f59e0b'}},
      transform: (value: string) => this.formatOwnership(value)},
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      width: '120px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          active: '#22c55e',
          pending_dns: '#f59e0b',
          pending_ssl: '#f97316',
          disabled: '#ef4444'}},
      transform: (value: string) => this.formatStatus(value)},
    {
      key: 'ssl_status',
      label: 'SSL',
      sortable: true,
      width: '100px',
      align: 'center',
      badge: true,
      priority: 3,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          issued: '#22c55e',
          pending: '#f59e0b',
          none: '#9ca3af',
          error: '#ef4444',
          revoked: '#dc2626'}},
      transform: (value: string) => this.formatSslStatus(value)},
    {
      key: 'is_primary',
      label: 'Primario',
      sortable: true,
      width: '90px',
      align: 'center',
      badge: true,
      priority: 3,
      badgeConfig: {
        type: 'status',
        size: 'sm'},
      transform: (value: boolean) => (value ? 'active' : 'inactive')},
    {
      key: 'created_at',
      label: 'Creado',
      sortable: true,
      width: '120px',
      priority: 4,
      transform: (value: string) =>
        new Date(value).toLocaleDateString('es-ES', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'})},
  ];

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (domain: Domain) => this.editDomain(domain),
      variant: 'info'},
    {
      label: 'Verificar DNS',
      icon: 'shield-check',
      action: (domain: Domain) => this.openVerifyModal(domain),
      variant: 'secondary',
      show: (domain: Domain) => this.canVerifyDomain(domain)},
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (domain: Domain) => this.deleteDomain(domain),
      variant: 'danger',
      show: (domain: Domain) => !domain.is_primary},
  ];

  // Card Config for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'hostname',
    subtitleKey: 'store.name',
    subtitleTransform: (val: any) => val || 'Organización',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        active: '#22c55e',
        pending_dns: '#f59e0b',
        pending_ssl: '#f97316',
        disabled: '#ef4444'}},
    badgeTransform: (val: string) => this.formatStatus(val),
    detailKeys: [
      {
        key: 'app_type',
        label: 'Tipo App',
        transform: (val: string) => this.formatAppType(val)},
      {
        key: 'ownership',
        label: 'Propiedad',
        transform: (val: string) => this.formatOwnership(val)},
    ]};

  readonly statsItems = signal<StatItem[]>([]);

  // Modal state
  readonly isCreateModalOpen = model<boolean>(false);
  readonly isCreatingDomain = signal(false);

  readonly isEditModalOpen = model<boolean>(false);
  readonly isUpdatingDomain = signal(false);
  readonly selectedDomain = signal<Domain | null>(null);

  readonly isVerifyModalOpen = model<boolean>(false);
  readonly isVerifyingDomain = signal(false);
  readonly selectedDomainForVerify = signal<Domain | null>(null);
  readonly verificationResult = signal<VerifyDomainResult | null>(null);
  // Edge host (CloudFront target) for the DNS CNAME value, fetched from
  // backend `getDnsInstructions().target`. Falls back to the platform domain
  // from environment so the modal never renders with an empty value.
  readonly dnsInstructionsTarget = signal<string | null>(null);
  readonly edgeHost = computed(
    () => this.dnsInstructionsTarget() ?? environment.vendixDomain,
  );

  readonly isDeleteModalOpen = model<boolean>(false);
  readonly selectedDomainForDelete = signal<Domain | null>(null);

  readonly hasFilters = computed(
    () =>
      !!(
        this.searchTerm() ||
        this.selectedStatus() ||
        this.selectedOwnership() ||
        this.selectedStoreId()
      ),
  );
ngOnInit(): void {
    this.loadInitialData();
  }
private loadInitialData(): void {
    this.isLoading.set(true);

    forkJoin({
      stores: this.storesService.getStores({})})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => {
          if (results.stores.success && results.stores.data) {
            this.stores.set(
              results.stores.data.map((store: any) => ({
                id: store.id,
                name: store.name,
                slug: store.slug})),
            );
          }
          this.loadDomains();
          this.loadStats();
        },
        error: (error) => {
          console.error('Error loading initial data:', error);
          this.isLoading.set(false);
          this.loadDomains();
          this.loadStats();
        }});
  }

  loadDomains(): void {
    this.isLoading.set(true);

    const query: DomainQueryDto = {
      ...(this.searchTerm() && { search: this.searchTerm() }),
      ...(this.selectedStatus() && {
        status: this.selectedStatus() as DomainStatus}),
      ...(this.selectedOwnership() && {
        ownership: this.selectedOwnership() as DomainOwnership}),
      ...(this.selectedStoreId() && {
        store_id: parseInt(this.selectedStoreId(), 10)})};

    this.domainsService
      .getDomains(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.domains.set(response.data);
          } else {
            this.domains.set([]);
          }
          this.isLoading.set(false);
        },
        error: (error) => {
          console.error('Error loading domains:', error);
          this.domains.set([]);
          this.isLoading.set(false);
        }});
  }

  loadStats(): void {
    this.domainsService
      .getDomainStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data || ({} as DomainStats);

          this.statsItems.set([
            {
              title: 'Total Dominios',
              value: data.total || 0,
              smallText: 'Registrados',
              iconName: 'globe',
              iconBgColor: 'bg-primary/10',
              iconColor: 'text-primary'},
            {
              title: 'Activos',
              value: data.active || 0,
              smallText: 'En funcionamiento',
              iconName: 'check-circle',
              iconBgColor: 'bg-green-100',
              iconColor: 'text-green-600'},
            {
              title: 'Pendientes',
              value: data.pending || 0,
              smallText: 'Verificación DNS/SSL',
              iconName: 'clock',
              iconBgColor: 'bg-yellow-100',
              iconColor: 'text-yellow-600'},
            {
              title: 'SSL Activo',
              value: data.verified || 0,
              smallText: 'Certificados emitidos',
              iconName: 'shield-check',
              iconBgColor: 'bg-purple-100',
              iconColor: 'text-purple-600'},
          ]);
        },
        error: (error) => {
          console.error('Error loading stats:', error);
          this.toastService.error('Error al cargar estadísticas');
        }});
  }

  refreshDomains(): void {
    this.loadDomains();
    this.loadStats();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.selectedStatus.set('');
    this.selectedOwnership.set('');
    this.selectedStoreId.set('');
    this.loadDomains();
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm.set(searchTerm);
    this.loadDomains();
  }

  onStatusChange(event: Event): void {
    this.selectedStatus.set((event.target as HTMLSelectElement).value);
    this.loadDomains();
  }

  onOwnershipChange(event: Event): void {
    this.selectedOwnership.set((event.target as HTMLSelectElement).value);
    this.loadDomains();
  }

  onStoreChange(event: Event): void {
    this.selectedStoreId.set((event.target as HTMLSelectElement).value);
    this.loadDomains();
  }

  onTableSort(sortEvent: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    this.loadDomains();
  }

  // Create Modal
  openCreateModal(): void {
    this.isCreateModalOpen.set(true);
  }

  onCreateModalCancel(): void {
    this.isCreateModalOpen.set(false);
  }

  createDomain(domainData: CreateDomainDto): void {
    this.isCreatingDomain.set(true);

    this.domainsService
      .createDomain(domainData)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.isCreateModalOpen.set(false);
            this.loadDomains();
            this.loadStats();
            this.toastService.success('Dominio creado exitosamente');
          } else {
            this.toastService.error('Respuesta inválida al crear el dominio');
          }
          this.isCreatingDomain.set(false);
        },
        error: (error) => {
          console.error('Error creating domain:', error);
          this.toastService.error(
            error.error?.message || 'Error al crear el dominio',
          );
          this.isCreatingDomain.set(false);
        }});
  }

  // Edit Modal
  editDomain(domain: Domain): void {
    this.selectedDomain.set(domain);
    this.isEditModalOpen.set(true);
  }

  onEditModalCancel(): void {
    this.isEditModalOpen.set(false);
    this.selectedDomain.set(null);
  }

  updateDomain(event: { hostname: string; data: UpdateDomainDto }): void {
    this.isUpdatingDomain.set(true);

    this.domainsService
      .updateDomain(event.hostname, event.data)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.isEditModalOpen.set(false);
            this.selectedDomain.set(null);
            this.loadDomains();
            this.loadStats();
            this.toastService.success('Dominio actualizado exitosamente');
          } else {
            this.toastService.error(
              'Respuesta inválida al actualizar el dominio',
            );
          }
          this.isUpdatingDomain.set(false);
        },
        error: (error) => {
          console.error('Error updating domain:', error);
          this.toastService.error(
            error.error?.message || 'Error al actualizar el dominio',
          );
          this.isUpdatingDomain.set(false);
        }});
  }

  // Verify Modal
  canVerifyDomain(domain: Domain): boolean {
    return (
      domain.ownership === DomainOwnership.CUSTOM_DOMAIN ||
      domain.ownership === DomainOwnership.CUSTOM_SUBDOMAIN
    );
  }

  openVerifyModal(domain: Domain): void {
    this.selectedDomainForVerify.set(domain);
    this.verificationResult.set(null);
    this.dnsInstructionsTarget.set(null);
    this.isVerifyModalOpen.set(true);

    // Load DNS instructions from backend so the modal can render the real
    // edge host (target). If the call fails, the computed `edgeHost` falls
    // back to environment.vendixDomain.
    this.domainsService
      .getDnsInstructions(domain.hostname)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success && response.data?.target) {
            this.dnsInstructionsTarget.set(response.data.target);
          }
        },
        error: (error) => {
          console.error('Error loading DNS instructions:', error);
        },
      });
  }

  onVerifyModalCancel(): void {
    this.isVerifyModalOpen.set(false);
    this.selectedDomainForVerify.set(null);
    this.verificationResult.set(null);
    this.dnsInstructionsTarget.set(null);
  }

  verifyDomain(hostname: string): void {
    this.isVerifyingDomain.set(true);

    this.domainsService
      .verifyDomain(hostname)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.verificationResult.set(response.data);
            if (response.data.verified) {
              this.loadDomains();
              this.loadStats();
              this.toastService.success('Dominio verificado exitosamente');
            }
          }
          this.isVerifyingDomain.set(false);
        },
        error: (error) => {
          console.error('Error verifying domain:', error);
          this.toastService.error(
            error.error?.message || 'Error al verificar el dominio',
          );
          this.isVerifyingDomain.set(false);
        }});
  }

  // Delete Modal
  deleteDomain(domain: Domain): void {
    this.selectedDomainForDelete.set(domain);
    this.isDeleteModalOpen.set(true);
  }

  onDeleteModalCancel(): void {
    this.isDeleteModalOpen.set(false);
    this.selectedDomainForDelete.set(null);
  }

  confirmDeleteDomain(hostname: string): void {
    this.domainsService
      .deleteDomain(hostname)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.domains.update((list) =>
              list.filter((d) => d.hostname !== hostname),
            );
            this.loadStats();
            this.toastService.success('Dominio eliminado exitosamente');
            this.isDeleteModalOpen.set(false);
            this.selectedDomainForDelete.set(null);
          } else {
            this.toastService.error(
              'Respuesta inválida al eliminar el dominio',
            );
          }
        },
        error: (error) => {
          console.error('Error deleting domain:', error);
          this.toastService.error(
            error.error?.message || 'Error al eliminar el dominio',
          );
        }});
  }

  // Formatters
  formatAppType(type: string): string {
    const typeMap: Record<string, string> = {
      STORE_ECOMMERCE: 'E-commerce',
      STORE_ADMIN: 'Admin Tienda',
      STORE_LANDING: 'Landing Tienda',
      ORG_ADMIN: 'Admin Org',
      ORG_LANDING: 'Landing Org'};
    return typeMap[type] || type || 'N/A';
  }

  formatOwnership(ownership: string): string {
    const ownershipMap: Record<string, string> = {
      vendix_subdomain: 'Vendix',
      custom_domain: 'Personalizado',
      custom_subdomain: 'Subdominio',
      third_party_subdomain: 'Terceros',
      vendix_core: 'Core'};
    return ownershipMap[ownership] || ownership;
  }

  formatStatus(status: string): string {
    const statusMap: Record<string, string> = {
      active: 'Activo',
      pending_dns: 'DNS Pendiente',
      pending_ssl: 'SSL Pendiente',
      disabled: 'Deshabilitado'};
    return statusMap[status] || status;
  }

  formatSslStatus(status: string): string {
    const sslMap: Record<string, string> = {
      issued: 'Activo',
      pending: 'Pendiente',
      none: 'Sin SSL',
      error: 'Error',
      revoked: 'Revocado'};
    return sslMap[status] || status;
  }

  getEmptyStateTitle(): string {
    if (this.hasFilters()) {
      return 'No se encontraron dominios con los filtros seleccionados';
    }
    return 'No hay dominios registrados';
  }

  getEmptyStateDescription(): string {
    if (this.hasFilters()) {
      return 'Intenta ajustar los filtros de búsqueda';
    }
    return 'Comienza creando tu primer dominio para tu organización o tiendas.';
  }
}
