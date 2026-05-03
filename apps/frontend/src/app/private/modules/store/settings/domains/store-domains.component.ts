import {Component,
  OnInit,
  ViewChild,
  TemplateRef,
  AfterViewInit,
  signal,
  DestroyRef,
  inject} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';


import {
  ButtonComponent,
  TableColumn,
  TableAction,
  IconComponent,
  StatsComponent,
  InputsearchComponent,
  ConfirmationModalComponent,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  FilterConfig,
  DropdownAction,
  FilterValues,
  CardComponent} from '../../../../../shared/components/index';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { StoreDomainsService } from './store-domains.service';
import {
  StoreDomain,
  CreateStoreDomainDto,
  UpdateStoreDomainDto,
  StoreDomainQueryDto,
  DnsInstructions} from './domain.interface';
import { environment } from '../../../../../../environments/environment';
import { DomainFormModalComponent } from './components/domain-form-modal.component';

@Component({
  selector: 'app-store-domains',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    StatsComponent,
    InputsearchComponent,
    CardComponent,
    DomainFormModalComponent,
    ConfirmationModalComponent,
    OptionsDropdownComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Cards — sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total"
          [value]="stats().total"
          smallText="Dominios registrados"
          iconName="globe"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
        ></app-stats>
        <app-stats
          title="Activos"
          [value]="stats().active"
          smallText="DNS/SSL verificado"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
        ></app-stats>
        <app-stats
          title="Pendientes"
          [value]="stats().pending"
          smallText="Verificación DNS/SSL"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
        ></app-stats>
        <app-stats
          title="Principal"
          [value]="stats().primary"
          smallText="Dominio por defecto"
          iconName="star"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
      </div>

      <!-- List Component Container — mobile-first: surface styles only on desktop -->
      <app-card [responsive]="true" [padding]="false">
        <!-- Search Section — sticky on mobile -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              Dominios ({{ domains().length }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar dominios..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              />
              <app-options-dropdown
                [filters]="filterConfigs"
                [actions]="dropdownActions"
                [filterValues]="filterValues"
                (actionClick)="onActionClick($event)"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
              />
            </div>
          </div>
        </div>

        <!-- Content Area -->
        <div class="px-2 pb-2 pt-0 md:p-4">
          <!-- Loading State -->
          @if (is_loading()) {
            <div class="flex justify-center items-center py-12">
              <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
            </div>
          }

          <!-- Empty State -->
          @if (!is_loading() && domains().length === 0) {
            <div class="text-center py-12">
              <app-icon
                name="globe"
                [size]="48"
                class="mx-auto text-text-muted mb-4 opacity-20"
              ></app-icon>
              <h3 class="text-lg font-medium text-text-primary mb-2">
                Sin dominios
              </h3>
              <p class="text-text-muted mb-6">
                Aún no tienes dominios configurados para tu tienda.
              </p>
              <app-button variant="primary" (clicked)="openCreateModal()">
                <app-icon name="plus" [size]="16" class="mr-2"></app-icon>
                Crear primer dominio
              </app-button>
            </div>
          }

          @if (!is_loading() && domains().length > 0) {
            <app-responsive-data-view
              [columns]="table_columns"
              [data]="domains()"
              [cardConfig]="card_config"
              [actions]="table_actions"
              [loading]="is_loading()"
              emptyMessage="No hay dominios configurados"
              emptyIcon="globe"
              (rowClick)="openEditModal($event)"
            >
            </app-responsive-data-view>
          }
        </div>
      </app-card>

      <!-- Templates -->
      <ng-template #hostnameTemplate let-item>
        <div class="flex items-center space-x-2">
          <span class="text-text-primary font-medium">{{ item.hostname }}</span>
          <a
            [href]="'https://' + item.hostname"
            target="_blank"
            class="text-text-muted hover:text-primary transition-colors"
            title="Abrir en nueva pestaña"
          >
            <app-icon name="external-link" [size]="14"></app-icon>
          </a>
        </div>
      </ng-template>

      @defer (when is_modal_open) {
        <app-domain-form-modal
          [(isOpen)]="is_modal_open"
          [domain]="editing_domain"
          [dnsInstructions]="dns_instructions()"
          [isSaving]="is_saving()"
          (save)="onSaveDomain($event)"
          (verify)="verifyDomain($event)"
        ></app-domain-form-modal>
      }

      <!-- Delete Confirmation Modal -->
      <app-confirmation-modal
        [(isOpen)]="is_delete_modal_open"
        title="Eliminar Dominio"
        [message]="
          '¿Estás seguro de que deseas eliminar el dominio ' +
          domain_to_delete?.hostname +
          '?'
        "
        confirmText="Eliminar"
        confirmVariant="danger"
        (confirm)="confirmDelete()"
        (cancel)="closeDeleteModal()"
      ></app-confirmation-modal>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
        background-color: var(--background);
      }
    `,
  ]})
export class StoreDomainsComponent implements OnInit, AfterViewInit {
  private destroyRef = inject(DestroyRef);
  @ViewChild('hostnameTemplate') hostnameTemplate!: TemplateRef<any>;

  protected readonly environment = environment;
readonly domains = signal<StoreDomain[]>([]);
  readonly dns_instructions = signal<DnsInstructions | null>(null);
  readonly is_loading = signal(false);
  is_modal_open = false;
  is_delete_modal_open = false;
  is_editing = false;
  readonly is_saving = signal(false);
  is_deleting = false;

  domain_to_delete: StoreDomain | null = null;
  editing_domain: StoreDomain | null = null;

  // Card Config for mobile
  card_config: ItemListCardConfig = {
    titleKey: 'hostname',
    subtitleKey: 'app_type',
    subtitleTransform: (item: any) => this.getAppTypeLabel(item.app_type),
    badgeKey: 'status',
    badgeConfig: { type: 'status' },
    badgeTransform: (val: string) => this.getStatusLabel(val),
    detailKeys: [
      {
        key: 'is_primary',
        label: 'Principal',
        transform: (val: boolean) => (val ? 'Sí' : 'No')},
      {
        key: 'ownership',
        label: 'Propiedad',
        transform: (val: string) => this.getOwnershipLabel(val)},
    ]};

  readonly stats = signal<{ total: number; active: number; pending: number; primary: string }>({
    total: 0,
    active: 0,
    pending: 0,
    primary: 'Ninguno'});

  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'active', label: 'Activo' },
        { value: 'pending_dns', label: 'Pendiente DNS' },
        { value: 'pending_ownership', label: 'Pendiente propiedad' },
        { value: 'verifying_ownership', label: 'Verificando propiedad' },
        { value: 'pending_ssl', label: 'Pendiente SSL' },
        { value: 'pending_certificate', label: 'Pendiente certificado' },
        { value: 'issuing_certificate', label: 'Emitiendo certificado' },
        { value: 'pending_alias', label: 'Pendiente alias' },
        { value: 'propagating', label: 'Propagando' },
        { value: 'failed_ownership', label: 'Falló propiedad' },
        { value: 'failed_certificate', label: 'Falló certificado' },
        { value: 'failed_alias', label: 'Falló alias' },
        { value: 'disabled', label: 'Deshabilitado' },
      ]},
    {
      key: 'app_type',
      label: 'Aplicación',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'STORE_ECOMMERCE', label: 'E-commerce' },
        { value: 'STORE_LANDING', label: 'Landing tienda' },
        { value: 'STORE_ADMIN', label: 'Admin tienda' },
      ]},
  ];

  filterValues: FilterValues = {};

  dropdownActions: DropdownAction[] = [
    {
      label: 'Nuevo Dominio',
      icon: 'plus',
      action: 'create',
      variant: 'primary'},
  ];

  table_columns: TableColumn[] = [
    {
      key: 'hostname',
      label: 'Hostname',
      sortable: true},
    {
      key: 'app_type',
      label: 'Aplicación',
      sortable: true,
      transform: (value: string) => this.getAppTypeLabel(value)},
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      badge: true,
      badgeConfig: {
        type: 'status'},
      transform: (value: string) => this.getStatusLabel(value)},
    {
      key: 'is_primary',
      label: 'Principal',
      sortable: false,
      transform: (value: boolean) => (value ? 'Sí' : 'No')},
    {
      key: 'ownership',
      label: 'Propiedad',
      sortable: true,
      transform: (value: string) => this.getOwnershipLabel(value)},
  ];

  table_actions: TableAction[] = [
    {
      label: 'Abrir',
      icon: 'external-link',
      variant: 'ghost',
      action: (item: StoreDomain) => this.openDomainInNewTab(item)},
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (item: StoreDomain) => this.openEditModal(item)},
    {
      label: 'Verificar DNS',
      icon: 'shield-check',
      variant: 'success',
      action: (item: StoreDomain) => this.verifyDomain(item),
      disabled: (row: StoreDomain) => !this.isCustomDomain(row) || row.status === 'active'},
    {
      label: 'Provisionar',
      icon: 'refresh-cw',
      variant: 'warning',
      action: (item: StoreDomain) => this.provisionDomain(item),
      disabled: (row: StoreDomain) => !this.canProvisionDomain(row)},
    {
      label: 'Establecer Principal',
      icon: 'star',
      variant: 'ghost',
      action: (item: StoreDomain) => this.setAsPrimary(item),
      disabled: (row: StoreDomain) => row.is_primary},
    {
      label: 'Eliminar',
      icon: 'trash',
      action: (item: StoreDomain) => this.openDeleteModal(item),
      variant: 'danger',
      disabled: (row: StoreDomain) => row.is_primary},
  ];

  constructor(
    private domains_service: StoreDomainsService,
    private toast_service: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadDomains();

    this.domains_service.is_loading$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((loading) => this.is_loading.set(loading));
  }

  ngAfterViewInit(): void {
    if (this.hostnameTemplate) {
      // Asignar el template a la columna de hostname
      const hostnameCol = this.table_columns.find(
        (col) => col.key === 'hostname',
      );
      if (hostnameCol) {
        hostnameCol.template = this.hostnameTemplate;
      }
    }
  }
loadDomains(query?: StoreDomainQueryDto): void {
    this.domains_service
      .getDomains(query || { page: 1, limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.domains.set(response.data);
            this.calculateStats();
          }
        },
        error: (error) => {
          this.toast_service.error('Error al cargar los dominios');
        }});
  }

  calculateStats(): void {
    const domains = this.domains();
    const total = domains.length;
    const active = domains.filter((d) => d.status === 'active').length;
    const pending = domains.filter(
      (d) =>
        d.status === 'pending_dns' ||
        d.status === 'pending_ssl' ||
        d.status === 'pending_ownership' ||
        d.status === 'verifying_ownership' ||
        d.status === 'pending_certificate' ||
        d.status === 'issuing_certificate' ||
        d.status === 'pending_alias' ||
        d.status === 'propagating',
    ).length;
    const primaryDomain = domains.find((d) => d.is_primary);

    this.stats.set({
      total,
      active,
      pending,
      primary: primaryDomain ? primaryDomain.hostname : 'Ninguno'});
  }

  onSearch(term: string): void {
    this.loadDomains({ search: term });
  }

  onActionClick(action: string): void {
    if (action === 'create') this.openCreateModal();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    const query: StoreDomainQueryDto = {};
    if (values['status']) query.status = values['status'] as any;
    if (values['app_type']) query.app_type = values['app_type'] as any;
    this.loadDomains(query);
  }

  clearFilters(): void {
    this.filterValues = {};
    this.loadDomains();
  }

  openDomainInNewTab(domain: StoreDomain): void {
    window.open('https://' + domain.hostname, '_blank');
  }

  openCreateModal(): void {
    this.editing_domain = null;
    this.dns_instructions.set(null);
    this.is_modal_open = true;
  }

  openEditModal(domain: StoreDomain): void {
    this.editing_domain = domain;
    this.dns_instructions.set(null);
    this.is_modal_open = true;
    if (this.isCustomDomain(domain)) {
      this.loadDnsInstructions(domain);
    }
  }

  closeModal(): void {
    this.is_modal_open = false;
    this.editing_domain = null;
    this.dns_instructions.set(null);
  }

  onSaveDomain(dto: CreateStoreDomainDto): void {
    this.is_saving.set(true);

    if (this.editing_domain) {
      this.domains_service
        .updateDomain(this.editing_domain.id, dto as UpdateStoreDomainDto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toast_service.success('Dominio actualizado correctamente');
            this.closeModal();
            this.loadDomains();
            this.is_saving.set(false);
          },
          error: () => {
            this.toast_service.error('Error al actualizar el dominio');
            this.is_saving.set(false);
          }});
    } else {
      this.domains_service
        .createDomain(dto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toast_service.success('Dominio creado correctamente');
            this.closeModal();
            this.loadDomains();
            this.is_saving.set(false);
          },
          error: () => {
            this.toast_service.error('Error al crear el dominio');
            this.is_saving.set(false);
          }});
    }
  }

  setAsPrimary(domain: StoreDomain): void {
    this.domains_service
      .setAsPrimary(domain.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast_service.success('Dominio establecido como principal');
          this.loadDomains();
        },
        error: () => {
          this.toast_service.error(
            'Error al establecer dominio como principal',
          );
        }});
  }

  loadDnsInstructions(domain: StoreDomain): void {
    this.domains_service
      .getDnsInstructions(domain.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.dns_instructions.set(response.data);
          }
        },
        error: () => {
          this.toast_service.error('Error al cargar instrucciones DNS');
        }});
  }

  verifyDomain(domain: StoreDomain): void {
    this.is_saving.set(true);
    this.domains_service
      .verifyDomain(domain.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success && response.data.verified) {
            this.toast_service.success(
              'Propiedad verificada. Certificado pendiente de emisión.',
            );
            this.closeModal();
          } else {
            this.toast_service.warning('No se encontró el TXT de verificación');
          }
          this.loadDomains();
          this.is_saving.set(false);
        },
        error: () => {
          this.toast_service.error('Error al verificar el dominio');
          this.is_saving.set(false);
        }});
  }

  provisionDomain(domain: StoreDomain): void {
    this.is_saving.set(true);
    this.domains_service
      .provisionNext(domain.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast_service.success('Provisioning actualizado');
          this.loadDomains();
          if (this.editing_domain?.id === domain.id) {
            this.loadDnsInstructions(domain);
          }
          this.is_saving.set(false);
        },
        error: () => {
          this.toast_service.error('Error al provisionar el dominio');
          this.is_saving.set(false);
        }});
  }

  openDeleteModal(domain: StoreDomain): void {
    this.domain_to_delete = domain;
    this.is_delete_modal_open = true;
  }

  closeDeleteModal(): void {
    this.is_delete_modal_open = false;
    this.domain_to_delete = null;
  }

  confirmDelete(): void {
    if (!this.domain_to_delete) return;

    this.is_deleting = true;
    this.domains_service
      .deleteDomain(this.domain_to_delete.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast_service.success('Dominio eliminado correctamente');
          this.closeDeleteModal();
          this.loadDomains();
          this.is_deleting = false;
        },
        error: () => {
          this.toast_service.error('Error al eliminar el dominio');
          this.is_deleting = false;
        }});
  }

  // Helper methods
  getDomainTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      store: 'Tienda',
      ecommerce: 'E-commerce',
      organization: 'Organización',
      vendix_core: 'Vendix Core'};
    return labels[type] || type;
  }

  getAppTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      STORE_ECOMMERCE: 'E-commerce',
      STORE_LANDING: 'Landing tienda',
      STORE_ADMIN: 'Admin tienda'};
    return labels[type] || type;
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending_dns: 'Pendiente DNS',
      pending_ownership: 'Pendiente propiedad',
      verifying_ownership: 'Verificando propiedad',
      pending_ssl: 'Pendiente SSL',
      pending_certificate: 'Pendiente certificado',
      issuing_certificate: 'Emitiendo certificado',
      pending_alias: 'Pendiente alias',
      propagating: 'Propagando',
      failed_ownership: 'Falló propiedad',
      failed_certificate: 'Falló certificado',
      failed_alias: 'Falló alias',
      active: 'Activo',
      disabled: 'Deshabilitado'};
    return labels[status] || status;
  }

  getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      pending_dns: 'yellow',
      pending_ownership: 'yellow',
      verifying_ownership: 'yellow',
      pending_ssl: 'yellow',
      pending_certificate: 'yellow',
      issuing_certificate: 'yellow',
      pending_alias: 'yellow',
      propagating: 'yellow',
      failed_ownership: 'red',
      failed_certificate: 'red',
      failed_alias: 'red',
      active: 'green',
      disabled: 'red'};
    return colors[status] || 'gray';
  }

  getOwnershipLabel(ownership: string): string {
    const labels: Record<string, string> = {
      vendix_subdomain: 'Subdominio Vendix',
      custom_domain: 'Dominio Propio',
      custom_subdomain: 'Subdominio Propio',
      vendix_core: 'Vendix Core',
      third_party_subdomain: 'Subdominio Terceros'};
    return labels[ownership] || ownership;
  }

  isCustomDomain(domain: StoreDomain): boolean {
    return (
      domain.ownership === 'custom_domain' ||
      domain.ownership === 'custom_subdomain'
    );
  }

  canProvisionDomain(domain: StoreDomain): boolean {
    return (
      this.isCustomDomain(domain) &&
      domain.last_verified_at != null &&
      domain.status !== 'active' &&
      domain.status !== 'failed_ownership'
    );
  }
}
