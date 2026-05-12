import {
  Component,
  DestroyRef,
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
  CreateOrgSupplierRequest,
  OrgInventoryService,
  OrgSupplierRow,
  UpdateOrgSupplierRequest,
} from '../../services/org-inventory.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { OrganizationStoresService } from '../../../stores/services/organization-stores.service';
import {
  OrgSupplierFormModalComponent,
  OrgSupplierStoreOption,
} from './components/org-supplier-form-modal.component';

/**
 * ORG_ADMIN — Proveedores con CRUD a nivel organización (P4.3).
 *
 * Standard list module pattern: stats sticky + sticky search + Card +
 * ResponsiveDataView con cardConfig para mobile.
 *
 * Permission gating:
 *   - `organization:inventory:suppliers:create` → "Nuevo proveedor"
 *   - `organization:inventory:suppliers:update` → "Editar"
 *   - `organization:inventory:suppliers:delete` → "Eliminar"
 */
@Component({
  selector: 'vendix-org-suppliers',
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
    OrgSupplierFormModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid: sticky at top on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total"
          [value]="stats().total"
          smallText="Proveedores registrados"
          iconName="truck"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="is_loading()"
        />
        <app-stats
          title="Activos"
          [value]="stats().active"
          smallText="Operativos actualmente"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="is_loading()"
        />
        <app-stats
          title="Inactivos"
          [value]="stats().inactive"
          smallText="Fuera de operación"
          iconName="x-circle"
          iconBgColor="bg-gray-100"
          iconColor="text-gray-500"
          [loading]="is_loading()"
        />
        <app-stats
          title="Tiendas asociadas"
          [value]="stats().stores_associated"
          smallText="Tiendas con proveedores"
          iconName="store"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="is_loading()"
        />
      </div>

      <!-- Banner contextual: STORE mode → org-wide suppliers no aplica -->
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
              Modo STORE activo. Los proveedores compartidos org-wide están
              disponibles solo en modo ORGANIZATION.
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

      <!-- Suppliers List Container -->
      <app-card [responsive]="true" [padding]="false">
        <!-- Search Section: sticky below stats on mobile, normal on desktop -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Proveedores ({{ pagination().total }})
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar proveedor..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              ></app-inputsearch>

              @if (canCreate()) {
                <app-button
                  variant="outline"
                  size="md"
                  customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                  (clicked)="openCreateModal()"
                  title="Nuevo proveedor"
                >
                  <app-icon slot="icon" name="plus" [size]="18"></app-icon>
                </app-button>
              }

              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs"
                [filterValues]="filter_values()"
                [actions]="dropdownActions()"
                [isLoading]="is_loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              ></app-options-dropdown>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        @if (is_loading()) {
          <div class="p-4 md:p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando proveedores...</p>
          </div>
        }

        <!-- Empty State -->
        @if (!is_loading() && filtered_rows().length === 0) {
          <div class="p-8 md:p-12 text-center text-gray-500">
            <app-icon
              name="truck"
              [size]="48"
              class="mx-auto mb-4 text-gray-300"
            ></app-icon>
            <h3 class="text-lg font-medium text-gray-900">
              Sin proveedores
            </h3>
            <p class="mt-1 text-sm md:text-base">
              No hay proveedores registrados.
            </p>
            @if (canCreate()) {
              <div class="mt-6">
                <app-button variant="primary" (clicked)="openCreateModal()">
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  Nuevo proveedor
                </app-button>
              </div>
            }
          </div>
        }

        <!-- Data View -->
        @if (!is_loading() && filtered_rows().length > 0) {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="filtered_rows()"
              [columns]="table_columns"
              [cardConfig]="cardConfig"
              [actions]="table_actions"
              [loading]="is_loading()"
              emptyMessage="No hay proveedores registrados"
              emptyIcon="truck"
              (sort)="onSort($event)"
              (rowClick)="onRowClick($event)"
            ></app-responsive-data-view>
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
          </div>
        }
      </app-card>

      <!-- Create/Edit Modal -->
      @if (canCreate() || canUpdate()) {
        <app-org-supplier-form-modal
          [isOpen]="is_modal_open()"
          [supplier]="selected_supplier()"
          [isSubmitting]="is_submitting()"
          [storeOptions]="store_options()"
          (cancel)="closeModal()"
          (save)="onSaveSupplier($event)"
        ></app-org-supplier-form-modal>
      }
    </div>
  `,
})
export class OrgSuppliersComponent {
  private readonly service = inject(OrgInventoryService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthFacade);
  private readonly storesService = inject(OrganizationStoresService);

  // ─── State signals (snake_case) ─────────────────────────────────────────
  readonly is_loading = signal(true);
  readonly rows = signal<OrgSupplierRow[]>([]);
  readonly filtered_rows = computed(() => this.rows());

  readonly store_options = signal<OrgSupplierStoreOption[]>([]);

  readonly is_modal_open = signal(false);
  readonly selected_supplier = signal<OrgSupplierRow | null>(null);
  readonly is_submitting = signal(false);

  readonly stats = signal({
    total: 0,
    active: 0,
    inactive: 0,
    stores_associated: 0,
  });

  readonly pagination = signal({ page: 1, limit: 10, total: 0, totalPages: 0 });

  // ─── Filter state ────────────────────────────────────────────────────────
  search_term = signal('');
  status_filter: 'all' | 'active' | 'inactive' = 'all';
  store_filter = signal<string>('');
  readonly filter_values = signal<FilterValues>({});

  // ─── Permission gating ───────────────────────────────────────────────────
  readonly canCreate = computed(() =>
    this.auth.hasPermission('organization:inventory:suppliers:create'),
  );
  readonly canUpdate = computed(() =>
    this.auth.hasPermission('organization:inventory:suppliers:update'),
  );
  readonly canDelete = computed(() =>
    this.auth.hasPermission('organization:inventory:suppliers:delete'),
  );

  // ─── Operating scope gating ──────────────────────────────────────────────
  readonly is_org_scope = computed(
    () => this.auth.operatingScope() === 'ORGANIZATION',
  );

  // ─── Filter configs ──────────────────────────────────────────────────────
  filterConfigs: FilterConfig[] = [
    {
      key: 'is_active',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'true', label: 'Activos' },
        { value: 'false', label: 'Inactivos' },
      ],
    },
    {
      key: 'store_id',
      label: 'Tienda',
      type: 'select',
      options: [{ value: '', label: 'Todas las tiendas' }],
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => {
    const actions: DropdownAction[] = [
      { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    ];
    if (this.canCreate()) {
      actions.push({
        label: 'Nuevo proveedor',
        icon: 'plus',
        action: 'create',
        variant: 'primary',
      });
    }
    return actions;
  });

  // ─── Table columns (desktop) ─────────────────────────────────────────────
  table_columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    { key: 'code', label: 'Código', priority: 3 },
    { key: 'tax_id', label: 'NIT', priority: 3, defaultValue: '—' },
    { key: 'email', label: 'Email', priority: 2, defaultValue: '—' },
    { key: 'phone', label: 'Teléfono', priority: 3, defaultValue: '—' },
    {
      key: 'store_name',
      label: 'Tienda',
      sortable: true,
      priority: 2,
      transform: (value: string | null | undefined) => value || 'Organización',
      cellClass: (_value: any, item: OrgSupplierRow) =>
        item?.store_id == null ? 'text-purple-600 font-medium' : '',
    },
    {
      key: 'is_active',
      label: 'Estado',
      priority: 1,
      transform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
      badge: true,
      badgeConfig: { type: 'status' },
    },
  ];

  // ─── Table actions (shared by table + cards) ─────────────────────────────
  table_actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      show: () => this.canUpdate(),
      action: (item: OrgSupplierRow) => this.openEditModal(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      show: () => this.canDelete(),
      action: (item: OrgSupplierRow) => this.confirmDelete(item),
    },
  ];

  // ─── Mobile card config ──────────────────────────────────────────────────
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'code',
    avatarFallbackIcon: 'truck',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
    footerKey: 'store_name',
    footerLabel: 'Tienda',
    footerTransform: (value: string | null | undefined) =>
      value || 'Organización',
    detailKeys: [
      { key: 'email', label: 'Email', icon: 'mail' },
      { key: 'phone', label: 'Teléfono', icon: 'phone' },
      { key: 'tax_id', label: 'NIT', icon: 'file-text' },
      {
        key: 'store_name',
        label: 'Compartido',
        icon: 'store',
        transform: (value: string | null | undefined) =>
          value || 'En toda la organización',
        // Marca con icon "share-2" + variante purple cuando store_id es null
        // (proveedor compartido a nivel organización).
        infoIconTransform: (_value: any, item?: OrgSupplierRow) =>
          item?.store_id == null ? 'share-2' : undefined,
        infoIconVariantTransform: (_value: any, item?: OrgSupplierRow) =>
          item?.store_id == null ? 'primary' : undefined,
      },
    ],
  };

  constructor() {
    this.loadSuppliers();
    this.loadStores();
  }

  // ─── Data loading ────────────────────────────────────────────────────────
  private loadSuppliers(): void {
    this.is_loading.set(true);
    const p = this.pagination();
    const query: any = {
      page: p.page,
      limit: p.limit,
      ...(this.search_term() ? { search: this.search_term() } : {}),
      ...(this.status_filter === 'active' ? { is_active: 'true' } : {}),
      ...(this.status_filter === 'inactive' ? { is_active: 'false' } : {}),
      ...(this.store_filter() ? { store_id: this.store_filter() } : {}),
    };

    this.service
      .getSuppliers(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data = res?.data ?? [];
          const meta = res?.meta;
          this.rows.set(data);
          if (meta) {
            this.pagination.update((pg) => ({
              ...pg,
              total: meta.total ?? data.length,
              totalPages: meta.totalPages ?? 1,
            }));
          } else {
            this.pagination.update((pg) => ({
              ...pg,
              total: data.length,
              totalPages: 1,
            }));
          }
          this.calculateStats();
          this.is_loading.set(false);
        },
        error: (err) => {
          console.error('[OrgSuppliers] load failed', err);
          this.toast.error(
            this.errors.humanize(err, 'No se pudieron cargar los proveedores.'),
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
          const stores = (res?.data ?? []).map((s: any) => ({
            value: s.id,
            label: s.name ?? `Tienda #${s.id}`,
          })) as OrgSupplierStoreOption[];
          this.store_options.set(stores);

          // Replace store_id filter options with stores + "Org-wide" entry.
          this.filterConfigs = this.filterConfigs.map((cfg) =>
            cfg.key === 'store_id'
              ? {
                  ...cfg,
                  options: [
                    { value: '', label: 'Todas' },
                    { value: 'null', label: 'Org-wide (sin tienda)' },
                    ...stores.map((s) => ({
                      value: String(s.value),
                      label: s.label,
                    })),
                  ],
                }
              : cfg,
          );
        },
        error: (err) => {
          console.error('[OrgSuppliers] stores load failed', err);
        },
      });
  }

  private calculateStats(): void {
    const list = this.rows();
    const pg = this.pagination();
    const uniqueStoreIds = new Set<number>();
    let active = 0;
    let inactive = 0;
    for (const r of list) {
      if (r.is_active) active++;
      else inactive++;
      if (r.store_id != null) uniqueStoreIds.add(r.store_id);
    }
    this.stats.set({
      total: pg.total || list.length,
      active,
      inactive,
      stores_associated: uniqueStoreIds.size,
    });
  }

  // ─── Filters / search / pagination ───────────────────────────────────────
  onSearch(term: string): void {
    this.search_term.set(term);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadSuppliers();
  }

  onFilterChange(values: FilterValues): void {
    this.filter_values.set({ ...values });

    const isActiveValue = values['is_active'] as string | null;
    if (isActiveValue === 'true') {
      this.status_filter = 'active';
    } else if (isActiveValue === 'false') {
      this.status_filter = 'inactive';
    } else {
      this.status_filter = 'all';
    }

    const storeValue = (values['store_id'] as string | null) ?? '';
    this.store_filter.set(storeValue);

    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadSuppliers();
  }

  clearFilters(): void {
    this.status_filter = 'all';
    this.store_filter.set('');
    this.search_term.set('');
    this.filter_values.set({});
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadSuppliers();
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadSuppliers();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.openCreateModal();
        break;
      case 'refresh':
        this.loadSuppliers();
        break;
    }
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (!event.direction) {
      this.loadSuppliers();
      return;
    }
    this.rows.update((list) =>
      [...list].sort((a, b) => {
        const val_a = (a as any)[event.column] ?? '';
        const val_b = (b as any)[event.column] ?? '';
        const comparison = String(val_a).localeCompare(String(val_b));
        return event.direction === 'asc' ? comparison : -comparison;
      }),
    );
  }

  onRowClick(item: OrgSupplierRow): void {
    if (this.canUpdate()) this.openEditModal(item);
  }

  // ─── Modal CRUD ──────────────────────────────────────────────────────────
  openCreateModal(): void {
    if (!this.canCreate()) return;
    this.selected_supplier.set(null);
    this.is_modal_open.set(true);
  }

  openEditModal(row: OrgSupplierRow): void {
    if (!this.canUpdate()) return;
    this.selected_supplier.set(row);
    this.is_modal_open.set(true);
  }

  closeModal(): void {
    this.is_modal_open.set(false);
    this.selected_supplier.set(null);
  }

  onSaveSupplier(
    payload: CreateOrgSupplierRequest | UpdateOrgSupplierRequest,
  ): void {
    this.is_submitting.set(true);
    const selected = this.selected_supplier();
    const obs = selected
      ? this.service.updateSupplier(selected.id, payload)
      : this.service.createSupplier(payload as CreateOrgSupplierRequest);

    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(
          selected
            ? 'Proveedor actualizado correctamente'
            : 'Proveedor creado correctamente',
        );
        this.is_submitting.set(false);
        this.closeModal();
        this.loadSuppliers();
      },
      error: (err) => {
        this.toast.error(
          this.errors.humanize(err, 'No se pudo guardar el proveedor.'),
        );
        this.is_submitting.set(false);
      },
    });
  }

  confirmDelete(row: OrgSupplierRow): void {
    if (!this.canDelete()) return;
    this.dialog
      .confirm({
        title: 'Eliminar proveedor',
        message: `¿Está seguro de que desea eliminar "${row.name}"? Se marcará como inactivo.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteSupplier(row);
        }
      });
  }

  private deleteSupplier(row: OrgSupplierRow): void {
    this.service
      .deleteSupplier(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Proveedor eliminado correctamente');
          this.loadSuppliers();
        },
        error: (err) => {
          this.toast.error(
            this.errors.humanize(err, 'No se pudo eliminar el proveedor.'),
          );
        },
      });
  }
}
