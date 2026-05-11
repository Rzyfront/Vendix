import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
  TableAction,
  TableColumn,
} from '../../../../../../shared/components/index';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import {
  JournalEntryRow,
  OrgAccountingService,
} from '../../services/org-accounting.service';

interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Component({
  selector: 'vendix-org-journal-entries',
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
          title="Asientos"
          [value]="meta().total"
          smallText="Registros contables"
          iconName="list"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Débitos"
          [value]="formatMoney(totalDebit())"
          smallText="Página actual"
          iconName="arrow-up-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Créditos"
          [value]="formatMoney(totalCredit())"
          smallText="Página actual"
          iconName="arrow-down-circle"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
        <app-stats
          title="Balance"
          [value]="formatMoney(totalDebit() - totalCredit())"
          smallText="Débito - crédito"
          iconName="calculator"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudieron cargar los asientos">
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
                Asientos contables ({{ meta().total }})
              </h2>
              <p class="hidden text-sm text-text-secondary md:block">
                Movimiento fiscal real del alcance seleccionado.
              </p>
            </div>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar número o descripción..."
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
            [data]="rows()"
            [columns]="tableColumns"
            [actions]="tableActions"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin asientos"
            emptyMessage="Sin asientos"
            emptyDescription="No hay asientos contables para el alcance fiscal seleccionado."
            emptyIcon="file-text"
            [showEmptyAction]="false"
            [showEmptyClearFilters]="hasActiveFilters()"
            (rowClick)="selectEntry($event)"
            (emptyClearFiltersClick)="clearFilters()"
          />

          @if (meta().totalPages > 1) {
            <div class="mt-4 flex justify-center border-t border-border pt-3">
              <app-pagination
                [currentPage]="meta().page"
                [totalPages]="meta().totalPages"
                [total]="meta().total"
                [limit]="meta().limit"
                infoStyle="none"
                (pageChange)="changePage($event)"
              />
            </div>
          }
        </div>
      </app-card>

      @if (selectedEntry(); as entry) {
        <app-card customClasses="mt-3">
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 class="text-base font-semibold text-text-primary">
                {{ entry.entry_number || ('Asiento #' + entry.id) }}
              </h3>
              <p class="text-sm text-text-secondary">
                {{ entry.description || 'Sin descripción' }}
              </p>
            </div>
            <div class="grid grid-cols-2 gap-4 text-sm md:text-right">
              <div>
                <p class="text-text-secondary">Débito</p>
                <p class="font-semibold text-text-primary">{{ formatMoney(entry.total_debit) }}</p>
              </div>
              <div>
                <p class="text-text-secondary">Crédito</p>
                <p class="font-semibold text-text-primary">{{ formatMoney(entry.total_credit) }}</p>
              </div>
            </div>
          </div>
        </app-card>
      }
    </div>
  `,
})
export class OrgJournalEntriesComponent {
  private readonly service = inject(OrgAccountingService);
  private readonly errors = inject(ApiErrorService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currency = inject(CurrencyFormatService);

  readonly loading = signal(true);
  readonly rows = signal<JournalEntryRow[]>([]);
  readonly selectedEntry = signal<JournalEntryRow | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly meta = signal<PageMeta>({ total: 0, page: 1, limit: 25, totalPages: 1 });

  readonly totalDebit = computed(() =>
    this.rows().reduce((sum, row) => sum + this.asNumber(row.total_debit), 0),
  );
  readonly totalCredit = computed(() =>
    this.rows().reduce((sum, row) => sum + this.asNumber(row.total_credit), 0),
  );

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'draft', label: 'Borrador' },
        { value: 'posted', label: 'Contabilizado' },
        { value: 'voided', label: 'Anulado' },
      ],
    },
    {
      key: 'entry_type',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'manual', label: 'Manual' },
        { value: 'automatic', label: 'Automático' },
        { value: 'adjustment', label: 'Ajuste' },
        { value: 'closing', label: 'Cierre' },
      ],
    },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'primary',
      action: (row: JournalEntryRow) => this.selectEntry(row),
    },
  ];

  readonly tableColumns: TableColumn[] = [
    { key: 'entry_number', label: 'Número', sortable: true, priority: 1, defaultValue: '—' },
    {
      key: 'entry_date',
      label: 'Fecha',
      align: 'center',
      priority: 1,
      transform: (value) => this.formatDate(value),
    },
    { key: 'store.name', label: 'Tienda', priority: 3, defaultValue: 'Organización' },
    { key: 'description', label: 'Descripción', priority: 2, defaultValue: '—' },
    {
      key: 'total_debit',
      label: 'Débito',
      align: 'right',
      priority: 1,
      transform: (value) => this.formatMoney(value),
    },
    {
      key: 'total_credit',
      label: 'Crédito',
      align: 'right',
      priority: 1,
      transform: (value) => this.formatMoney(value),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: { posted: 'success', approved: 'success', draft: 'warn', pending: 'warn', voided: 'danger', cancelled: 'danger' },
      },
      transform: (value) => this.statusLabel(String(value || '')),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'entry_number',
    titleTransform: (item) => item?.entry_number || `Asiento #${item?.id}`,
    subtitleTransform: (item) => item?.description || 'Sin descripción',
    avatarFallbackIcon: 'file-text',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: { posted: 'success', approved: 'success', draft: 'warn', pending: 'warn', voided: 'danger', cancelled: 'danger' },
    },
    badgeTransform: (value) => this.statusLabel(String(value || '')),
    footerKey: 'total_debit',
    footerLabel: 'Débito',
    footerTransform: (value) => this.formatMoney(value),
    detailKeys: [
      { key: 'entry_date', label: 'Fecha', icon: 'calendar', transform: (value) => this.formatDate(value) },
      { key: 'store.name', label: 'Tienda', icon: 'store', transform: (value) => value || 'Organización' },
      { key: 'total_credit', label: 'Crédito', icon: 'arrow-down-circle', transform: (value) => this.formatMoney(value) },
    ],
  };

  constructor() {
    this.currency.loadCurrency();
    this.route.queryParamMap
      .pipe(
        switchMap((params) => {
          this.loading.set(true);
          this.errorMessage.set(null);
          const page = Number(params.get('page') || 1);
          const storeId = params.get('store_id');
          const search = params.get('search') || '';
          const status = params.get('status') || '';
          const entryType = params.get('entry_type') || '';

          this.searchTerm.set(search);
          this.filterValues.set({
            ...(status ? { status } : {}),
            ...(entryType ? { entry_type: entryType } : {}),
          });

          return this.service.getJournalEntries({
            page: Number.isFinite(page) && page > 0 ? page : 1,
            limit: 25,
            ...(storeId ? { store_id: storeId } : {}),
            ...(search ? { search } : {}),
            ...(status ? { status } : {}),
            ...(entryType ? { entry_type: entryType } : {}),
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          this.meta.set(this.normalizeMeta(res?.meta));
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar los asientos.'),
          );
          this.rows.set([]);
          this.loading.set(false);
        },
      });
  }

  onSearch(search: string): void {
    this.updateQuery({ search: search || null, page: 1 });
  }

  onFilterChange(values: FilterValues): void {
    this.updateQuery({
      status: (values['status'] as string) || null,
      entry_type: (values['entry_type'] as string) || null,
      page: 1,
    });
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.filterValues.set({});
    this.updateQuery({ search: null, status: null, entry_type: null, page: 1 });
  }

  changePage(page: number): void {
    this.updateQuery({ page });
  }

  selectEntry(entry: JournalEntryRow): void {
    this.selectedEntry.set(entry);
  }

  hasActiveFilters(): boolean {
    return !!(
      this.searchTerm() ||
      this.filterValues()['status'] ||
      this.filterValues()['entry_type']
    );
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  formatMoney(value: string | number | null | undefined): string {
    return this.currency.format(this.asNumber(value));
  }

  asNumber(value: string | number | undefined | null): number {
    if (value === null || value === undefined) return 0;
    return typeof value === 'number' ? value : Number(value) || 0;
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      posted: 'Contabilizado',
      approved: 'Aprobado',
      draft: 'Borrador',
      pending: 'Pendiente',
      voided: 'Anulado',
      cancelled: 'Cancelado',
    };
    return labels[status] || status || '-';
  }

  private normalizeMeta(meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    total_pages?: number;
  }): PageMeta {
    const total = Number(meta?.total || 0);
    const limit = Number(meta?.limit || 25);
    const page = Number(meta?.page || 1);
    const totalPages = Number(meta?.totalPages || meta?.total_pages || Math.max(1, Math.ceil(total / limit)));
    return { total, page, limit, totalPages };
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
