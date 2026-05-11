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
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
} from '../../../../../../shared/components/index';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import {
  FiscalPeriodRow,
  OrgAccountingService,
} from '../../services/org-accounting.service';

@Component({
  selector: 'vendix-org-fiscal-periods',
  standalone: true,
  imports: [
    AlertBannerComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Periodos"
          [value]="rows().length"
          smallText="Calendarios fiscales"
          iconName="calendar"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Abiertos"
          [value]="openCount()"
          smallText="Reciben asientos"
          iconName="unlock"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Cerrados"
          [value]="closedCount()"
          smallText="Bloqueados"
          iconName="lock"
          iconBgColor="bg-gray-100"
          iconColor="text-gray-500"
          [loading]="loading()"
        />
        <app-stats
          title="Asientos"
          [value]="entryCount()"
          smallText="Registros asociados"
          iconName="file-text"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudieron cargar los periodos">
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
                Periodos fiscales ({{ filteredRows().length }})
              </h2>
              <p class="hidden text-sm text-text-secondary md:block">
                Periodos contables del alcance fiscal seleccionado.
              </p>
            </div>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar periodo o año..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              />

              <app-options-dropdown
                class="rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none"
                [filters]="filterConfigs"
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
            [data]="filteredRows()"
            [columns]="tableColumns"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin periodos"
            emptyMessage="Sin periodos"
            emptyDescription="No hay periodos fiscales configurados para el alcance seleccionado."
            emptyIcon="calendar"
            [showEmptyAction]="false"
            [showEmptyClearFilters]="hasActiveFilters()"
            (emptyClearFiltersClick)="clearFilters()"
          />
        </div>
      </app-card>
    </div>
  `,
})
export class OrgFiscalPeriodsComponent {
  private readonly service = inject(OrgAccountingService);
  private readonly errors = inject(ApiErrorService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly rows = signal<FiscalPeriodRow[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});

  readonly openCount = computed(() => this.rows().filter((row) => row.status !== 'closed').length);
  readonly closedCount = computed(() => this.rows().filter((row) => row.status === 'closed').length);
  readonly entryCount = computed(() =>
    this.rows().reduce((sum, row) => sum + Number(row._count?.accounting_entries || 0), 0),
  );

  readonly filteredRows = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    const status = this.filterValues()['status'] as string | undefined;
    return this.rows().filter((row) => {
      if (status && row.status !== status) return false;
      if (!search) return true;
      return [
        row.name,
        this.periodYear(row),
        row.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  });

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'open', label: 'Abierto' },
        { value: 'closed', label: 'Cerrado' },
      ],
    },
  ];

  readonly tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1, defaultValue: '—' },
    {
      key: 'period_year',
      label: 'Año',
      align: 'center',
      priority: 1,
      transform: (_value, row) => this.periodYear(row),
    },
    {
      key: 'start_date',
      label: 'Inicio',
      align: 'center',
      priority: 2,
      transform: (value) => this.formatDate(value),
    },
    {
      key: 'end_date',
      label: 'Fin',
      align: 'center',
      priority: 2,
      transform: (value) => this.formatDate(value),
    },
    {
      key: '_count.accounting_entries',
      label: 'Asientos',
      align: 'right',
      priority: 3,
      transform: (value) => String(value || 0),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: { open: 'success', closed: 'default' },
      },
      transform: (value) => this.statusLabel(String(value || '')),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleTransform: (item) => `Año ${this.periodYear(item)}`,
    avatarFallbackIcon: 'calendar',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: { open: 'success', closed: 'default' },
    },
    badgeTransform: (value) => this.statusLabel(String(value || '')),
    detailKeys: [
      { key: 'start_date', label: 'Inicio', icon: 'calendar', transform: (value) => this.formatDate(value) },
      { key: 'end_date', label: 'Fin', icon: 'calendar', transform: (value) => this.formatDate(value) },
      { key: '_count.accounting_entries', label: 'Asientos', icon: 'file-text', transform: (value) => String(value || 0) },
    ],
  };

  constructor() {
    this.route.queryParamMap
      .pipe(
        switchMap((params) => {
          this.loading.set(true);
          this.errorMessage.set(null);
          const storeId = params.get('store_id');
          return this.service.getFiscalPeriods(
            storeId ? { store_id: storeId } : undefined,
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar los periodos fiscales.'),
          );
          this.rows.set([]);
          this.loading.set(false);
        },
      });
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

  hasActiveFilters(): boolean {
    return !!(this.searchTerm() || this.filterValues()['status']);
  }

  periodYear(row: FiscalPeriodRow): string {
    if (row.period_year) return String(row.period_year);
    if (!row.start_date) return '—';
    return String(new Date(row.start_date).getUTCFullYear());
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  statusLabel(status: string): string {
    return status === 'closed' ? 'Cerrado' : status === 'open' ? 'Abierto' : status || '-';
  }
}
