import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  ResponsiveDataViewComponent,
  InputsearchComponent,
  OptionsDropdownComponent,
  IconComponent,
  ButtonComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  FilterConfig,
  FilterValues,
  DropdownAction,
  CardComponent,
} from '../../../../../../shared/components';
import { StoreRole } from '../interfaces/store-role.interface';

@Component({
  selector: 'app-store-roles-list',
  standalone: true,
  imports: [
    CommonModule,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    IconComponent,
    ButtonComponent,
    CardComponent,
  ],
  template: `
    <app-card [responsive]="true" [padding]="false">
      <!-- Search Section: sticky below stats on mobile -->
      <div
        class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                  md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
      >
        <div
          class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
        >
          <!-- Title -->
          <h2
            class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
          >
            Roles
            <span class="text-text-secondary font-normal">
              ({{ totalCount }})
            </span>
          </h2>

          <!-- Search + Actions Row -->
          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              size="sm"
              placeholder="Buscar roles..."
              [debounceTime]="300"
              (search)="onSearch($event)"
            ></app-inputsearch>

            <app-button
              variant="outline"
              size="sm"
              customClasses="w-9 h-9 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
              (clicked)="create.emit()"
              title="Nuevo Rol"
            >
              <app-icon slot="icon" name="plus" [size]="18"></app-icon>
            </app-button>

            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [filters]="filterConfigs"
              [filterValues]="filterValues"
              [actions]="dropdownActions"
              [isLoading]="loading"
              (filterChange)="onFilterChange($event)"
              (clearAllFilters)="onClearFilters()"
              (actionClick)="onActionClick($event)"
            ></app-options-dropdown>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="loading" class="p-4 md:p-6 text-center">
        <div
          class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
        ></div>
        <p class="mt-2 text-text-secondary">Cargando roles...</p>
      </div>

      <!-- Empty State -->
      <div
        *ngIf="!loading && roles.length === 0"
        class="p-12 text-center text-gray-500"
      >
        <app-icon
          name="shield"
          [size]="48"
          class="mx-auto mb-4 text-gray-300"
        ></app-icon>
        <h3 class="text-lg font-medium text-gray-900">
          No se encontraron roles
        </h3>
        <p class="mt-1">Comienza creando un nuevo rol personalizado.</p>
        <div class="mt-6 flex justify-center">
          <app-button variant="primary" (clicked)="create.emit()">
            <app-icon slot="icon" name="plus" [size]="16"></app-icon>
            Nuevo Rol
          </app-button>
        </div>
      </div>

      <!-- Data View -->
      <div *ngIf="!loading && roles.length > 0" class="px-2 pb-2 pt-3 md:p-4">
        <app-responsive-data-view
          [data]="roles"
          [columns]="columns"
          [cardConfig]="cardConfig"
          [actions]="tableActions"
          [loading]="loading"
          [hoverable]="true"
          [striped]="true"
          emptyMessage="No hay roles"
          emptyIcon="shield"
          tableSize="md"
          (sort)="onSortChange($event)"
        ></app-responsive-data-view>
      </div>
    </app-card>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class StoreRolesListComponent {
  @Input() roles: StoreRole[] = [];
  @Input() loading = false;
  @Input() totalCount = 0;

  @Output() create = new EventEmitter<void>();
  @Output() edit = new EventEmitter<StoreRole>();
  @Output() managePermissions = new EventEmitter<StoreRole>();
  @Output() delete = new EventEmitter<StoreRole>();
  @Output() searchChange = new EventEmitter<string>();
  @Output() filterChange = new EventEmitter<Record<string, string>>();
  @Output() sort = new EventEmitter<{
    column: string;
    direction: 'asc' | 'desc' | null;
  }>();

  searchTerm = '';
  filterValues: FilterValues = {};

  // ── Filter Configs ──────────────────────────────────────────────────

  filterConfigs: FilterConfig[] = [
    {
      key: 'type',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'system', label: 'Sistema' },
        { value: 'custom', label: 'Personalizado' },
      ],
    },
  ];

  dropdownActions: DropdownAction[] = [
    {
      label: 'Nuevo Rol',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  // ── Table Columns ───────────────────────────────────────────────────

  columns: TableColumn[] = [
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      priority: 1,
    },
    {
      key: 'description',
      label: 'Descripcion',
      priority: 2,
    },
    {
      key: 'system_role',
      label: 'Tipo',
      sortable: true,
      priority: 1,
      badge: true,
      transform: (value: boolean) => (value ? 'Sistema' : 'Personalizado'),
    },
    {
      key: '_count.user_roles',
      label: 'Usuarios',
      priority: 2,
      transform: (value: any, item: any) =>
        String(item?._count?.user_roles || 0),
    },
    {
      key: 'permissions',
      label: 'Permisos',
      priority: 3,
      transform: (value: any) =>
        String(Array.isArray(value) ? value.length : 0),
    },
  ];

  // ── Card Config (Mobile) ────────────────────────────────────────────

  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'description',
    subtitleTransform: (value: any) => value || 'Sin descripcion',
    avatarFallbackIcon: 'shield',
    avatarShape: 'square',
    badgeKey: 'system_role',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: boolean) => (value ? 'Sistema' : 'Personalizado'),
    detailKeys: [
      {
        key: '_count',
        label: 'Usuarios',
        icon: 'users',
        transform: (v: any) => v?.user_roles || 0,
      },
      {
        key: 'permissions',
        label: 'Permisos',
        icon: 'key',
        transform: (v: any) => (Array.isArray(v) ? v.length : 0),
      },
    ],
  };

  // ── Table Actions ───────────────────────────────────────────────────

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'ghost',
      action: (row: StoreRole) => this.edit.emit(row),
      show: (row: StoreRole) => !row.system_role,
    },
    {
      label: 'Permisos',
      icon: 'key',
      variant: 'ghost',
      action: (row: StoreRole) => this.managePermissions.emit(row),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (row: StoreRole) => this.delete.emit(row),
      show: (row: StoreRole) => !row.system_role,
    },
  ];

  // ── Event Handlers ──────────────────────────────────────────────────

  onSearch(term: string): void {
    this.searchTerm = term;
    this.searchChange.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = { ...values };
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(values)) {
      result[key] = (val as string) || '';
    }
    this.filterChange.emit(result);
  }

  onClearFilters(): void {
    this.filterValues = {};
    this.filterChange.emit({ type: '' });
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.create.emit();
    }
  }

  onSortChange(event: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    this.sort.emit(event);
  }
}
