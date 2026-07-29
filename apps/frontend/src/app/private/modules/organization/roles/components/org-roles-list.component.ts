import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Role } from '../interfaces/role.interface';
import {
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  TableAction,
  TableColumn,
} from '../../../../../shared/components/index';
import {
  ROLE_SCOPE_COLOR_MAP,
  ROLE_SCOPE_FILTER_OPTIONS,
  canEditRoleScope,
  getRoleReadOnlyReason,
  getRoleScopeLabel,
} from '../../../../../shared/constants/role-scope.constant';

@Component({
  selector: 'app-org-roles-list',
  standalone: true,
  imports: [
    FormsModule,
    CardComponent,
    EmptyStateComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <app-card
      [responsive]="true"
      [padding]="false"
      overflow="visible"
      customClasses="md:min-h-[600px]"
    >
      <div
        class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
               md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
      >
        <div
          class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
        >
          <h2
            class="text-[13px] font-semibold text-text-secondary tracking-wide
                   md:text-lg md:font-semibold md:text-text-primary md:tracking-normal"
          >
            Roles
            <span
              class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary"
            >
              ({{ totalCount() }})
            </span>
          </h2>

          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              size="sm"
              placeholder="Buscar roles..."
              [debounceTime]="300"
              [ngModel]="searchTerm()"
              (ngModelChange)="searchTerm.set($event)"
              (searchChange)="onSearch($event)"
            ></app-inputsearch>

            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [filters]="filterConfigs"
              [filterValues]="filterValues()"
              [actions]="dropdownActions"
              [isLoading]="loading()"
              triggerIcon="filter"
              (filterChange)="onFilterChange($event)"
              (clearAllFilters)="clearFilters()"
              (actionClick)="onActionClick($event)"
            ></app-options-dropdown>
          </div>
        </div>
      </div>

      @if (loading()) {
        <div class="p-4 md:p-6 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary">Cargando roles...</p>
        </div>
      }

      @if (!loading() && roles().length === 0) {
        <app-empty-state
          icon="shield"
          [title]="getEmptyStateTitle()"
          [description]="getEmptyStateDescription()"
          actionButtonText="Crear Primer Rol"
          [showActionButton]="!hasFilters()"
          [showRefreshButton]="true"
          [showClearFilters]="hasFilters()"
          (actionClick)="create.emit()"
          (refreshClick)="refresh.emit()"
          (clearFiltersClick)="clearFilters()"
        ></app-empty-state>
      }

      @if (!loading() && roles().length > 0) {
        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="roles()"
            [columns]="tableColumns"
            [actions]="tableActions"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            [hoverable]="true"
            [striped]="true"
            emptyMessage="No hay roles"
            emptyIcon="shield"
            tableSize="md"
            (sort)="sort.emit($event)"
          ></app-responsive-data-view>
        </div>
      }
    </app-card>
  `,
})
export class OrgRolesListComponent {
  readonly roles = input<Role[]>([]);
  readonly loading = input(false);
  readonly totalCount = input(0);

  readonly create = output<void>();
  readonly edit = output<Role>();
  readonly managePermissions = output<Role>();
  readonly delete = output<Role>();
  readonly refresh = output<void>();
  readonly searchChange = output<string>();
  readonly filterChange = output<Record<string, string>>();
  readonly sort = output<{
    column: string;
    direction: 'asc' | 'desc' | null;
  }>();

  readonly searchTerm = signal('');
  readonly selectedScope = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly hasFilters = computed(
    () => !!(this.searchTerm() || this.selectedScope()),
  );

  /**
   * QUI-72 — el filtro pasa de "Sistema / Personalizado" a los TRES alcances.
   * Las opciones vienen del contrato compartido para que los tres niveles
   * (superadmin, organización, tienda) filtren exactamente igual.
   */
  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'scope',
      label: 'Alcance',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        ...ROLE_SCOPE_FILTER_OPTIONS.map((option) => ({
          value: option.value as string,
          label: option.label,
        })),
      ],
    },
  ];

  readonly dropdownActions: DropdownAction[] = [
    {
      label: 'Nuevo Rol',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
    {
      label: 'Actualizar',
      icon: 'refresh',
      action: 'refresh',
      variant: 'outline',
    },
  ];

  readonly tableColumns: TableColumn[] = [
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      priority: 1,
    },
    {
      key: 'description',
      label: 'Descripción',
      sortable: true,
      priority: 2,
      transform: (value: string) => value || 'Sin descripción',
    },
    {
      // El `colorMap` resuelve contra el valor CRUDO de la celda, así que la
      // clave DEBE ser `scope` ('system' | 'organization' | 'store') y los
      // colores hex de 7 caracteres: `table`/`item-list` derivan fondo y borde
      // concatenando alfa (`${color}26` / `${color}40`).
      key: 'scope',
      label: 'Alcance',
      sortable: true,
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: ROLE_SCOPE_COLOR_MAP,
      },
      transform: (value: string) => getRoleScopeLabel(value as never),
    },
    {
      key: 'store_name',
      label: 'Tienda',
      sortable: true,
      priority: 2,
      // `app-table` sólo corre `transform` cuando la celda no está vacía, así
      // que los roles sin tienda caen en `defaultValue`.
      defaultValue: '—',
    },
    {
      key: '_count.user_roles',
      label: 'Usuarios',
      sortable: true,
      defaultValue: '0',
      priority: 3,
    },
    {
      key: 'permissions',
      label: 'Permisos',
      sortable: false,
      priority: 3,
      transform: (permissions: string[]) =>
        Array.isArray(permissions) && permissions.length > 0
          ? `${permissions.length} permisos`
          : 'Sin permisos',
    },
    {
      key: 'created_at',
      label: 'Fecha Creación',
      sortable: true,
      priority: 3,
      transform: (value: string) => this.formatDate(value),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'description',
    subtitleTransform: (role: Role) => role.description || 'Sin descripción',
    avatarFallbackIcon: 'shield',
    avatarShape: 'square',
    badgeKey: 'scope',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: ROLE_SCOPE_COLOR_MAP,
    },
    badgeTransform: (value: string) => getRoleScopeLabel(value as never),
    detailKeys: [
      {
        // `badgeTransform` sólo recibe el valor, nunca la fila, así que la
        // tienda del rol de alcance TIENDA se muestra en su propio detalle
        // (`item-list` ya resuelve el nulo a '-' sin llamar al transform).
        key: 'store_name',
        label: 'Tienda',
        icon: 'store',
        transform: (value: string) => value || '—',
      },
      {
        key: '_count.user_roles',
        label: 'Usuarios',
        icon: 'users',
        transform: (value: number) => String(value || 0),
      },
      {
        key: 'permissions',
        label: 'Permisos',
        icon: 'key',
        transform: (value: string[]) =>
          String(Array.isArray(value) ? value.length : 0),
      },
      {
        key: 'created_at',
        label: 'Fecha',
        transform: (value: string) => this.formatDate(value),
      },
    ],
  };

  /**
   * QUI-72 — las acciones se derivan de `canEditRoleScope(scope, 'organization')`,
   * no de `system_role`. Es un espejo de la matriz del backend para OCULTAR
   * acciones imposibles; la autorización real sigue siendo el 403 tipado.
   *
   * "Detalle" queda visible siempre (un rol de sistema se puede consultar y ver
   * sus usuarios); editar, permisos y eliminar se bloquean con el motivo exacto
   * del contrato compartido en el tooltip.
   */
  readonly tableActions: TableAction[] = [
    {
      label: (role: Role) => (this.canEdit(role) ? 'Editar' : 'Ver detalle'),
      icon: (role: Role) => (this.canEdit(role) ? 'edit' : 'eye'),
      action: (role: Role) => this.edit.emit(role),
      variant: 'info',
      tooltip: (role: Role) =>
        this.readOnlyReason(role) ?? 'Editar rol y administrar sus usuarios',
    },
    {
      label: 'Permisos',
      icon: 'key',
      action: (role: Role) => this.managePermissions.emit(role),
      variant: 'ghost',
      disabled: (role: Role) => !this.canEdit(role),
      tooltip: (role: Role) =>
        this.readOnlyReason(role) ?? 'Administrar permisos del rol',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (role: Role) => this.delete.emit(role),
      variant: 'danger',
      disabled: (role: Role) => (role._count?.user_roles ?? 0) > 0,
      show: (role: Role) => this.canEdit(role),
      tooltip: (role: Role) =>
        (role._count?.user_roles ?? 0) > 0
          ? 'No se puede eliminar un rol con usuarios asignados'
          : 'Eliminar rol',
    },
  ];

  canEdit(role: Role): boolean {
    return canEditRoleScope(role?.scope, 'organization');
  }

  readOnlyReason(role: Role): string | null {
    return getRoleReadOnlyReason(role?.scope, 'organization');
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.searchChange.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
    const scope = typeof values['scope'] === 'string' ? values['scope'] : '';
    this.selectedScope.set(scope);
    this.filterChange.emit({ scope });
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.selectedScope.set('');
    this.filterValues.set({});
    this.searchChange.emit('');
    this.filterChange.emit({ scope: '' });
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.create.emit();
      return;
    }

    if (action === 'refresh') {
      this.refresh.emit();
    }
  }

  getEmptyStateTitle(): string {
    return this.hasFilters()
      ? 'No hay roles que coincidan'
      : 'No se encontraron roles';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters()
      ? 'Intenta ajustar la búsqueda o los filtros'
      : 'Comienza creando tu primer rol personalizado.';
  }

  private formatDate(dateString?: string): string {
    if (!dateString) return '-';

    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
