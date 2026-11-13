import {
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WithholdingTaxService } from '../services/withholding-tax.service';
import {
  WithholdingCalculation,
  WithholdingCalculationsQuery,
  WithholdingRole,
} from '../interfaces/withholding.interface';
import {
  FilterConfig,
  FilterValues,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  TableColumn,
} from '../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency/currency.pipe';

const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/**
 * "Cálculos" tab — read-only audit of every persisted withholding calculation
 * (practiced over suppliers and suffered from customers). Server-side
 * pagination + year/month/role filters against
 * `GET /store/withholding-tax/calculations`.
 */
@Component({
  selector: 'app-withholding-calculations-list',
  standalone: true,
  imports: [
    ResponsiveDataViewComponent,
    PaginationComponent,
    OptionsDropdownComponent,
  ],
  template: `
    <div class="bg-[var(--color-surface)] rounded-lg shadow">
      <!-- Header: list filters live in the standard Filtros dropdown -->
      <div class="p-4 border-b border-border">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold text-text-primary">
            Auditoría de Cálculos
          </h2>
          <app-options-dropdown
            class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
            [filters]="filterConfigs"
            [filterValues]="filterValues()"
            [isLoading]="loading()"
            (filterChange)="onFilterChange($event)"
            (clearAllFilters)="onFilterChange({})"
          />
        </div>
      </div>

      <!-- Data -->
      <div class="p-2 md:p-4">
        <app-responsive-data-view
          [data]="calculations()"
          [columns]="columns"
          [cardConfig]="cardConfig"
          [loading]="loading()"
          emptyMessage="Sin retenciones registradas"
          emptyTitle="No hay cálculos de retención"
          emptyDescription="Los cálculos aparecen automáticamente al aplicar retenciones en compras y ventas."
        />
        <app-pagination
          [currentPage]="filters().page"
          [totalPages]="totalPages()"
          [total]="totalItems()"
          [limit]="filters().limit"
          infoStyle="range"
          (pageChange)="onPageChange($event)"
        ></app-pagination>
      </div>
    </div>
  `,
})
export class WithholdingCalculationsListComponent {
  private readonly service = inject(WithholdingTaxService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly calculations = signal<WithholdingCalculation[]>([]);
  readonly loading = signal(false);
  readonly totalItems = signal(0);
  readonly filters = signal({ page: 1, limit: 10 });

  /** Empty / null value = no filter. */
  readonly filterValues = signal<FilterValues>({});

  readonly totalPages = computed(
    () => Math.ceil(this.totalItems() / this.filters().limit) || 1,
  );

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'year',
      label: 'Año',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        ...Array.from({ length: 6 }, (_, i) => {
          const year = String(new Date().getFullYear() - i);
          return { value: year, label: year };
        }),
      ],
    },
    {
      key: 'month',
      label: 'Mes',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        ...MONTH_LABELS.map((label, i) => ({ value: String(i + 1), label })),
      ],
    },
    {
      key: 'role',
      label: 'Rol',
      type: 'select',
      options: [
        { value: '', label: 'Todas' },
        { value: 'practiced', label: 'Practicadas' },
        { value: 'suffered', label: 'Sufridas' },
      ],
    },
  ];

  readonly columns: TableColumn[] = [
    {
      key: 'created_at',
      label: 'Fecha',
      priority: 1,
      transform: (value: string | null) =>
        value ? new Date(value).toLocaleDateString('es-CO') : '—',
    },
    {
      key: 'concept',
      label: 'Concepto',
      priority: 1,
      transform: (value: WithholdingCalculation['concept']) =>
        value?.name || '—',
    },
    {
      key: 'supplier',
      label: 'Tercero',
      priority: 2,
      transform: (_value: unknown, item: WithholdingCalculation) =>
        this.counterpartyName(item),
    },
    {
      key: 'invoice',
      label: 'Factura',
      priority: 3,
      transform: (value: WithholdingCalculation['invoice']) =>
        value?.invoice_number || '—',
    },
    {
      key: 'base_amount',
      label: 'Base',
      align: 'right',
      priority: 2,
      transform: (value: string | number) => this.formatCurrency(value),
    },
    {
      key: 'withholding_rate',
      label: 'Tarifa %',
      align: 'right',
      priority: 3,
      transform: (value: string | number) =>
        `${((Number(value) || 0) * 100).toFixed(2)}%`,
    },
    {
      key: 'withholding_amount',
      label: 'Retención',
      align: 'right',
      priority: 1,
      transform: (value: string | number) => this.formatCurrency(value),
    },
    {
      key: 'role',
      label: 'Rol',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: { practiced: '#2563eb', suffered: '#d97706' },
      },
      transform: (value: WithholdingRole) => this.roleLabel(value),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'concept',
    titleTransform: (item: WithholdingCalculation) =>
      item.concept?.name || '—',
    subtitleKey: 'supplier',
    subtitleTransform: (item: WithholdingCalculation) =>
      this.counterpartyName(item),
    avatarFallbackIcon: 'trending-down',
    avatarShape: 'square',
    badgeKey: 'role',
    badgeConfig: {
      type: 'status',
      size: 'sm',
      colorMap: { practiced: '#2563eb', suffered: '#d97706' },
    },
    badgeTransform: (value: WithholdingRole) => this.roleLabel(value),
    detailKeys: [
      {
        key: 'created_at',
        label: 'Fecha',
        icon: 'calendar',
        transform: (value: string | null) =>
          value ? new Date(value).toLocaleDateString('es-CO') : '—',
      },
      {
        key: 'invoice',
        label: 'Factura',
        icon: 'file-text',
        transform: (value: WithholdingCalculation['invoice']) =>
          value?.invoice_number || '—',
      },
      {
        key: 'base_amount',
        label: 'Base',
        icon: 'calculator',
        transform: (value: string | number) => this.formatCurrency(value),
      },
      {
        key: 'withholding_rate',
        label: 'Tarifa',
        icon: 'percent',
        transform: (value: string | number) =>
          `${((Number(value) || 0) * 100).toFixed(2)}%`,
      },
    ],
    footerKey: 'withholding_amount',
    footerLabel: 'Retención',
    footerStyle: 'prominent',
    footerTransform: (value: string | number) => this.formatCurrency(value),
  };

  constructor() {
    this.loadCalculations();
  }

  loadCalculations(): void {
    this.loading.set(true);

    const query: WithholdingCalculationsQuery = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    const { year, month, role } = this.filterValues();
    if (typeof year === 'string' && year !== '') query.year = Number(year);
    if (typeof month === 'string' && month !== '') query.month = Number(month);
    if (role === 'practiced' || role === 'suffered') query.role = role;

    this.service
      .getCalculations(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.calculations.set(response.data ?? []);
          this.totalItems.set(response.meta?.total ?? 0);
          this.loading.set(false);
        },
        error: () => {
          this.calculations.set([]);
          this.totalItems.set(0);
          this.loading.set(false);
        },
      });
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);
    this.resetAndReload();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadCalculations();
  }

  private resetAndReload(): void {
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadCalculations();
  }

  private counterpartyName(item: WithholdingCalculation): string {
    if (item.supplier?.name) return item.supplier.name;
    if (item.customer) {
      const name =
        `${item.customer.first_name ?? ''} ${item.customer.last_name ?? ''}`.trim();
      return name || item.customer.email || '—';
    }
    return '—';
  }

  private roleLabel(role: WithholdingRole): string {
    return role === 'suffered' ? 'Sufrida' : 'Practicada';
  }

  private formatCurrency(value: string | number): string {
    return this.currencyService.format(Number(value) || 0, 0);
  }
}
