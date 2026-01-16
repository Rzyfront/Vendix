import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import {
  ButtonComponent,
  TableComponent,
  TableColumn,
  TableAction,
  ModalComponent,
  IconComponent,
} from '../../../../../shared/components/index';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { StoreDomainsService } from './store-domains.service';
import {
  StoreDomain,
  CreateStoreDomainDto,
  UpdateStoreDomainDto,
  StoreDomainQueryDto,
} from './domain.interface';

@Component({
  selector: 'app-store-domains',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    TableComponent,
    ModalComponent,
    IconComponent,
  ],
  template: `
    <div class="p-6">
      <!-- Header -->
      <div class="flex justify-between items-center mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Dominios</h1>
          <p class="text-sm text-gray-500 mt-1">
            Administra los dominios de tu tienda
          </p>
        </div>
        <app-button
          variant="primary"
          size="md"
          (clicked)="openCreateModal()"
        >
          <app-icon name="plus" [size]="16" class="mr-2"></app-icon>
          Nuevo Dominio
        </app-button>
      </div>

      <!-- Loading State -->
      <div *ngIf="is_loading" class="flex justify-center items-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>

      <!-- Empty State -->
      <div
        *ngIf="!is_loading && domains.length === 0"
        class="text-center py-12 bg-white rounded-lg border border-gray-200"
      >
        <app-icon name="globe" [size]="48" class="mx-auto text-gray-400 mb-4"></app-icon>
        <h3 class="text-lg font-medium text-gray-900 mb-2">Sin dominios</h3>
        <p class="text-gray-500 mb-6">
          Aún no tienes dominios configurados para tu tienda.
        </p>
        <app-button variant="primary" (clicked)="openCreateModal()">
          <app-icon name="plus" [size]="16" class="mr-2"></app-icon>
          Crear primer dominio
        </app-button>
      </div>

      <!-- Domains Table -->
      <div *ngIf="!is_loading && domains.length > 0" class="bg-white rounded-lg border border-gray-200">
        <app-table
          [columns]="table_columns"
          [data]="domains"
          [actions]="table_actions"
          [loading]="is_loading"
        >
        </app-table>
      </div>

      <!-- Create/Edit Modal -->
      <app-modal
        [isOpen]="is_modal_open"
        [title]="is_editing ? 'Editar Dominio' : 'Nuevo Dominio'"
        size="md"
        (closed)="closeModal()"
      >
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Hostname <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              [(ngModel)]="form_data.hostname"
              [disabled]="is_editing"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="mi-tienda.vendix.com"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Tipo de Dominio
            </label>
            <select
              [(ngModel)]="form_data.domain_type"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="store">Tienda</option>
              <option value="ecommerce">E-commerce</option>
              <option value="organization">Organización</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Propiedad
            </label>
            <select
              [(ngModel)]="form_data.ownership"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="vendix_subdomain">Subdominio Vendix</option>
              <option value="custom_domain">Dominio Personalizado</option>
              <option value="custom_subdomain">Subdominio Personalizado</option>
            </select>
          </div>

          <div class="flex items-center">
            <input
              type="checkbox"
              id="is_primary"
              [(ngModel)]="form_data.is_primary"
              class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label for="is_primary" class="ml-2 block text-sm text-gray-900">
              Establecer como dominio principal
            </label>
          </div>
        </div>

        <!-- Modal Footer -->
        <div modal-footer class="flex justify-end space-x-3 mt-6 pt-4 border-t">
          <app-button variant="outline" (clicked)="closeModal()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            [loading]="is_saving"
            (clicked)="saveModal()"
          >
            {{ is_editing ? 'Actualizar' : 'Crear' }}
          </app-button>
        </div>
      </app-modal>

      <!-- Delete Confirmation Modal -->
      <app-modal
        [isOpen]="is_delete_modal_open"
        title="Eliminar Dominio"
        size="sm"
        (closed)="closeDeleteModal()"
      >
        <p class="text-gray-600">
          ¿Estás seguro de que deseas eliminar el dominio
          <strong>{{ domain_to_delete?.hostname }}</strong>?
        </p>
        <p class="text-red-500 text-sm mt-2">Esta acción no se puede deshacer.</p>

        <div modal-footer class="flex justify-end space-x-3 mt-6 pt-4 border-t">
          <app-button variant="outline" (clicked)="closeDeleteModal()">
            Cancelar
          </app-button>
          <app-button
            variant="danger"
            [loading]="is_deleting"
            (clicked)="confirmDelete()"
          >
            Eliminar
          </app-button>
        </div>
      </app-modal>
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
export class StoreDomainsComponent implements OnInit, OnDestroy {
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

  form_data: CreateStoreDomainDto = {
    hostname: '',
    domain_type: 'store',
    ownership: 'vendix_subdomain',
    is_primary: false,
    config: {},
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
  ) { }

  ngOnInit(): void {
    this.loadDomains();

    this.domains_service.is_loading$
      .pipe(takeUntil(this.destroy$))
      .subscribe((loading) => (this.is_loading = loading));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDomains(): void {
    this.domains_service
      .getDomains({ page: 1, limit: 50 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.domains = response.data;
          }
        },
        error: (error) => {
          this.toast_service.error('Error al cargar los dominios');
        },
      });
  }

  openCreateModal(): void {
    this.is_editing = false;
    this.editing_domain = null;
    this.form_data = {
      hostname: '',
      domain_type: 'store',
      ownership: 'vendix_subdomain',
      is_primary: false,
      config: {},
    };
    this.is_modal_open = true;
  }

  openEditModal(domain: StoreDomain): void {
    this.is_editing = true;
    this.editing_domain = domain;
    this.form_data = {
      hostname: domain.hostname,
      domain_type: domain.domain_type,
      ownership: domain.ownership,
      is_primary: domain.is_primary,
      config: domain.config || {},
    };
    this.is_modal_open = true;
  }

  closeModal(): void {
    this.is_modal_open = false;
    this.editing_domain = null;
  }

  saveModal(): void {
    if (!this.form_data.hostname) {
      this.toast_service.warning('El hostname es requerido');
      return;
    }

    this.is_saving = true;

    if (this.is_editing && this.editing_domain) {
      const update_dto: UpdateStoreDomainDto = {
        domain_type: this.form_data.domain_type,
        ownership: this.form_data.ownership,
        is_primary: this.form_data.is_primary,
        config: this.form_data.config,
      };

      this.domains_service
        .updateDomain(this.editing_domain.id, update_dto)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Dominio actualizado correctamente');
            this.closeModal();
            this.loadDomains();
            this.is_saving = false;
          },
          error: (error) => {
            this.toast_service.error('Error al actualizar el dominio');
            this.is_saving = false;
          },
        });
    } else {
      this.domains_service
        .createDomain(this.form_data)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Dominio creado correctamente');
            this.closeModal();
            this.loadDomains();
            this.is_saving = false;
          },
          error: (error) => {
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
          this.toast_service.error('Error al establecer dominio como principal');
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
