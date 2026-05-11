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
  OrgInvoicingService,
  OrgResolutionRow,
} from '../../services/org-invoicing.service';

@Component({
  selector: 'vendix-org-invoice-resolutions',
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
          title="Resoluciones"
          [value]="rows().length"
          smallText="Registros DIAN"
          iconName="hash"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Activas"
          [value]="activeCount()"
          smallText="Disponibles para numeración"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Facturas"
          [value]="invoiceCount()"
          smallText="Documentos asociados"
          iconName="receipt"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
        <app-stats
          title="Por vencer"
          [value]="expiringCount()"
          smallText="Vencen en 30 días"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudieron cargar resoluciones">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Resoluciones ({{ filteredRows().length }})
            </h2>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar resolución, prefijo o tienda..."
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
            emptyTitle="Sin resoluciones"
            emptyMessage="Sin resoluciones"
            emptyDescription="No hay resoluciones para el alcance fiscal seleccionado."
            emptyIcon="hash"
            [showEmptyAction]="false"
            [showEmptyClearFilters]="hasActiveFilters()"
            (emptyClearFiltersClick)="clearFilters()"
          />
        </div>
      </app-card>
    </div>
  `,
})
export class OrgInvoiceResolutionsComponent {
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
  readonly rows = signal<OrgResolutionRow[]>([]);

  readonly requiresStoreSelector = computed(() => this.auth.fiscalScope() === 'STORE');
  readonly activeCount = computed(() => this.rows().filter((row) => row.is_active).length);
  readonly invoiceCount = computed(() =>
    this.rows().reduce((total, row) => total + Number(row._count?.invoices || 0), 0),
  );
  readonly expiringCount = computed(() => {
    const now = new Date();
    const limit = new Date(now);
    limit.setDate(limit.getDate() + 30);
    return this.rows().filter((row) => {
      if (!row.valid_to || !row.is_active) return false;
      const validTo = new Date(row.valid_to);
      return validTo >= now && validTo <= limit;
    }).length;
  });

  readonly filteredRows = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    const state = this.filterValues()['state'] as string | undefined;
    return this.rows().filter((row) => {
      if (state === 'active' && !row.is_active) return false;
      if (state === 'inactive' && row.is_active) return false;
      if (!search) return true;
      return [
        row.resolution_number,
        row.prefix,
        row.store?.name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  });

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'state',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todas' },
        { value: 'active', label: 'Activas' },
        { value: 'inactive', label: 'Inactivas' },
      ],
    },
  ];

  readonly dropdownActions = [
    { label: 'Configurar DIAN', icon: 'settings', action: 'dian-config', variant: 'outline' as const },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: 'Config DIAN',
      icon: 'settings',
      variant: 'secondary',
      action: () => this.onActionClick('dian-config'),
    },
  ];

  readonly tableColumns: TableColumn[] = [
    { key: 'prefix', label: 'Prefijo', priority: 1 },
    { key: 'resolution_number', label: 'Resolución', priority: 1 },
    { key: 'store.name', label: 'Tienda', priority: 2, defaultValue: 'Organización' },
    {
      key: 'current_number',
      label: 'Consecutivo',
      align: 'right',
      priority: 2,
      transform: (value, row) => `${value || 0} / ${row?.range_to || 0}`,
    },
    {
      key: 'valid_to',
      label: 'Vigente hasta',
      align: 'center',
      priority: 2,
      transform: (value) => this.formatDate(value),
    },
    {
      key: 'is_active',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: { true: 'success', false: 'default' },
      },
      transform: (value) => (value ? 'Activa' : 'Inactiva'),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'resolution_number',
    titleTransform: (item) => `${item?.prefix || ''} ${item?.resolution_number || ''}`.trim(),
    subtitleTransform: (item) => item?.store?.name || 'Organización',
    avatarFallbackIcon: 'hash',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'status',
      colorMap: { true: 'success', false: 'default' },
    },
    badgeTransform: (value) => (value ? 'Activa' : 'Inactiva'),
    detailKeys: [
      { key: 'current_number', label: 'Consecutivo', icon: 'hash', transform: (value, item) => `${value || 0} / ${item?.range_to || 0}` },
      { key: 'valid_to', label: 'Vigente hasta', icon: 'calendar', transform: (value) => this.formatDate(value) },
      { key: '_count.invoices', label: 'Facturas', icon: 'receipt', transform: (value) => String(value || 0) },
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
    this.router.navigate([`../${action}`], {
      relativeTo: this.route,
      queryParamsHandling: 'preserve',
    });
  }

  hasActiveFilters(): boolean {
    return !!(this.searchTerm() || this.filterValues()['state']);
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '-';
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
      .getResolutions(this.selectedStoreId() ? { store_id: this.selectedStoreId() } : undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar las resoluciones.'),
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
