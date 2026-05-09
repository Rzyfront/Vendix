import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  DropdownAction,
  FilterConfig,
  FilterValues,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';

import {
  CreateOrgLocationRequest,
  OrgInventoryService,
  OrgLocationRow,
  OrgLocationType,
  UpdateOrgLocationRequest,
} from '../../services/org-inventory.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { OrganizationStoresService } from '../../../stores/services/organization-stores.service';

import {
  OrgLocationFormModalComponent,
  OrgLocationStoreOption,
} from './components/org-location-form-modal.component';

const LOCATION_TYPE_LABELS: Record<string, string> = {
  warehouse: 'Almacén',
  store: 'Tienda',
  virtual: 'Virtual',
  transit: 'Tránsito',
};

/**
 * ORG_ADMIN — Ubicaciones consolidadas a nivel organización (canonical
 * standard module pattern: sticky stats + sticky search + ResponsiveDataView).
 *
 * Reutiliza el endpoint `/organization/inventory/locations` con paginación
 * server-side (page/limit/search/is_active/type/store_id) en lugar de la
 * agrupación visual por tienda — la columna sortable `store_name` y el filtro
 * `store_id` cubren el mismo caso de uso.
 */
@Component({
  selector: 'vendix-org-locations',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    RouterLink,
    StatsComponent,
    OrgLocationFormModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total"
          [value]="stats().total"
          smallText="Ubicaciones registradas"
          iconName="map-pin"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="is_loading()"
        ></app-stats>

        <app-stats
          title="Centrales"
          [value]="stats().central"
          smallText="Bodegas centrales de organización"
          iconName="building"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="is_loading()"
        ></app-stats>

        <app-stats
          title="Almacenes"
          [value]="stats().warehouses"
          smallText="Tipo almacén"
          iconName="warehouse"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="is_loading()"
        ></app-stats>

        <app-stats
          title="Activas"
          [value]="stats().active"
          smallText="Operativas actualmente"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="is_loading()"
        ></app-stats>
      </div>

      <!-- Banner contextual: STORE mode → consolidated/central locations no aplica -->
      @if (!is_org_scope()) {
        <app-alert-banner
          variant="info"
          icon="info"
          class="block mx-2 md:mx-0 mb-2 md:mb-4"
        >
          <div
            class="flex flex-col md:flex-row md:items-center md:justify-between gap-2"
          >
            <span>
              Modo STORE activo. Las ubicaciones consolidadas y bodegas
              centrales están disponibles solo en modo ORGANIZATION.
            </span>
            <a
              routerLink="/admin/settings/operating-scope"
              class="text-sm font-medium underline hover:no-underline whitespace-nowrap"
            >
              Cambiar modo →
            </a>
          </div>
        </app-alert-banner>
      }

      <!-- Banner contextual: ORG mode sin bodega central → ofrecer crearla -->
      @if (is_org_scope() && canCreate() && !is_loading() && !has_central_warehouse()) {
        <app-alert-banner
          variant="warning"
          icon="alert-triangle"
          class="block mx-2 md:mx-0 mb-2 md:mb-4"
        >
          <div
            class="flex flex-col md:flex-row md:items-center md:justify-between gap-2"
          >
            <span>
              Esta organización no tiene una bodega central. Créala para habilitar
              transferencias entre tiendas y consolidación de inventario.
            </span>
            <app-button
              size="sm"
              variant="primary"
              [loading]="is_creating_central()"
              (clicked)="onEnsureCentral()"
            >
              Crear bodega central
            </app-button>
          </div>
        </app-alert-banner>
      }

      <!-- List card -->
      <app-card [responsive]="true" [padding]="false">
        <!-- Sticky search/header below stats on mobile -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Ubicaciones ({{ pagination().total }})
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar ubicación..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              ></app-inputsearch>

              @if (canCreate()) {
                <app-button
                  variant="outline"
                  size="md"
                  customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                  (clicked)="openCreateModal()"
                  title="Nueva ubicación"
                >
                  <app-icon slot="icon" name="plus" [size]="18"></app-icon>
                </app-button>
              }

              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs()"
                [filterValues]="filterValues"
                [actions]="dropdownActions()"
                [isLoading]="is_loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              ></app-options-dropdown>
            </div>
          </div>
        </div>

        <!-- Data view -->
        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="filtered_items()"
            [columns]="table_columns"
            [cardConfig]="cardConfig"
            [actions]="table_actions"
            [loading]="is_loading()"
            [sortable]="true"
            emptyMessage="No hay ubicaciones registradas."
            emptyTitle="No hay ubicaciones"
            emptyIcon="map-pin"
            emptyActionText="Nueva ubicación"
            emptyActionIcon="plus"
            [showEmptyAction]="canCreate()"
            (sort)="onSort($event)"
            (rowClick)="onRowClick($event)"
            (emptyActionClick)="openCreateModal()"
          ></app-responsive-data-view>

          @if (pagination().totalPages > 1) {
            <div class="mt-4 flex justify-center">
              <app-pagination
                [currentPage]="pagination().page"
                [totalPages]="pagination().totalPages"
                [total]="pagination().total"
                [limit]="pagination().limit"
                infoStyle="none"
                (pageChange)="changePage($event)"
              />
            </div>
          }
        </div>
      </app-card>

      <!-- Form modal -->
      @if (canCreate() || canUpdate()) {
        <app-org-location-form-modal
          [isOpen]="is_modal_open()"
          [location]="selected_item()"
          [isSubmitting]="is_submitting()"
          [storeOptions]="storeOptions()"
          (cancel)="closeModal()"
          (save)="onSaveLocation($event)"
        ></app-org-location-form-modal>
      }
    </div>
  `,
})
export class OrgLocationsComponent implements OnInit {
  private readonly service = inject(OrgInventoryService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthFacade);
  private readonly storesService = inject(OrganizationStoresService);

  // ─── State ───────────────────────────────────────────────────────────────
  readonly is_loading = signal(true);
  readonly is_modal_open = signal(false);
  readonly is_submitting = signal(false);
  readonly is_creating_central = signal(false);

  readonly filtered_items = signal<OrgLocationRow[]>([]);
  readonly selected_item = signal<OrgLocationRow | null>(null);
  readonly storeOptions = signal<OrgLocationStoreOption[]>([]);

  readonly pagination = signal({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  readonly stats = signal({
    total: 0,
    central: 0,
    warehouses: 0,
    active: 0,
  });

  // Local filter mirror (loadLocations uses these as query params).
  // store_filter accepts the special sentinel '__org__' for "ubicaciones
  // organizacionales sin tienda" (filtered client-side).
  private status_filter: 'all' | 'active' | 'inactive' = 'all';
  private type_filter: OrgLocationType | '' = '';
  private store_filter: number | '__org__' | '' = '';
  private search_term = signal('');

  filterValues: FilterValues = {};

  readonly dropdownActions = computed<DropdownAction[]>(() => {
    const actions: DropdownAction[] = [
      { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    ];
    if (this.canCreate()) {
      actions.push({
        label: 'Nueva ubicación',
        icon: 'plus',
        action: 'create',
        variant: 'primary',
      });
    }
    return actions;
  });

  readonly filterConfigs = computed<FilterConfig[]>(() => {
    const storeOpts = [
      { value: '', label: 'Todas las tiendas' },
      { value: '__org__', label: 'Solo organización (sin tienda)' },
      ...this.storeOptions().map((s) => ({
        value: String(s.value),
        label: s.label,
      })),
    ];

    return [
      {
        key: 'store_id',
        label: 'Tienda',
        type: 'select',
        options: storeOpts,
      },
      {
        key: 'type',
        label: 'Tipo',
        type: 'select',
        options: [
          { value: '', label: 'Todos los tipos' },
          { value: 'warehouse', label: 'Almacén' },
          { value: 'store', label: 'Tienda' },
          { value: 'virtual', label: 'Virtual' },
          { value: 'transit', label: 'Tránsito' },
        ],
      },
      {
        key: 'is_active',
        label: 'Estado',
        type: 'select',
        options: [
          { value: '', label: 'Todos' },
          { value: 'true', label: 'Activas' },
          { value: 'false', label: 'Inactivas' },
        ],
      },
    ];
  });

  // ─── Permissions ─────────────────────────────────────────────────────────
  readonly canCreate = computed(() =>
    this.auth.hasPermission('organization:inventory:locations:create'),
  );
  readonly canUpdate = computed(() =>
    this.auth.hasPermission('organization:inventory:locations:update'),
  );
  readonly canDelete = computed(() =>
    this.auth.hasPermission('organization:inventory:locations:delete'),
  );

  // ─── Operating scope gating ──────────────────────────────────────────────
  readonly is_org_scope = computed(
    () => this.auth.operatingScope() === 'ORGANIZATION',
  );
  readonly has_central_warehouse = computed(() => this.stats().central > 0);

  // ─── Table columns (desktop) ─────────────────────────────────────────────
  readonly table_columns: TableColumn[] = [
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      priority: 1,
    },
    {
      key: 'code',
      label: 'Código',
      priority: 3,
      width: '120px',
      cellClass: () => 'font-mono text-text-secondary',
      transform: (value: string) => value || '—',
    },
    {
      key: 'store_name',
      label: 'Tienda',
      sortable: true,
      priority: 2,
      transform: (value: string | null | undefined) =>
        value ? value : 'Organización',
    },
    {
      key: 'type',
      label: 'Tipo',
      priority: 2,
      transform: (value: string) => LOCATION_TYPE_LABELS[value] || value || '—',
    },
    {
      key: 'is_central_warehouse',
      label: 'Central',
      priority: 2,
      width: '110px',
      transform: (value: boolean) => (value ? 'Central' : '—'),
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          Central: 'info',
        },
      },
    },
    {
      key: 'is_active',
      label: 'Estado',
      priority: 1,
      transform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
      badge: true,
      badgeConfig: {
        type: 'status',
      },
    },
  ];

  // ─── Table actions ───────────────────────────────────────────────────────
  readonly table_actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      show: () => this.canUpdate(),
      action: (item: OrgLocationRow) => this.openEditModal(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      show: () => this.canDelete(),
      action: (item: OrgLocationRow) => this.confirmDelete(item),
    },
  ];

  // ─── Mobile card config ──────────────────────────────────────────────────
  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'store_name',
    subtitleTransform: (item: OrgLocationRow) =>
      item.store_name ? item.store_name : 'Organización',
    avatarFallbackIcon: 'map-pin',
    avatarShape: 'square',
    badgeKey: 'is_central_warehouse',
    badgeConfig: { type: 'custom', size: 'sm' },
    badgeTransform: (val: boolean, item?: OrgLocationRow) => {
      if (val) return 'Central';
      return item?.is_active ? 'Activo' : 'Inactivo';
    },
    footerKey: 'type',
    footerLabel: 'Tipo',
    footerTransform: (value: string) =>
      LOCATION_TYPE_LABELS[value] || value || '—',
    detailKeys: [
      {
        key: 'code',
        label: 'Código',
        icon: 'tag',
        transform: (value: string) => value || '—',
      },
      {
        key: 'type',
        label: 'Tipo',
        icon: 'warehouse',
        transform: (value: string) =>
          LOCATION_TYPE_LABELS[value] || value || '—',
      },
    ],
  };

  ngOnInit(): void {
    this.loadLocations();
    this.loadStores();
  }

  // ─── Loaders ─────────────────────────────────────────────────────────────
  private loadLocations(): void {
    this.is_loading.set(true);
    const p = this.pagination();
    const query: Record<string, unknown> = {
      page: p.page,
      limit: p.limit,
    };
    const term = this.search_term();
    if (term) query['search'] = term;
    if (this.status_filter === 'active') query['is_active'] = true;
    if (this.status_filter === 'inactive') query['is_active'] = false;
    if (this.type_filter) query['type'] = this.type_filter;
    if (this.store_filter !== '' && this.store_filter !== '__org__') {
      query['store_id'] = this.store_filter;
    }

    this.service
      .getLocations(query as Parameters<OrgInventoryService['getLocations']>[0])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          let rows = response?.data ?? [];
          // Backend doesn't filter by "no store" — apply client-side when the
          // user explicitly picks "Solo organización (sin tienda)".
          if (this.store_filter === '__org__') {
            rows = rows.filter(
              (r) => r.store_id == null || r.is_central_warehouse,
            );
          }

          this.filtered_items.set(rows);

          const total =
            response?.meta?.pagination?.total ??
            response?.meta?.total ??
            rows.length;
          const totalPages =
            response?.meta?.pagination?.totalPages ??
            response?.meta?.totalPages ??
            Math.max(1, Math.ceil(total / p.limit));
          this.pagination.update((pg) => ({
            ...pg,
            total,
            totalPages,
          }));

          this.calculateStats(rows, total);

          // Auto-recover from out-of-range page (e.g., after delete)
          if (rows.length === 0 && this.pagination().page > 1) {
            this.pagination.update((pg) => ({ ...pg, page: pg.page - 1 }));
            this.loadLocations();
            return;
          }

          this.is_loading.set(false);
        },
        error: (err) => {
          console.error('[OrgLocations] load failed', err);
          this.toast.error(
            this.errors.humanize(err, 'No se pudieron cargar las ubicaciones.'),
          );
          this.is_loading.set(false);
        },
      });
  }

  private loadStores(): void {
    this.storesService
      .getStores({ limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const list = (res?.data ?? []).map((s: any) => ({
            value: s.id,
            label: s.name ?? `Tienda #${s.id}`,
          })) as OrgLocationStoreOption[];
          this.storeOptions.set(list);
        },
        error: (err) => {
          console.error('[OrgLocations] stores load failed', err);
        },
      });
  }

  private calculateStats(rows: OrgLocationRow[], totalFromServer: number): void {
    this.stats.set({
      total: totalFromServer || rows.length,
      central: rows.filter((r) => r.is_central_warehouse).length,
      warehouses: rows.filter((r) => r.type === 'warehouse').length,
      active: rows.filter((r) => r.is_active).length,
    });
  }

  // ─── Search / filter / sort / paging ─────────────────────────────────────
  onSearch(term: string): void {
    this.search_term.set(term);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadLocations();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;

    const isActiveValue = values['is_active'] as string | undefined;
    if (isActiveValue === 'true') this.status_filter = 'active';
    else if (isActiveValue === 'false') this.status_filter = 'inactive';
    else this.status_filter = 'all';

    const typeValue = values['type'] as string | undefined;
    this.type_filter = (typeValue as OrgLocationType) || '';

    const storeValue = values['store_id'] as string | undefined;
    if (!storeValue) this.store_filter = '';
    else if (storeValue === '__org__') this.store_filter = '__org__';
    else this.store_filter = Number(storeValue);

    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadLocations();
  }

  clearFilters(): void {
    this.status_filter = 'all';
    this.type_filter = '';
    this.store_filter = '';
    this.search_term.set('');
    this.filterValues = {};
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadLocations();
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadLocations();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.openCreateModal();
        break;
      case 'refresh':
        this.loadLocations();
        break;
    }
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (!event.direction) {
      this.loadLocations();
      return;
    }
    this.filtered_items.update((list) =>
      [...list].sort((a, b) => {
        const va = (a as unknown as Record<string, unknown>)[event.column] ?? '';
        const vb = (b as unknown as Record<string, unknown>)[event.column] ?? '';
        const cmp = String(va).localeCompare(String(vb));
        return event.direction === 'asc' ? cmp : -cmp;
      }),
    );
  }

  onRowClick(item: OrgLocationRow): void {
    if (this.canUpdate()) {
      this.openEditModal(item);
    }
  }

  // ─── Modal ───────────────────────────────────────────────────────────────
  openCreateModal(): void {
    if (!this.canCreate()) return;
    this.selected_item.set(null);
    this.is_modal_open.set(true);
  }

  openEditModal(item: OrgLocationRow): void {
    if (!this.canUpdate()) return;
    this.selected_item.set(item);
    this.is_modal_open.set(true);
  }

  closeModal(): void {
    this.is_modal_open.set(false);
    this.selected_item.set(null);
  }

  onEnsureCentral(): void {
    if (!this.canCreate() || !this.is_org_scope()) return;
    this.is_creating_central.set(true);
    this.service.ensureCentralWarehouse()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Bodega central creada correctamente. Ya puedes registrar transferencias entre tiendas.');
          this.is_creating_central.set(false);
          this.loadLocations();
        },
        error: (err) => {
          this.toast.error(this.errors.humanize(err, 'No se pudo crear la bodega central. Intenta de nuevo.'));
          this.is_creating_central.set(false);
        },
      });
  }

  onSaveLocation(
    payload: CreateOrgLocationRequest | UpdateOrgLocationRequest,
  ): void {
    this.is_submitting.set(true);
    const selected = this.selected_item();
    const obs = selected
      ? this.service.updateLocation(selected.id, payload)
      : this.service.createLocation(payload as CreateOrgLocationRequest);

    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(
          selected
            ? 'Ubicación actualizada correctamente'
            : 'Ubicación creada correctamente',
        );
        this.is_submitting.set(false);
        this.closeModal();
        this.loadLocations();
      },
      error: (err) => {
        this.toast.error(
          this.errors.humanize(err, 'No se pudo guardar la ubicación.'),
        );
        this.is_submitting.set(false);
      },
    });
  }

  // ─── Delete ──────────────────────────────────────────────────────────────
  confirmDelete(item: OrgLocationRow): void {
    if (!this.canDelete()) return;
    this.dialog
      .confirm({
        title: 'Eliminar ubicación',
        message: `¿Está seguro de que desea eliminar la ubicación "${item.name}"? Se marcará como inactiva.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteLocation(item);
        }
      });
  }

  private deleteLocation(item: OrgLocationRow): void {
    this.service
      .deleteLocation(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Ubicación eliminada correctamente');
          this.loadLocations();
        },
        error: (err) => {
          this.toast.error(
            this.errors.humanize(err, 'No se pudo eliminar la ubicación.'),
          );
        },
      });
  }
}
