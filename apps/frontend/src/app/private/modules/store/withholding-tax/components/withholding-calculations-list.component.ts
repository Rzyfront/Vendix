import {
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WithholdingTaxService } from '../services/withholding-tax.service';
import {
  WithholdingCalculation,
  WithholdingCalculationsQuery,
  WithholdingRole,
} from '../interfaces/withholding.interface';
import {
  ItemListCardConfig,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  SelectorOption,
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
    FormsModule,
    ResponsiveDataViewComponent,
    PaginationComponent,
    SelectorComponent,
  ],
  template: `
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow">
      <!-- Filters -->
      <div class="p-4 border-b border-gray-200 dark:border-gray-700">
        <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
            Auditoría de Cálculos
          </h2>
          <div class="grid grid-cols-3 gap-2 md:flex md:gap-3">
            <app-selector
              label="Año"
              size="sm"
              [options]="yearOptions"
              [ngModel]="yearFilter()"
              (ngModelChange)="onYearChange($event)"
            ></app-selector>
            <app-selector
              label="Mes"
              size="sm"
              [options]="monthOptions"
              [ngModel]="monthFilter()"
              (ngModelChange)="onMonthChange($event)"
            ></app-selector>
            <app-selector
              label="Rol"
              size="sm"
              [options]="roleOptions"
              [ngModel]="roleFilter()"
              (ngModelChange)="onRoleChange($event)"
            ></app-selector>
          </div>
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

  /** '' = sin filtro */
  readonly yearFilter = signal<number | ''>('');
  readonly monthFilter = signal<number | ''>('');
  readonly roleFilter = signal<WithholdingRole | ''>('');

  readonly totalPages = computed(
    () => Math.ceil(this.totalItems() / this.filters().limit) || 1,
  );

  readonly yearOptions: SelectorOption[] = [
    { value: '', label: 'Todos' },
    ...Array.from({ length: 6 }, (_, i) => {
      const year = new Date().getFullYear() - i;
      return { value: year, label: String(year) };
    }),
  ];

  readonly monthOptions: SelectorOption[] = [
    { value: '', label: 'Todos' },
    ...MONTH_LABELS.map((label, i) => ({ value: i + 1, label })),
  ];

  readonly roleOptions: SelectorOption[] = [
    { value: '', label: 'Todas' },
    { value: 'practiced', label: 'Practicadas' },
    { value: 'suffered', label: 'Sufridas' },
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
    if (this.yearFilter() !== '') query.year = Number(this.yearFilter());
    if (this.monthFilter() !== '') query.month = Number(this.monthFilter());
    if (this.roleFilter() !== '') {
      query.role = this.roleFilter() as WithholdingRole;
    }

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

  onYearChange(value: number | ''): void {
    this.yearFilter.set(value === '' ? '' : Number(value));
    this.resetAndReload();
  }

  onMonthChange(value: number | ''): void {
    this.monthFilter.set(value === '' ? '' : Number(value));
    this.resetAndReload();
  }

  onRoleChange(value: WithholdingRole | ''): void {
    this.roleFilter.set(value);
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
