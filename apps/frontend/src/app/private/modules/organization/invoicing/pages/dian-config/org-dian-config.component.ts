import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  CardComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
} from '../../../../../../shared/components/index';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import { OrgFiscalScopeSelectorComponent } from '../../../shared/components/org-fiscal-scope-selector.component';
import {
  OrgDianConfigRow,
  OrgInvoicingService,
} from '../../services/org-invoicing.service';

@Component({
  selector: 'vendix-org-dian-config',
  standalone: true,
  imports: [
    AlertBannerComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    OrgFiscalScopeSelectorComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-org-fiscal-scope-selector
        [selectedStoreId]="selectedStoreId()"
        [showHeader]="false"
        (storeChange)="onFiscalStoreChange($event)"
      />

      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Configuraciones"
          [value]="rows().length"
          smallText="Perfiles DIAN"
          iconName="settings"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Habilitadas"
          [value]="enabledCount()"
          smallText="Listas para operar"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Producción"
          [value]="productionCount()"
          smallText="Ambiente productivo"
          iconName="shield-check"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
        <app-stats
          title="Por vencer"
          [value]="expiringCertificates()"
          smallText="Certificados 30 días"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar configuración DIAN">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Configuración DIAN ({{ filteredRows().length }})
            </h2>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar nombre, NIT o tienda..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              />

              <app-options-dropdown
                class="rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [actions]="dropdownActions"
                [isLoading]="loading()"
                triggerLabel="Filtros"
                triggerIcon="filter"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="filteredRows()"
            [columns]="tableColumns"
            [actions]="tableActions"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin configuración DIAN"
            emptyMessage="Sin configuración DIAN"
            emptyDescription="No hay configuración DIAN para el alcance fiscal seleccionado."
            emptyIcon="shield-check"
            [showEmptyAction]="false"
            [showEmptyClearFilters]="hasActiveFilters()"
            (emptyClearFiltersClick)="clearFilters()"
          />
        </div>
      </app-card>
    </div>
  `,
})
export class OrgDianConfigComponent {
  private readonly service = inject(OrgInvoicingService);
  private readonly auth = inject(AuthFacade);
  private readonly errors = inject(ApiErrorService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly selectedStoreId = signal<number | null>(null);
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly rows = signal<OrgDianConfigRow[]>([]);

  readonly requiresStoreSelector = computed(() => this.auth.fiscalScope() === 'STORE');
  readonly enabledCount = computed(() =>
    this.rows().filter((row) => ['enabled', 'accepted', 'production'].includes(String(row.enablement_status).toLowerCase())).length,
  );
  readonly productionCount = computed(() =>
    this.rows().filter((row) => String(row.environment).toLowerCase() === 'production').length,
  );
  readonly expiringCertificates = computed(() => {
    const now = new Date();
    const limit = new Date(now);
    limit.setDate(limit.getDate() + 30);
    return this.rows().filter((row) => {
      if (!row.certificate_expiry) return false;
      const expiry = new Date(row.certificate_expiry);
      return expiry >= now && expiry <= limit;
    }).length;
  });

  readonly filteredRows = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    const environment = this.filterValues()['environment'] as string | undefined;
    const status = this.filterValues()['status'] as string | undefined;
    return this.rows().filter((row) => {
      if (environment && row.environment !== environment) return false;
      if (status && row.enablement_status !== status) return false;
      if (!search) return true;
      return [
        row.name,
        row.nit,
        row.nit_dv,
        row.store?.name,
        row.store_id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  });

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'environment',
      label: 'Ambiente',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'test', label: 'Pruebas' },
        { value: 'production', label: 'Producción' },
      ],
    },
    {
      key: 'status',
      label: 'Estado DIAN',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'not_started', label: 'No iniciado' },
        { value: 'testing', label: 'Pruebas' },
        { value: 'enabled', label: 'Habilitada' },
        { value: 'rejected', label: 'Rechazada' },
      ],
    },
  ];

  readonly dropdownActions = [
    { label: 'Manejo fiscal', icon: 'settings', action: 'fiscal-settings', variant: 'outline' as const },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: 'Manejo fiscal',
      icon: 'settings',
      variant: 'secondary',
      action: () => this.onActionClick('fiscal-settings'),
    },
  ];

  readonly tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'nit',
      label: 'NIT',
      priority: 1,
      transform: (value, row) => `${value || '—'}${row?.nit_dv ? '-' + row.nit_dv : ''}`,
    },
    { key: 'store.name', label: 'Tienda', priority: 2, defaultValue: 'Organización' },
    {
      key: 'environment',
      label: 'Ambiente',
      priority: 2,
      transform: (value) => this.environmentLabel(String(value || '')),
    },
    {
      key: 'certificate_expiry',
      label: 'Certificado',
      priority: 3,
      transform: (value) => this.formatDate(value),
    },
    {
      key: 'enablement_status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          enabled: 'success',
          accepted: 'success',
          testing: 'info',
          not_started: 'warn',
          rejected: 'danger',
        },
      },
      transform: (value) => this.statusLabel(String(value || '')),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleTransform: (item) => `NIT ${item?.nit || '—'}${item?.nit_dv ? '-' + item.nit_dv : ''}`,
    avatarFallbackIcon: 'shield-check',
    avatarShape: 'square',
    badgeKey: 'enablement_status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        enabled: 'success',
        accepted: 'success',
        testing: 'info',
        not_started: 'warn',
        rejected: 'danger',
      },
    },
    badgeTransform: (value) => this.statusLabel(String(value || '')),
    detailKeys: [
      { key: 'store.name', label: 'Tienda', icon: 'store', transform: (value) => value || 'Organización' },
      { key: 'environment', label: 'Ambiente', icon: 'globe', transform: (value) => this.environmentLabel(String(value || '')) },
      { key: 'certificate_expiry', label: 'Certificado', icon: 'calendar', transform: (value) => this.formatDate(value) },
    ],
  };

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const storeId = params.get('store_id');
        this.selectedStoreId.set(storeId ? Number(storeId) : null);
        this.loadData();
      });
  }

  onFiscalStoreChange(storeId: number | null): void {
    if (storeId === this.selectedStoreId()) return;
    this.updateQuery({ store_id: storeId || null });
  }

  onSearch(search: string): void {
    this.searchTerm.set(search);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.filterValues.set({});
  }

  onActionClick(action: string): void {
    if (action === 'fiscal-settings') {
      this.router.navigate(['/admin/settings/fiscal']);
    }
  }

  hasActiveFilters(): boolean {
    return !!(
      this.searchTerm() ||
      this.filterValues()['environment'] ||
      this.filterValues()['status']
    );
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  environmentLabel(value: string): string {
    return value === 'production' ? 'Producción' : value === 'test' ? 'Pruebas' : value || '-';
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      not_started: 'No iniciado',
      testing: 'Pruebas',
      enabled: 'Habilitada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
    };
    return labels[status] || status || '-';
  }

  private loadData(): void {
    if (this.requiresStoreSelector() && !this.selectedStoreId()) {
      this.rows.set([]);
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    this.service
      .getDianConfigs(this.selectedStoreId() ? { store_id: this.selectedStoreId() } : undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar la configuración DIAN.'),
          );
          this.rows.set([]);
          this.loading.set(false);
        },
      });
  }

  private updateQuery(queryParams: Record<string, string | number | null>): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
