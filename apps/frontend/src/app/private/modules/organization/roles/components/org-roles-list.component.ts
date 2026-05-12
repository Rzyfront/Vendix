import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Role } from '../interfaces/role.interface';
import {
  ButtonComponent,
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  TableAction,
  TableColumn,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-org-roles-list',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <app-card
      [responsive]="true"
      [padding]="false"
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

            <app-button
              variant="outline"
              size="md"
              customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
              (clicked)="create.emit()"
              title="Nuevo Rol"
            >
              <app-icon slot="icon" name="plus" [size]="18"></app-icon>
            </app-button>

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
  readonly selectedType = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly hasFilters = computed(
    () => !!(this.searchTerm() || this.selectedType()),
  );

  readonly filterConfigs: FilterConfig[] = [
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
      key: 'system_role',
      label: 'Tipo',
      sortable: true,
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          true: '#3b82f6',
          false: '#10b981',
        },
      },
      transform: (value: boolean) => (value ? 'Sistema' : 'Personalizado'),
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
    badgeKey: 'system_role',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        true: '#3b82f6',
        false: '#10b981',
      },
    },
    badgeTransform: (value: boolean) => (value ? 'Sistema' : 'Personalizado'),
    detailKeys: [
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

  readonly tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (role: Role) => this.edit.emit(role),
      variant: 'info',
      show: (role: Role) => !role.system_role,
    },
    {
      label: 'Permisos',
      icon: 'key',
      action: (role: Role) => this.managePermissions.emit(role),
      variant: 'ghost',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (role: Role) => this.delete.emit(role),
      variant: 'danger',
      disabled: (role: Role) =>
        role.system_role || (role._count?.user_roles ?? 0) > 0,
      show: (role: Role) => !role.system_role,
    },
  ];

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.searchChange.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
    const type = typeof values['type'] === 'string' ? values['type'] : '';
    this.selectedType.set(type);
    this.filterChange.emit({ type });
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.selectedType.set('');
    this.filterValues.set({});
    this.searchChange.emit('');
    this.filterChange.emit({ type: '' });
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
