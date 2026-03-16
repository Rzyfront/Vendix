import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { InputsearchComponent } from '../../../../../shared/components/inputsearch/inputsearch.component';
import { ResponsiveDataViewComponent } from '../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { TableColumn, TableAction } from '../../../../../shared/components/table/table.component';
import { ItemListCardConfig } from '../../../../../shared/components/item-list/item-list.interfaces';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { OptionsDropdownComponent } from '../../../../../shared/components/options-dropdown/options-dropdown.component';
import { FilterConfig, FilterValues } from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  StoreUserCreateModalComponent,
  StoreUserEditModalComponent,
} from './components/index';
import * as StoreUsersActions from './state/actions/store-users.actions';
import {
  selectUsers,
  selectUsersLoading,
  selectStats,
} from './state/selectors/store-users.selectors';
import { StoreUser, StoreUserState } from './interfaces/store-user.interface';

@Component({
  selector: 'app-store-users-settings',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
    IconComponent,
    OptionsDropdownComponent,
    StoreUserCreateModalComponent,
    StoreUserEditModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Cards -->
      <div
        class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Usuarios"
          [value]="stats()?.total ?? 0"
          smallText="en la tienda"
          iconName="users"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
        ></app-stats>
        <app-stats
          title="Activos"
          [value]="stats()?.activos ?? 0"
          [smallText]="getPercentText(stats()?.activos ?? 0)"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Inactivos"
          [value]="stats()?.inactivos ?? 0"
          [smallText]="getPercentText(stats()?.inactivos ?? 0)"
          iconName="user-x"
          iconBgColor="bg-gray-100"
          iconColor="text-gray-600"
        ></app-stats>
        <app-stats
          title="Pendientes"
          [value]="stats()?.pendientes ?? 0"
          [smallText]="getPercentText(stats()?.pendientes ?? 0)"
          iconName="clock"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>
      </div>

      <!-- Data Table -->
      <div
        class="md:bg-surface md:rounded-xl md:shadow-[0_2px_8px_rgba(0,0,0,0.07)]
               md:border md:border-border"
      >
        <!-- Search Section -->
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
              Usuarios ({{ users().length }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar usuarios..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              />
              <app-options-dropdown
                [filters]="stateFilterConfigs"
                [filterValues]="filterValues"
                (filterChange)="onFilterChange($event)"
              />
              <app-button
                variant="outline"
                size="sm"
                customClasses="w-9 h-9 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                (clicked)="openCreateModal()"
                title="Nuevo Usuario"
              >
                <app-icon slot="icon" name="plus" [size]="18"></app-icon>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p class="mt-2 text-text-secondary">Cargando usuarios...</p>
          </div>
        }

        <!-- Data View -->
        @if (!loading()) {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="users()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="actions"
              [loading]="loading()"
              emptyMessage="No hay usuarios registrados"
              emptyIcon="users"
            />
          </div>
        }
      </div>
    </div>

    <!-- Create Modal -->
    <app-store-user-create-modal
      [(isOpen)]="showCreateModal"
      (onUserCreated)="onUserCreated()"
    />

    <!-- Edit Modal -->
    @if (editingUser()) {
      <app-store-user-edit-modal
        [user]="editingUser()!"
        [(isOpen)]="showEditModal"
        (onUserUpdated)="onUserUpdated()"
      />
    }
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
export class StoreUsersSettingsComponent implements OnInit {
  private store = inject(Store);
  private dialogService = inject(DialogService);

  users = this.store.selectSignal(selectUsers);
  loading = this.store.selectSignal(selectUsersLoading);
  stats = this.store.selectSignal(selectStats);

  showCreateModal = false;
  showEditModal = false;
  editingUser = signal<StoreUser | null>(null);

  filterValues: FilterValues = { state: null };

  stateFilterConfigs: FilterConfig[] = [
    {
      key: 'state',
      label: 'Estado',
      type: 'select',
      placeholder: 'Todos',
      options: [
        { value: StoreUserState.ACTIVE, label: 'Activos' },
        { value: StoreUserState.INACTIVE, label: 'Inactivos' },
        { value: StoreUserState.PENDING_VERIFICATION, label: 'Pendientes' },
        { value: StoreUserState.SUSPENDED, label: 'Suspendidos' },
      ],
    },
  ];

  columns: TableColumn[] = [
    {
      key: 'first_name',
      label: 'Nombre',
      sortable: true,
      transform: (_val: any, row: any) => `${row.first_name} ${row.last_name}`,
    },
    { key: 'email', label: 'Email', sortable: true },
    {
      key: 'state',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          Activo: 'green',
          Inactivo: 'gray',
          Pendiente: 'yellow',
          Suspendido: 'orange',
          Archivado: 'red',
        },
      },
      transform: (val: any) => this.getStateLabel(val),
    },
    {
      key: 'created_at',
      label: 'Creado',
      sortable: true,
      priority: 3,
      transform: (val: any) => new Date(val).toLocaleDateString('es-CO'),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'first_name',
    titleTransform: (item: StoreUser) => `${item.first_name} ${item.last_name}`,
    subtitleKey: 'email',
    badgeKey: 'state',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        Activo: '#22c55e',
        Inactivo: '#9ca3af',
        Pendiente: '#eab308',
        Suspendido: '#f97316',
      },
    },
    badgeTransform: (val: any) => this.getStateLabel(val),
    footerKey: 'state',
    footerLabel: 'Estado',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.getStateLabel(val),
    detailKeys: [
      {
        key: 'created_at',
        label: 'Creado',
        icon: 'calendar',
        transform: (val: any) => new Date(val).toLocaleDateString('es-CO'),
      },
      {
        key: 'last_login',
        label: 'Ultimo acceso',
        icon: 'clock',
        transform: (val: any) =>
          val ? new Date(val).toLocaleDateString('es-CO') : 'Nunca',
      },
    ],
  };

  actions: TableAction[] = [
    {
      label: 'Gestionar',
      icon: 'edit',
      variant: 'primary',
      action: (user: StoreUser) => this.openEditModal(user),
    },
    {
      label: 'Desactivar',
      icon: 'user-x',
      variant: 'danger',
      action: (user: StoreUser) => this.toggleUserStatus(user),
      show: (user: StoreUser) => user.state === StoreUserState.ACTIVE,
    },
    {
      label: 'Reactivar',
      icon: 'user-check',
      variant: 'success',
      action: (user: StoreUser) => this.toggleUserStatus(user),
      show: (user: StoreUser) => user.state !== StoreUserState.ACTIVE,
    },
  ];

  ngOnInit() {
    this.store.dispatch(StoreUsersActions.loadUsers());
    this.store.dispatch(StoreUsersActions.loadStats());
  }

  onSearch(search: string) {
    this.store.dispatch(StoreUsersActions.setSearch({ search }));
  }

  onFilterChange(values: FilterValues) {
    this.filterValues = values;
    const state_filter = (values['state'] as string) || '';
    this.store.dispatch(StoreUsersActions.setStateFilter({ state_filter }));
  }

  openCreateModal() {
    this.showCreateModal = true;
  }

  onUserCreated() {
    this.showCreateModal = false;
  }

  openEditModal(user: StoreUser) {
    this.editingUser.set(user);
    this.showEditModal = true;
  }

  onUserUpdated() {
    this.showEditModal = false;
    this.editingUser.set(null);
    this.store.dispatch(StoreUsersActions.loadUsers());
    this.store.dispatch(StoreUsersActions.loadStats());
  }

  toggleUserStatus(user: StoreUser) {
    const isActive = user.state === StoreUserState.ACTIVE;
    const actionText = isActive ? 'desactivar' : 'reactivar';

    this.dialogService
      .confirm({
        title: `${isActive ? 'Desactivar' : 'Reactivar'} Usuario`,
        message: `¿Estas seguro de que deseas ${actionText} al usuario "${user.first_name} ${user.last_name}"?`,
        confirmText: isActive ? 'Desactivar' : 'Reactivar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          if (isActive) {
            this.store.dispatch(StoreUsersActions.deactivateUser({ id: user.id }));
          } else {
            this.store.dispatch(StoreUsersActions.reactivateUser({ id: user.id }));
          }
        }
      });
  }

  getStateLabel(state: string): string {
    const map: Record<string, string> = {
      active: 'Activo',
      inactive: 'Inactivo',
      pending_verification: 'Pendiente',
      suspended: 'Suspendido',
      archived: 'Archivado',
    };
    return map[state] || state;
  }

  getPercentText(value: number): string {
    const total = this.stats()?.total || 0;
    if (total === 0) return '0% del total';
    return `${Math.round((value / total) * 100)}% del total`;
  }
}
