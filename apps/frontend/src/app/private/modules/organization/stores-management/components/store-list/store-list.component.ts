import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import {
  StoreListItem,
  StoreType,
  StoreState,
} from '../../interfaces/store.interface';
import { OrganizationStoresService } from '../../services/organization-stores.service';

// App shared components
import {
  IconComponent,
  ButtonComponent,
  CardComponent,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-store-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    // App shared components
    IconComponent,
    ButtonComponent,
    CardComponent,
  ],
  template: `
    <div
      class="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] overflow-hidden"
    >
      <!-- Table Header -->
      <div class="px-6 py-4 border-b border-border">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-medium text-[var(--color-text-primary)]">
            Tiendas ({{ pagination?.total || 0 }})
          </h3>
          <div class="flex items-center space-x-2">
            <span class="text-sm text-[var(--color-text-secondary)]">
              Mostrando {{ stores.length || 0 }} de
              {{ pagination?.total || 0 }} tiendas
            </span>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div
        *ngIf="!stores || stores.length === 0"
        class="px-6 py-12 text-center"
      >
        <app-card class="max-w-md mx-auto text-center p-8">
          <app-icon
            name="building"
            [size]="48"
            color="var(--color-text-tertiary)"
            class="mb-4"
          />
          <h3
            class="text-lg font-semibold text-[var(--color-text-primary)] mb-2"
          >
            No se encontraron tiendas
          </h3>
          <p class="text-[var(--color-text-secondary)] mb-6">
            Comienza creando tu primera tienda para administrar tu inventario y
            ventas
          </p>
          <app-button (click)="createStore.emit()" variant="primary" size="lg">
            <app-icon name="plus" [size]="16" class="mr-2" />
            Crear Tienda
          </app-button>
        </app-card>
      </div>

      <!-- Table -->
      <div *ngIf="stores && stores.length > 0" class="overflow-x-auto">
        <table class="min-w-full divide-y divide-border">
          <thead class="bg-[var(--color-background)]">
            <tr>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider cursor-pointer"
                (click)="sortBy('name')"
              >
                <div class="flex items-center space-x-1">
                  <span>Nombre</span>
                  <app-icon
                    *ngIf="sortColumn === 'name'"
                    name="chevron-up"
                    [size]="16"
                    [style.transform]="
                      sortDirection === 'desc' ? 'rotate(180deg)' : 'none'
                    "
                  />
                </div>
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider"
              >
                Código
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider cursor-pointer"
                (click)="sortBy('store_type')"
              >
                <div class="flex items-center space-x-1">
                  <span>Tipo</span>
                  <app-icon
                    *ngIf="sortColumn === 'store_type'"
                    name="chevron-up"
                    [size]="16"
                    [style.transform]="
                      sortDirection === 'desc' ? 'rotate(180deg)' : 'none'
                    "
                  />
                </div>
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider"
              >
                Dirección
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider"
              >
                Productos
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider"
              >
                Usuarios
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider cursor-pointer"
                (click)="sortBy('is_active')"
              >
                <div class="flex items-center space-x-1">
                  <span>Estado</span>
                  <app-icon
                    *ngIf="sortColumn === 'is_active'"
                    name="chevron-up"
                    [size]="16"
                    [style.transform]="
                      sortDirection === 'desc' ? 'rotate(180deg)' : 'none'
                    "
                  />
                </div>
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider"
              >
                Creado
              </th>
              <th
                class="px-6 py-3 text-right text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider"
              >
                Acciones
              </th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-border">
            <tr
              *ngFor="let store of stores"
              class="hover:bg-[var(--color-background)]"
            >
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center">
                  <div class="flex-shrink-0 h-10 w-10">
                    <div
                      *ngIf="store.logo_url"
                      class="h-10 w-10 rounded-full overflow-hidden"
                    >
                      <img
                        [src]="store.logo_url"
                        [alt]="store.name"
                        class="h-full w-full object-cover"
                      />
                    </div>
                    <div
                      *ngIf="!store.logo_url"
                      class="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center"
                    >
                      <svg
                        class="w-6 h-6 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                        ></path>
                      </svg>
                    </div>
                  </div>
                  <div class="ml-4">
                    <div class="text-sm font-medium text-gray-900">
                      {{ store.name }}
                    </div>
                    <div class="text-sm text-gray-500">
                      {{ store.slug }}
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                <span class="font-mono">{{ store.store_code || 'N/A' }}</span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span
                  class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full"
                  [class]="getStoreTypeClass(store.store_type)"
                >
                  {{ getStoreTypeLabel(store.store_type) }}
                </span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <div *ngIf="store.addresses && store.addresses.length > 0">
                  {{ store.addresses[0].city }},
                  {{ store.addresses[0].country_code }}
                </div>
                <div
                  *ngIf="!store.addresses || store.addresses.length === 0"
                  class="text-gray-400"
                >
                  Sin dirección
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {{ store._count.products || 0 }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {{ store._count.store_users || 0 }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span
                  class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full"
                  [class]="
                    store.is_active
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  "
                >
                  {{ store.is_active ? 'Activa' : 'Inactiva' }}
                </span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {{ formatDate(store.created_at) }}
              </td>
              <td
                class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium"
              >
                <div class="flex items-center justify-end space-x-2">
                  <button
                    (click)="viewStore.emit(store)"
                    class="text-blue-600 hover:text-blue-900"
                    title="Ver detalles"
                  >
                    <svg
                      class="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      ></path>
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      ></path>
                    </svg>
                  </button>
                  <button
                    (click)="editStore.emit(store)"
                    class="text-indigo-600 hover:text-indigo-900"
                    title="Editar tienda"
                  >
                    <svg
                      class="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      ></path>
                    </svg>
                  </button>
                  <button
                    (click)="toggleStoreStatus(store)"
                    [class]="
                      store.is_active
                        ? 'text-orange-600 hover:text-orange-900'
                        : 'text-green-600 hover:text-green-900'
                    "
                    [title]="
                      store.is_active ? 'Desactivar tienda' : 'Activar tienda'
                    "
                  >
                    <svg
                      *ngIf="store.is_active"
                      class="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                      ></path>
                    </svg>
                    <svg
                      *ngIf="!store.is_active"
                      class="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      ></path>
                    </svg>
                  </button>
                  <button
                    (click)="deleteStore.emit(store)"
                    class="text-red-600 hover:text-red-900"
                    title="Eliminar tienda"
                  >
                    <svg
                      class="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      ></path>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div
        *ngIf="pagination && pagination.total_pages > 1"
        class="px-6 py-4 border-t border-gray-200 bg-gray-50"
      >
        <div class="flex items-center justify-between">
          <div class="text-sm text-gray-700">
            Mostrando
            <span class="font-medium">{{
              (pagination.page - 1) * pagination.limit + 1
            }}</span>
            a
            <span class="font-medium">{{ getPaginationEnd() }}</span>
            de
            <span class="font-medium">{{ pagination.total }}</span>
            resultados
          </div>
          <div class="flex items-center space-x-2">
            <button
              (click)="pageChange.emit(pagination.page - 1)"
              [disabled]="pagination.page <= 1"
              class="px-3 py-1 text-sm border rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <span class="text-sm text-gray-700">
              Página {{ pagination.page }} de {{ pagination.total_pages }}
            </span>
            <button
              (click)="pageChange.emit(pagination.page + 1)"
              [disabled]="pagination.page >= pagination.total_pages"
              class="px-3 py-1 text-sm border rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StoreListComponent implements OnInit, OnDestroy {
  @Input() stores: StoreListItem[] = [];
  @Input() loading = false;
  @Input() pagination?: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };

  @Output() createStore = new EventEmitter<void>();
  @Output() viewStore = new EventEmitter<StoreListItem>();
  @Output() editStore = new EventEmitter<StoreListItem>();
  @Output() deleteStore = new EventEmitter<StoreListItem>();
  @Output() pageChange = new EventEmitter<number>();
  @Output() sortChange = new EventEmitter<{
    column: string;
    direction: 'asc' | 'desc';
  }>();

  sortColumn = '';
  sortDirection: 'asc' | 'desc' = 'asc';

  private destroy$ = new Subject<void>();

  constructor(private storesService: OrganizationStoresService) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  sortBy(column: string): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }

    this.sortChange.emit({ column, direction: this.sortDirection });
  }

  toggleStoreStatus(store: StoreListItem): void {
    if (store.is_active) {
      this.storesService.deactivateStore(store.id).subscribe({
        next: () => {
          // Update store in local array
          const index = this.stores.findIndex((s) => s.id === store.id);
          if (index !== -1) {
            this.stores[index] = { ...store, is_active: false };
          }
        },
        error: (error) => {
          console.error('Error deactivating store:', error);
        },
      });
    } else {
      this.storesService.activateStore(store.id).subscribe({
        next: () => {
          // Update store in local array
          const index = this.stores.findIndex((s) => s.id === store.id);
          if (index !== -1) {
            this.stores[index] = { ...store, is_active: true };
          }
        },
        error: (error) => {
          console.error('Error activating store:', error);
        },
      });
    }
  }

  getStoreTypeLabel(type: StoreType): string {
    const typeLabels = {
      [StoreType.PHYSICAL]: 'Física',
      [StoreType.ONLINE]: 'Online',
      [StoreType.HYBRID]: 'Híbrida',
      [StoreType.POPUP]: 'Popup',
      [StoreType.KIOSKO]: 'Kiosko',
    };
    return typeLabels[type] || type;
  }

  getStoreTypeClass(type: StoreType): string {
    const typeClasses = {
      [StoreType.PHYSICAL]: 'bg-blue-100 text-blue-800',
      [StoreType.ONLINE]: 'bg-purple-100 text-purple-800',
      [StoreType.HYBRID]: 'bg-green-100 text-green-800',
      [StoreType.POPUP]: 'bg-yellow-100 text-yellow-800',
      [StoreType.KIOSKO]: 'bg-pink-100 text-pink-800',
    };
    return typeClasses[type] || 'bg-gray-100 text-gray-800';
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  getPaginationEnd(): number {
    if (!this.pagination) return 0;
    return Math.min(
      this.pagination.page * this.pagination.limit,
      this.pagination.total,
    );
  }
}
