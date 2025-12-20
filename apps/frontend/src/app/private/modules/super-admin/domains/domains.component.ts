import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';

import { DomainsService } from './services/domains.service';
import {
  DomainListItem,
  DomainType,
  DomainStatus,
  CreateDomainDto,
  UpdateDomainDto,
  DomainStats,
  Domain,
} from './interfaces/domain.interface';

import {
  DomainCreateModalComponent,
  DomainEditModalComponent,
  DomainStatsComponent,
} from './components/index';

// Import shared components
import {
  InputsearchComponent,
  IconComponent,
  TableComponent,
  ButtonComponent,
  DialogService,
  ToastService,
} from '../../../../shared/components/index';
import { TableColumn, TableAction } from '../../../../shared/components/index';

// Import styles (CSS instead of SCSS to avoid loader issues)
import './domains.component.css';

@Component({
  selector: 'app-domains',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    InputsearchComponent,
    IconComponent,
    TableComponent,
    ButtonComponent,
    DomainCreateModalComponent,
    DomainEditModalComponent,
    DomainStatsComponent,
  ],
  providers: [DomainsService],
  template: `
    <div class="space-y-6">
      <!-- Domain Stats Component -->
      <app-domain-stats [stats]="stats"></app-domain-stats>

      <!-- Domains List -->
      <div class="bg-surface rounded-card shadow-card border border-border">
        <div class="px-6 py-4 border-b border-border">
          <div
            class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
          >
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                Todos los Dominios ({{ pagination.total }})
              </h2>
            </div>

            <div
              class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto"
            >
              <!-- Input de búsqueda -->
              <app-inputsearch
                class="w-full sm:w-64"
                size="sm"
                placeholder="Buscar dominios..."
                [debounceTime]="1000"
                (searchChange)="onSearchChange($event)"
              ></app-inputsearch>

              <div class="flex gap-2 items-center">
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="openCreateDomainModal()"
                  title="Nuevo Dominio"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  <span class="hidden sm:inline">Nuevo Dominio</span>
                </app-button>
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="refreshDomains()"
                  [disabled]="isLoading"
                  title="Actualizar"
                >
                  <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
                </app-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="isLoading" class="p-8 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary">Cargando dominios...</p>
        </div>

        <!-- Empty State -->
        <div *ngIf="!isLoading && domains.length === 0" class="p-8 text-center">
          <div class="flex flex-col items-center justify-center space-y-4">
            <div class="p-4 bg-surface rounded-full">
              <app-icon
                name="globe-2"
                [size]="32"
                class="text-text-tertiary"
              ></app-icon>
            </div>
            <div>
              <h3 class="text-lg font-medium text-text-primary">
                {{ getEmptyStateTitle() }}
              </h3>
              <p class="text-text-secondary mt-1">
                {{ getEmptyStateDescription() }}
              </p>
            </div>
            <app-button
              variant="primary"
              size="sm"
              (clicked)="openCreateDomainModal()"
            >
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              Crear Primer Dominio
            </app-button>
          </div>
        </div>

        <!-- Domains Table -->
        <div *ngIf="!isLoading && domains.length > 0" class="p-6">
          <app-table
            [data]="domains"
            [columns]="tableColumns"
            [actions]="tableActions"
            [loading]="isLoading"
            [sortable]="true"
            [hoverable]="true"
            [striped]="true"
            size="md"
            (sort)="onTableSort($event)"
            (rowClick)="viewDomain($event)"
          >
          </app-table>

          <!-- Pagination -->
          <div class="mt-6 flex justify-between items-center">
            <div class="text-sm text-text-secondary">
              Mostrando {{ domains.length }} de {{ pagination.total }} dominios
            </div>
            <div class="flex gap-2">
              <app-button
                variant="outline"
                size="sm"
                (clicked)="changePage(pagination.page - 1)"
                [disabled]="pagination.page <= 1"
              >
                <app-icon
                  name="chevron-left"
                  [size]="16"
                  slot="icon"
                ></app-icon>
                Anterior
              </app-button>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="changePage(pagination.page + 1)"
                [disabled]="pagination.page >= pagination.totalPages"
              >
                Siguiente
                <app-icon
                  name="chevron-right"
                  [size]="16"
                  slot="icon"
                ></app-icon>
              </app-button>
            </div>
          </div>
        </div>
      </div>

      <!-- Create Domain Modal -->
      <app-domain-create-modal
        [isOpen]="isCreateModalOpen"
        [isLoading]="isCreatingDomain"
        (openChange)="onCreateModalChange($event)"
        (create)="createDomain($event)"
        (cancel)="onCreateModalCancel()"
      ></app-domain-create-modal>

      <!-- Edit Domain Modal -->
      <app-domain-edit-modal
        [isOpen]="isEditModalOpen"
        [isLoading]="isUpdatingDomain"
        [domain]="selectedDomain"
        (openChange)="onEditModalChange($event)"
        (update)="updateDomain($event)"
        (cancel)="onEditModalCancel()"
      ></app-domain-edit-modal>
    </div>
  `,
})
export class DomainsComponent implements OnInit, OnDestroy {
  domains: DomainListItem[] = [];
  isLoading = false;
  searchTerm = '';

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'hostname', label: 'Hostname', sortable: true, width: '250px', priority: 1 },
    {
      key: 'domain_type',
      label: 'Tipo',
      sortable: true,
      width: '120px',
      align: 'center',
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          primary: '#22c55e',
          alias: '#3b82f6',
          customer: '#8b5cf6',
        },
      },
      transform: (value: DomainType) => this.formatDomainType(value),
    },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      width: '120px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: DomainStatus) => this.formatDomainStatus(value),
    },
    {
      key: 'organization.name',
      label: 'Organización',
      sortable: true,
      width: '180px',
      defaultValue: 'N/A',
      priority: 2,
    },
    {
      key: 'store.name',
      label: 'Tienda',
      sortable: true,
      width: '150px',
      defaultValue: 'N/A',
      priority: 2,
    },
    {
      key: 'created_at',
      label: 'Creado',
      sortable: true,
      width: '120px',
      priority: 3,
      transform: (value: string) => this.formatDate(value),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (domain) => this.editDomain(domain),
      variant: 'primary',
    },
    {
      label: 'Verificar',
      icon: 'shield-check',
      action: (domain) => this.verifyDomain(domain),
      variant: 'secondary',
      disabled: (domain) => domain.status === DomainStatus.VERIFIED,
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (domain) => this.deleteDomain(domain),
      variant: 'danger',
    },
  ];

  stats: DomainStats = {
    total_domains: 0,
    active_domains: 0,
    pending_domains: 0,
    verified_domains: 0,
    customer_domains: 0,
    primary_domains: 0,
    alias_domains: 0,
    vendix_subdomains: 0,
    customer_custom_domains: 0,
    customer_subdomains: 0,
  };

  pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  };

  // Modal state
  isCreateModalOpen = false;
  isEditModalOpen = false;
  isCreatingDomain = false;
  isUpdatingDomain = false;
  selectedDomain: Domain | null = null;
  createDomainForm!: FormGroup;

  private subscriptions: Subscription[] = [];

  constructor(
    private domainsService: DomainsService,
    private fb: FormBuilder,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) {
    this.initializeCreateForm();
  }

  ngOnInit(): void {
    this.loadDomains();
    this.loadStats();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  private initializeCreateForm(): void {
    this.createDomainForm = this.fb.group({
      hostname: ['', [Validators.required, Validators.minLength(3)]],
      domain_type: [DomainType.PRIMARY, [Validators.required]],
      organization_id: [null, [Validators.required]],
      store_id: [null],
      primary_color: ['#7ED7A5'],
      theme: ['light'],
    });
  }

  openCreateDomainModal(): void {
    this.isCreateModalOpen = true;
    this.createDomainForm.reset({
      hostname: '',
      domain_type: DomainType.PRIMARY,
      organization_id: null,
      store_id: null,
      primary_color: '#7ED7A5',
      theme: 'light',
    });
  }

  onCreateModalChange(event: boolean | Event): void {
    const isOpen = typeof event === 'boolean' ? event : false;
    this.isCreateModalOpen = isOpen;
    if (!isOpen) {
      this.createDomainForm.reset();
    }
  }

  onCreateModalCancel(): void {
    this.isCreateModalOpen = false;
    this.createDomainForm.reset();
  }

  createDomain(domainData: CreateDomainDto): void {
    this.isCreatingDomain = true;

    const sub = this.domainsService.createDomain(domainData).subscribe({
      next: (response) => {
        if (response.success) {
          this.isCreateModalOpen = false;
          this.loadDomains();
          this.loadStats();
          this.toastService.success('Dominio creado exitosamente');
        }
        this.isCreatingDomain = false;
      },
      error: (error) => {
        console.error('Error creating domain:', error);
        this.toastService.error('Error al crear el dominio');
        this.isCreatingDomain = false;
      },
    });

    this.subscriptions.push(sub);
  }

  // Edit modal methods
  openEditDomainModal(domain: DomainListItem): void {
    this.selectedDomain = domain as Domain;
    this.isEditModalOpen = true;
  }

  onEditModalChange(event: boolean | Event): void {
    const isOpen = typeof event === 'boolean' ? event : false;
    this.isEditModalOpen = isOpen;
    if (!isOpen) {
      this.selectedDomain = null;
    }
  }

  onEditModalCancel(): void {
    this.isEditModalOpen = false;
    this.selectedDomain = null;
  }

  updateDomain(event: { id: number; data: UpdateDomainDto }): void {
    this.isUpdatingDomain = true;

    const sub = this.domainsService
      .updateDomain(event.id, event.data)
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.isEditModalOpen = false;
            this.selectedDomain = null;
            this.loadDomains();
            this.loadStats();
            this.toastService.success('Dominio actualizado exitosamente');
          }
          this.isUpdatingDomain = false;
        },
        error: (error) => {
          console.error('Error updating domain:', error);
          this.toastService.error('Error al actualizar el dominio');
          this.isUpdatingDomain = false;
        },
      });

    this.subscriptions.push(sub);
  }

  loadDomains(): void {
    this.isLoading = true;

    const query = {
      page: this.pagination.page,
      limit: this.pagination.limit,
      ...(this.searchTerm && { search: this.searchTerm }),
    };

    const sub = this.domainsService.getDomains(query).subscribe({
      next: (response) => {
        if (response.success) {
          this.domains = response.data.map((domain: any) => ({
            id: domain.id,
            hostname: domain.hostname,
            domain_type: domain.domain_type,
            status: domain.status,
            organization_id: domain.organization_id,
            store_id: domain.store_id,
            organization: domain.organization || {
              id: domain.organization_id,
              name: 'N/A',
            },
            store: domain.store || undefined,
            created_at: domain.created_at || new Date().toISOString(),
            updated_at: domain.updated_at || new Date().toISOString(),
          }));

          this.pagination.total = response.meta.total;
          this.pagination.totalPages = response.meta.totalPages;
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading domains:', error);
        this.isLoading = false;
      },
    });

    this.subscriptions.push(sub);
  }

  loadStats(): void {
    const sub = this.domainsService.getDomainStatsList().subscribe({
      next: (response) => {
        if (response.success) {
          this.stats = response.data;
        }
      },
      error: (error) => {
        console.error('Error loading domain stats:', error);
        this.updateStats();
      },
    });

    this.subscriptions.push(sub);
  }

  updateStats(): void {
    this.stats.total_domains = this.domains.length;
    this.stats.active_domains = this.domains.filter(
      (domain) => domain.status === DomainStatus.ACTIVE,
    ).length;
    this.stats.pending_domains = this.domains.filter(
      (domain) => domain.status === DomainStatus.PENDING,
    ).length;
    this.stats.verified_domains = this.domains.filter(
      (domain) => domain.status === DomainStatus.VERIFIED,
    ).length;
    this.stats.primary_domains = this.domains.filter(
      (domain) => domain.domain_type === DomainType.PRIMARY,
    ).length;
    this.stats.alias_domains = this.domains.filter(
      (domain) => domain.domain_type === DomainType.ALIAS,
    ).length;
    this.stats.customer_domains = this.domains.filter(
      (domain) => domain.domain_type === DomainType.CUSTOMER,
    ).length;

    // Calculate new stats
    this.stats.vendix_subdomains = this.stats.primary_domains;
    this.stats.customer_custom_domains = this.stats.customer_domains;
    this.stats.customer_subdomains = this.stats.alias_domains;
  }

  refreshDomains(): void {
    this.loadDomains();
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.pagination.page = 1;
    this.loadDomains();
  }

  onTableSort(sortEvent: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    console.log('Sort event:', sortEvent);
    this.loadDomains();
  }

  changePage(page: number): void {
    this.pagination.page = page;
    this.loadDomains();
  }

  // Helper methods for table display
  formatDomainType(type: DomainType): string {
    const typeMap: { [key in DomainType]: string } = {
      [DomainType.PRIMARY]: 'Primario',
      [DomainType.ALIAS]: 'Alias',
      [DomainType.CUSTOMER]: 'Cliente',
    };
    return typeMap[type] || type;
  }

  formatDomainStatus(status: DomainStatus): string {
    const statusMap: { [key in DomainStatus]: string } = {
      [DomainStatus.ACTIVE]: 'Activo',
      [DomainStatus.INACTIVE]: 'Inactivo',
      [DomainStatus.PENDING]: 'Pendiente',
      [DomainStatus.VERIFIED]: 'Verificado',
      [DomainStatus.FAILED]: 'Fallido',
    };
    return statusMap[status] || status;
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  deleteDomain(domain: DomainListItem): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Dominio',
        message: `¿Estás seguro de que deseas eliminar el dominio "${domain.hostname}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          const sub = this.domainsService.deleteDomain(domain.id).subscribe({
            next: (response) => {
              if (response.success) {
                this.loadDomains();
                this.toastService.success('Dominio eliminado exitosamente');
              }
            },
            error: (error) => {
              console.error('Error deleting domain:', error);
              this.toastService.error('Error al eliminar el dominio');
            },
          });

          this.subscriptions.push(sub);
        }
      });
  }

  viewDomain(domain: DomainListItem): void {
    console.log('View domain:', domain);
  }

  editDomain(domain: DomainListItem): void {
    this.openEditDomainModal(domain);
  }

  verifyDomain(domain: DomainListItem): void {
    const sub = this.domainsService.verifyDomain(domain.id).subscribe({
      next: (response) => {
        if (response.success) {
          this.loadDomains();
          this.toastService.success('Dominio verificado exitosamente');
        }
      },
      error: (error) => {
        console.error('Error verifying domain:', error);
        this.toastService.error('Error al verificar el dominio');
      },
    });

    this.subscriptions.push(sub);
  }

  getEmptyStateTitle(): string {
    if (this.searchTerm) {
      return 'No se encontraron dominios';
    }
    return 'No hay dominios';
  }

  getEmptyStateDescription(): string {
    if (this.searchTerm) {
      return 'Intenta ajustar tus términos de búsqueda';
    }
    return 'Comienza creando tu primer dominio.';
  }
}
