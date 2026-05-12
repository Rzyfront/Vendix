import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  CardComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
} from '../../../../../../shared/components/index';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import {
  ChartAccountRow,
  OrgAccountingService,
} from '../../services/org-accounting.service';

@Component({
  selector: 'vendix-org-chart-of-accounts',
  standalone: true,
  imports: [
    AlertBannerComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Cuentas"
          [value]="rows().length"
          smallText="PUC del alcance fiscal"
          iconName="book-open"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Auxiliares"
          [value]="acceptsEntriesCount()"
          smallText="Aceptan asientos"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Activas"
          [value]="activeCount()"
          smallText="Disponibles"
          iconName="activity"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
        <app-stats
          title="Tipos"
          [value]="accountTypesCount()"
          smallText="Clases contables"
          iconName="layers"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar el plan de cuentas">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <div>
              <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
                Plan de cuentas ({{ filteredRows().length }})
              </h2>
              <p class="hidden text-sm text-text-secondary md:block">
                PUC fiscal real, consolidado o por tienda según el alcance seleccionado.
              </p>
            </div>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar código o nombre..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              />

              <app-options-dropdown
                class="rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none"
                [filters]="filterConfigs()"
                [filterValues]="filterValues()"
                [isLoading]="loading()"
                triggerLabel="Filtros"
                triggerIcon="filter"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="paginatedRows()"
            [columns]="tableColumns"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin cuentas"
            emptyMessage="Sin cuentas"
            emptyDescription="No hay plan de cuentas para el alcance fiscal seleccionado."
            emptyIcon="book-open"
            [showEmptyAction]="false"
            [showEmptyClearFilters]="hasActiveFilters()"
            (emptyClearFiltersClick)="clearFilters()"
          />

          @if (totalPages() > 1) {
            <div class="mt-4 flex justify-center border-t border-border pt-3">
              <app-pagination
                [currentPage]="displayPage()"
                [totalPages]="totalPages()"
                [total]="filteredRows().length"
                [limit]="pageSize"
                infoStyle="none"
                (pageChange)="changePage($event)"
              />
            </div>
          }
        </div>
      </app-card>
    </div>
  `,
})
export class OrgChartOfAccountsComponent {
  private readonly service = inject(OrgAccountingService);
  private readonly errors = inject(ApiErrorService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly rows = signal<ChartAccountRow[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly currentPage = signal(1);
  readonly pageSize = 15;

  readonly activeCount = computed(() => this.rows().filter((row) => row.is_active !== false).length);
  readonly acceptsEntriesCount = computed(() => this.rows().filter((row) => row.accepts_entries).length);
  readonly accountTypesCount = computed(() => new Set(this.rows().map((row) => row.account_type).filter(Boolean)).size);

  readonly filteredRows = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    const type = this.filterValues()['account_type'] as string | undefined;
    const accepts = this.filterValues()['accepts_entries'] as string | undefined;
    return this.rows().filter((row) => {
      if (type && row.account_type !== type) return false;
      if (accepts === 'yes' && !row.accepts_entries) return false;
      if (accepts === 'no' && row.accepts_entries) return false;
      if (!search) return true;
      return [this.accountCode(row), this.accountName(row), row.account_type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  });

  readonly filterConfigs = computed<FilterConfig[]>(() => [
    {
      key: 'account_type',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        ...Array.from(new Set(this.rows().map((row) => row.account_type).filter(Boolean)))
          .map((type) => ({ value: String(type), label: this.typeLabel(String(type)) })),
      ],
    },
    {
      key: 'accepts_entries',
      label: 'Acepta asientos',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'yes', label: 'Sí' },
        { value: 'no', label: 'No' },
      ],
    },
  ]);

  readonly totalPages = computed(() => Math.ceil(this.filteredRows().length / this.pageSize));
  readonly displayPage = computed(() => {
    const totalPages = this.totalPages();
    return totalPages > 0 ? Math.min(this.currentPage(), totalPages) : 1;
  });
  readonly paginatedRows = computed(() => {
    const start = (this.displayPage() - 1) * this.pageSize;
    return this.filteredRows().slice(start, start + this.pageSize);
  });

  readonly tableColumns: TableColumn[] = [
    {
      key: 'code',
      label: 'Código',
      sortable: true,
      priority: 1,
      transform: (_value, row) => this.accountCode(row),
    },
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      priority: 1,
      transform: (_value, row) => this.accountName(row),
    },
    {
      key: 'account_type',
      label: 'Tipo',
      priority: 2,
      transform: (value) => this.typeLabel(String(value || '')),
    },
    {
      key: 'level',
      label: 'Nivel',
      align: 'center',
      priority: 3,
      defaultValue: '—',
    },
    {
      key: 'accepts_entries',
      label: 'Acepta asientos',
      align: 'center',
      priority: 2,
      transform: (value) => (value ? 'Sí' : 'No'),
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
      transform: (value) => (value === false ? 'Inactiva' : 'Activa'),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    titleTransform: (item) => this.accountName(item),
    subtitleTransform: (item) => this.accountCode(item),
    avatarFallbackIcon: 'book-open',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'status',
      colorMap: { true: 'success', false: 'default' },
    },
    badgeTransform: (value) => (value === false ? 'Inactiva' : 'Activa'),
    detailKeys: [
      { key: 'account_type', label: 'Tipo', icon: 'layers', transform: (value) => this.typeLabel(String(value || '')) },
      { key: 'accepts_entries', label: 'Asientos', icon: 'check-circle', transform: (value) => (value ? 'Sí' : 'No') },
      { key: 'level', label: 'Nivel', icon: 'git-branch', transform: (value) => String(value || '—') },
    ],
  };

  constructor() {
    this.route.queryParamMap
      .pipe(
        switchMap((params) => {
          this.loading.set(true);
          this.errorMessage.set(null);
          const storeId = params.get('store_id');
          return this.service.getChartOfAccounts({
            limit: 1000,
            ...(storeId ? { store_id: storeId } : {}),
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          this.currentPage.set(1);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar el plan de cuentas.'),
          );
          this.rows.set([]);
          this.loading.set(false);
        },
      });
  }

  onSearch(search: string): void {
    this.searchTerm.set(search);
    this.currentPage.set(1);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
    this.currentPage.set(1);
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.filterValues.set({});
    this.currentPage.set(1);
  }

  changePage(page: number): void {
    this.currentPage.set(page);
  }

  hasActiveFilters(): boolean {
    return !!(
      this.searchTerm() ||
      this.filterValues()['account_type'] ||
      this.filterValues()['accepts_entries']
    );
  }

  accountCode(row: ChartAccountRow): string {
    return row.code || row.account_code || '—';
  }

  accountName(row: ChartAccountRow): string {
    return row.name || row.account_name || '—';
  }

  typeLabel(type: string): string {
    const labels: Record<string, string> = {
      asset: 'Activo',
      liability: 'Pasivo',
      equity: 'Patrimonio',
      income: 'Ingreso',
      expense: 'Gasto',
      cost: 'Costo',
    };
    return labels[type] || type || '—';
  }
}
