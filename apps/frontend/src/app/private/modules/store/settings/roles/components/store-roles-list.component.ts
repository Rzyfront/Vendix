import { Component, input, output, signal } from '@angular/core';

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
import {
  ROLE_SCOPE_COLOR_MAP,
  ROLE_SCOPE_FILTER_OPTIONS,
  canEditRoleScope,
  getRoleReadOnlyReason,
  getRoleScopeLabel,
} from '../../../../../../shared/constants/role-scope.constant';
import { StoreRole } from '../interfaces/store-role.interface';

/** Este listado siempre habla desde el nivel tienda. */
const ACTOR_LEVEL = 'store' as const;

@Component({
  selector: 'app-store-roles-list',
  standalone: true,
  imports: [
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    IconComponent,
    ButtonComponent,
    CardComponent,
  ],
  template: `
    <app-card [responsive]="true" [padding]="false" overflow="visible">
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
              ({{ totalCount() }})
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

            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [filters]="filterConfigs"
              [filterValues]="filterValues()"
              [actions]="dropdownActions"
              [isLoading]="loading()"
              (filterChange)="onFilterChange($event)"
              (clearAllFilters)="onClearFilters()"
              (actionClick)="onActionClick($event)"
            ></app-options-dropdown>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      @if (loading()) {
        <div class="p-4 md:p-6 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary">Cargando roles...</p>
        </div>
      }

      <!-- Empty State -->
      @if (!loading() && roles().length === 0) {
        <div class="p-12 text-center text-gray-500">
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
      }

      <!-- Data View -->
      @if (!loading() && roles().length > 0) {
        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="roles()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [actions]="tableActions"
            [loading]="loading()"
            [hoverable]="true"
            [striped]="true"
            emptyMessage="No hay roles"
            emptyIcon="shield"
            tableSize="md"
            (sort)="onSortChange($event)"
          ></app-responsive-data-view>
        </div>
      }
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
  readonly roles = input<StoreRole[]>([]);
  readonly loading = input<boolean>(false);
  readonly totalCount = input<number>(0);

  readonly create = output<void>();
  readonly edit = output<StoreRole>();
  readonly manageUsers = output<StoreRole>();
  readonly managePermissions = output<StoreRole>();
  readonly delete = output<StoreRole>();
  readonly searchChange = output<string>();
  readonly filterChange = output<Record<string, string>>();
  readonly sort = output<{
    column: string;
    direction: 'asc' | 'desc' | null;
  }>();

  /** Estado de UI leído por la plantilla ⇒ signal (zoneless). */
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});

  // ── Filter Configs ──────────────────────────────────────────────────

  /**
   * Filtro por ALCANCE (QUI-72). Sustituye al binario Sistema/Personalizado,
   * que ocultaba la diferencia entre un rol heredado de la organización y uno
   * propio de la tienda — justo la distinción que decide si es editable.
   */
  filterConfigs: FilterConfig[] = [
    {
      key: 'scope',
      label: 'Alcance',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        ...ROLE_SCOPE_FILTER_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        })),
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
      // `colorMap` se resuelve contra el valor CRUDO de la columna, por eso la
      // clave es `scope` y no una etiqueta ya traducida.
      key: 'scope',
      label: 'Alcance',
      sortable: true,
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: ROLE_SCOPE_COLOR_MAP,
        size: 'sm',
      },
      transform: (value: any) => getRoleScopeLabel(value),
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
    badgeKey: 'scope',
    badgeConfig: {
      type: 'custom',
      colorMap: ROLE_SCOPE_COLOR_MAP,
      size: 'sm',
    },
    badgeTransform: (value: any) => getRoleScopeLabel(value),
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

  /**
   * QUI-72 — Sólo `scope === 'store'` es gestionable desde este nivel.
   * `canEditRoleScope` es el espejo de la matriz del backend; se usa para NO
   * ofrecer la acción, no para autorizar (eso lo hace el 403 tipado).
   */
  isManageable(row: StoreRole): boolean {
    return canEditRoleScope(row?.scope, ACTOR_LEVEL);
  }

  readOnlyReason(row: StoreRole): string {
    return getRoleReadOnlyReason(row?.scope, ACTOR_LEVEL) ?? '';
  }

  tableActions: TableAction[] = [
    {
      // Se deshabilita en vez de ocultarse: el tooltip explica POR QUÉ este rol
      // no se toca aquí, que es la información que faltaba.
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (row: StoreRole) => {
        if (!this.isManageable(row)) return;
        this.edit.emit(row);
      },
      disabled: (row: StoreRole) => !this.isManageable(row),
      tooltip: (row: StoreRole) =>
        this.isManageable(row) ? 'Editar rol' : this.readOnlyReason(row),
    },
    {
      label: 'Usuarios',
      icon: 'users',
      variant: 'ghost',
      action: (row: StoreRole) => this.manageUsers.emit(row),
      tooltip: (row: StoreRole) =>
        this.isManageable(row)
          ? 'Ver y administrar los usuarios con este rol'
          : 'Ver los usuarios con este rol (sólo lectura)',
    },
    {
      // Los permisos de un rol heredado también son sólo lectura (el backend
      // aplica la misma matriz en assign/removePermissions).
      label: 'Permisos',
      icon: 'key',
      variant: 'ghost',
      action: (row: StoreRole) => this.managePermissions.emit(row),
      tooltip: (row: StoreRole) =>
        this.isManageable(row)
          ? 'Configurar permisos'
          : 'Ver permisos (sólo lectura)',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (row: StoreRole) => {
        if (!this.isManageable(row)) return;
        this.delete.emit(row);
      },
      disabled: (row: StoreRole) => !this.isManageable(row),
      tooltip: (row: StoreRole) =>
        this.isManageable(row) ? 'Eliminar rol' : this.readOnlyReason(row),
    },
  ];

  // ── Event Handlers ──────────────────────────────────────────────────

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.searchChange.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(values)) {
      result[key] = (val as string) || '';
    }
    this.filterChange.emit(result);
  }

  onClearFilters(): void {
    this.filterValues.set({});
    this.filterChange.emit({ scope: '' });
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
