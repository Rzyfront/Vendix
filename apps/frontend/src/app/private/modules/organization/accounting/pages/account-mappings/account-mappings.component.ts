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
import {
  AccountMappingRow,
  OrgAccountingService,
} from '../../services/org-accounting.service';

@Component({
  selector: 'vendix-org-account-mappings',
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
          title="Mapeos"
          [value]="rows().length"
          smallText="Eventos contables"
          iconName="link"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Configurados"
          [value]="configuredCount()"
          smallText="Con cuenta asociada"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Personalizados"
          [value]="customCount()"
          smallText="Org o tienda"
          iconName="settings"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
        <app-stats
          title="Por defecto"
          [value]="defaultCount()"
          smallText="Plantilla PUC"
          iconName="database"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar el mapeo de cuentas">
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
                Mapeo de cuentas ({{ filteredRows().length }})
              </h2>
              <p class="hidden text-sm text-text-secondary md:block">
                Vinculación entre eventos fiscales y cuentas del PUC.
              </p>
            </div>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar clave, cuenta o código..."
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
            emptyTitle="Sin mapeos"
            emptyMessage="Sin mapeos"
            emptyDescription="No hay mapeos contables para el alcance fiscal seleccionado."
            emptyIcon="link"
            [showEmptyAction]="false"
            [showEmptyClearFilters]="hasActiveFilters()"
            (emptyClearFiltersClick)="clearFilters()"
          />
        </div>
      </app-card>
    </div>
  `,
})
export class OrgAccountMappingsComponent {
  private readonly service = inject(OrgAccountingService);
  private readonly errors = inject(ApiErrorService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly rows = signal<AccountMappingRow[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});

  readonly configuredCount = computed(() => this.rows().filter((row) => !!row.account_id || !!row.account_code).length);
  readonly defaultCount = computed(() => this.rows().filter((row) => row.source === 'default').length);
  readonly customCount = computed(() => this.rows().filter((row) => row.source === 'organization' || row.source === 'store').length);

  readonly filteredRows = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    const source = this.filterValues()['source'] as string | undefined;
    return this.rows().filter((row) => {
      if (source && row.source !== source) return false;
      if (!search) return true;
      return [
        row.mapping_key,
        row.account_code,
        this.accountName(row),
        row.description,
        row.source,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  });

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'source',
      label: 'Origen',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'store', label: 'Tienda' },
        { value: 'organization', label: 'Organización' },
        { value: 'default', label: 'Por defecto' },
      ],
    },
  ];

  readonly tableColumns: TableColumn[] = [
    { key: 'mapping_key', label: 'Clave', sortable: true, priority: 1 },
    { key: 'account_code', label: 'Código', priority: 1, defaultValue: '—' },
    {
      key: 'account_name',
      label: 'Cuenta',
      priority: 1,
      transform: (_value, row) => this.accountName(row),
    },
    {
      key: 'description',
      label: 'Descripción',
      priority: 2,
      defaultValue: '—',
    },
    {
      key: 'source',
      label: 'Origen',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: { store: 'info', organization: 'success', default: 'default' },
      },
      transform: (value) => this.sourceLabel(String(value || '')),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'mapping_key',
    subtitleTransform: (item) => this.accountName(item),
    avatarFallbackIcon: 'link',
    avatarShape: 'square',
    badgeKey: 'source',
    badgeConfig: {
      type: 'status',
      colorMap: { store: 'info', organization: 'success', default: 'default' },
    },
    badgeTransform: (value) => this.sourceLabel(String(value || '')),
    detailKeys: [
      { key: 'account_code', label: 'Código', icon: 'hash', transform: (value) => value || '—' },
      { key: 'description', label: 'Descripción', icon: 'file-text', transform: (value) => value || '—' },
    ],
  };

  constructor() {
    this.route.queryParamMap
      .pipe(
        switchMap((params) => {
          this.loading.set(true);
          this.errorMessage.set(null);
          const storeId = params.get('store_id');
          return this.service.getAccountMappings(
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
            this.errors.humanize(err, 'No se pudo cargar el mapeo.'),
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
    return !!(this.searchTerm() || this.filterValues()['source']);
  }

  accountName(row: AccountMappingRow): string {
    return row.account_name || row.description || '—';
  }

  sourceLabel(source: string): string {
    const labels: Record<string, string> = {
      store: 'Tienda',
      organization: 'Organización',
      default: 'Por defecto',
    };
    return labels[source] || source || '—';
  }
}
