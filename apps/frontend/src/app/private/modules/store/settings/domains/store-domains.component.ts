import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  TemplateRef,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

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
} from '../../../../../shared/components/index';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { StoreDomainsService } from './store-domains.service';
import {
  StoreDomain,
  CreateStoreDomainDto,
  UpdateStoreDomainDto,
  StoreDomainQueryDto,
} from './domain.interface';
import { environment } from '../../../../../../environments/environment';
import { DomainFormModalComponent } from './components/domain-form-modal.component';

@Component({
  selector: 'app-store-domains',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    StatsComponent,
    InputsearchComponent,
    DomainFormModalComponent,
    ConfirmationModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- 4 Stats Cards Grid -->
      <div
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4 lg:gap-6 mb-4 md:mb-6 lg:mb-8"
      >
        <app-stats
          title="Total"
          [value]="stats.total"
          iconName="globe"
        ></app-stats>
        <app-stats
          title="Activos"
          [value]="stats.active"
          iconName="check-circle"
          iconBgColor="bg-green-50"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Pendientes"
          [value]="stats.pending"
          iconName="clock"
          iconBgColor="bg-yellow-50"
          iconColor="text-yellow-600"
        ></app-stats>
        <app-stats
          title="Principal"
          [value]="stats.primary"
          iconName="star"
          iconBgColor="bg-blue-50"
          iconColor="text-blue-600"
        ></app-stats>
      </div>

      <!-- List Component Container -->
      <div
        class="bg-surface rounded-card shadow-card border border-border min-h-[600px]"
      >
        <!-- Header -->
        <div class="p-2 md:px-6 md:py-4 border-b border-border">
          <div
            class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
          >
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                Dominios ({{ domains.length }})
              </h2>
              <p class="text-sm text-text-muted mt-0.5">
                Administra los dominios y subdominios de tu tienda
              </p>
            </div>

            <div
              class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto"
            >
              <!-- Search -->
              <app-inputsearch
                class="w-full sm:w-64"
                placeholder="Buscar dominios..."
                (search)="onSearch($event)"
              ></app-inputsearch>

              <!-- Actions -->
              <div class="flex gap-2">
                <app-button variant="outline" (clicked)="loadDomains()">
                  <app-icon name="refresh" [size]="16"></app-icon>
                </app-button>
                <app-button variant="primary" (clicked)="openCreateModal()">
                  <app-icon name="plus" [size]="16" class="mr-2"></app-icon>
                  Nuevo
                </app-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Table -->
        <div class="p-2 md:p-4">
          <!-- Loading State -->
          <div
            *ngIf="is_loading"
            class="flex justify-center items-center py-12"
          >
            <div
              class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
          </div>

          <!-- Empty State -->
          <div
            *ngIf="!is_loading && domains.length === 0"
            class="text-center py-12"
          >
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

          <app-responsive-data-view
            *ngIf="!is_loading && domains.length > 0"
            [columns]="table_columns"
            [data]="domains"
            [cardConfig]="card_config"
            [actions]="table_actions"
            [loading]="is_loading"
            emptyMessage="No hay dominios configurados"
            emptyIcon="globe"
          >
          </app-responsive-data-view>
        </div>
      </div>

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

      <!-- New Form Modal -->
      <app-domain-form-modal
        [(isOpen)]="is_modal_open"
        [domain]="editing_domain"
        [isSaving]="is_saving"
        (save)="onSaveDomain($event)"
      ></app-domain-form-modal>

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
  ],
})
export class StoreDomainsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('hostnameTemplate') hostnameTemplate!: TemplateRef<any>;

  protected readonly environment = environment;
  private destroy$ = new Subject<void>();

  domains: StoreDomain[] = [];
  is_loading = false;
  is_modal_open = false;
  is_delete_modal_open = false;
  is_editing = false;
  is_saving = false;
  is_deleting = false;

  domain_to_delete: StoreDomain | null = null;
  editing_domain: StoreDomain | null = null;

  // Card Config for mobile
  card_config: ItemListCardConfig = {
    titleKey: 'hostname',
    subtitleKey: 'domain_type',
    subtitleTransform: (val: string) => this.getDomainTypeLabel(val),
    badgeKey: 'status',
    badgeConfig: { type: 'status' },
    badgeTransform: (val: string) => this.getStatusLabel(val),
    detailKeys: [
      {
        key: 'is_primary',
        label: 'Principal',
        transform: (val: boolean) => (val ? 'Sí' : 'No'),
      },
      {
        key: 'ownership',
        label: 'Propiedad',
        transform: (val: string) => this.getOwnershipLabel(val),
      },
    ],
  };

  stats = {
    total: 0,
    active: 0,
    pending: 0,
    primary: 'Ninguno',
  };

  table_columns: TableColumn[] = [
    {
      key: 'hostname',
      label: 'Hostname',
      sortable: true,
    },
    {
      key: 'domain_type',
      label: 'Tipo',
      sortable: true,
      transform: (value: string) => this.getDomainTypeLabel(value),
    },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      badge: true,
      badgeConfig: {
        type: 'status',
      },
      transform: (value: string) => this.getStatusLabel(value),
    },
    {
      key: 'is_primary',
      label: 'Principal',
      sortable: false,
      transform: (value: boolean) => (value ? 'Sí' : 'No'),
    },
    {
      key: 'ownership',
      label: 'Propiedad',
      sortable: true,
      transform: (value: string) => this.getOwnershipLabel(value),
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (item: StoreDomain) => this.openEditModal(item),
    },
    {
      label: 'Establecer Principal',
      icon: 'star',
      action: (item: StoreDomain) => this.setAsPrimary(item),
      disabled: (row: StoreDomain) => row.is_primary,
    },
    {
      label: 'Eliminar',
      icon: 'trash',
      action: (item: StoreDomain) => this.openDeleteModal(item),
      variant: 'danger',
      disabled: (row: StoreDomain) => row.is_primary,
    },
  ];

  constructor(
    private domains_service: StoreDomainsService,
    private toast_service: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadDomains();

    this.domains_service.is_loading$
      .pipe(takeUntil(this.destroy$))
      .subscribe((loading) => (this.is_loading = loading));
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

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDomains(query?: StoreDomainQueryDto): void {
    this.domains_service
      .getDomains(query || { page: 1, limit: 50 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.domains = response.data;
            this.calculateStats();
          }
        },
        error: (error) => {
          this.toast_service.error('Error al cargar los dominios');
        },
      });
  }

  calculateStats(): void {
    const total = this.domains.length;
    const active = this.domains.filter((d) => d.status === 'active').length;
    const pending = this.domains.filter(
      (d) => d.status === 'pending_dns' || d.status === 'pending_ssl',
    ).length;
    const primaryDomain = this.domains.find((d) => d.is_primary);

    this.stats = {
      total,
      active,
      pending,
      primary: primaryDomain ? primaryDomain.hostname : 'Ninguno',
    };
  }

  onSearch(term: string): void {
    this.loadDomains({ search: term });
  }

  openCreateModal(): void {
    this.editing_domain = null;
    this.is_modal_open = true;
  }

  openEditModal(domain: StoreDomain): void {
    this.editing_domain = domain;
    this.is_modal_open = true;
  }

  closeModal(): void {
    this.is_modal_open = false;
    this.editing_domain = null;
  }

  onSaveDomain(dto: CreateStoreDomainDto): void {
    this.is_saving = true;

    if (this.editing_domain) {
      this.domains_service
        .updateDomain(this.editing_domain.id, dto as UpdateStoreDomainDto)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Dominio actualizado correctamente');
            this.closeModal();
            this.loadDomains();
            this.is_saving = false;
          },
          error: () => {
            this.toast_service.error('Error al actualizar el dominio');
            this.is_saving = false;
          },
        });
    } else {
      this.domains_service
        .createDomain(dto)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Dominio creado correctamente');
            this.closeModal();
            this.loadDomains();
            this.is_saving = false;
          },
          error: () => {
            this.toast_service.error('Error al crear el dominio');
            this.is_saving = false;
          },
        });
    }
  }

  setAsPrimary(domain: StoreDomain): void {
    this.domains_service
      .setAsPrimary(domain.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toast_service.success('Dominio establecido como principal');
          this.loadDomains();
        },
        error: () => {
          this.toast_service.error(
            'Error al establecer dominio como principal',
          );
        },
      });
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
      .pipe(takeUntil(this.destroy$))
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
        },
      });
  }

  // Helper methods
  getDomainTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      store: 'Tienda',
      ecommerce: 'E-commerce',
      organization: 'Organización',
      vendix_core: 'Vendix Core',
    };
    return labels[type] || type;
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending_dns: 'Pendiente DNS',
      pending_ssl: 'Pendiente SSL',
      active: 'Activo',
      disabled: 'Deshabilitado',
    };
    return labels[status] || status;
  }

  getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      pending_dns: 'yellow',
      pending_ssl: 'yellow',
      active: 'green',
      disabled: 'red',
    };
    return colors[status] || 'gray';
  }

  getOwnershipLabel(ownership: string): string {
    const labels: Record<string, string> = {
      vendix_subdomain: 'Subdominio Vendix',
      custom_domain: 'Dominio Propio',
      custom_subdomain: 'Subdominio Propio',
      vendix_core: 'Vendix Core',
      third_party_subdomain: 'Subdominio Terceros',
    };
    return labels[ownership] || ownership;
  }
}
