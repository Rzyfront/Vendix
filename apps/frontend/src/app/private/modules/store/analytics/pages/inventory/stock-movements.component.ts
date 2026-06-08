import {Component, OnInit, inject, signal,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { TableColumn } from '../../../../../../shared/components/table/table.component';
import {
  ResponsiveDataViewComponent,
  ItemListCardConfig} from '../../../../../../shared/components/index';
import { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { AnalyticsService } from '../../services/analytics.service';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import {
  StockMovementReport,
  InventoryAnalyticsQueryDto} from '../../interfaces/inventory-analytics.interface';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';

@Component({
  selector: 'vendix-stock-movements',
  standalone: true,
imports: [
    RouterModule,
    FormsModule,
    CardComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    DateRangeFilterComponent,
    ExportButtonComponent,
    AnalyticsCardComponent,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Movimientos"
          [value]="getTotalMovements()"
          smallText=" registros"
          iconName="repeat"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Entradas"
          [value]="getInCount()"
          iconName="arrow-down-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Salidas"
          [value]="getOutCount()"
          iconName="arrow-up-circle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Neto"
          [value]="getNetCount()"
          iconName="trending-up"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

<!-- Header -->
      <div class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1 mb-4">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0">
            <app-icon name="repeat" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">
              Historial de Movimientos
            </h1>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Registro de entradas, salidas y ajustes de inventario
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 md:gap-3 shrink-0">
          <vendix-date-range-filter
            [value]="dateRange()"
            (valueChange)="onDateRangeChange($event)"
          ></vendix-date-range-filter>
          <vendix-export-button
            [loading]="exporting()"
            (export)="exportReport()"
          ></vendix-export-button>
</div>
      </div>

      <!-- Content Grid -->
      <div class="grid grid-cols-1 gap-6">
      <!-- Main Content Table -->
      <app-card
        shadow="none"
        [padding]="false"
        overflow="hidden"
        [showHeader]="true"
      >
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">
            Movimientos de Inventario
            <span
              class="text-xs text-text-secondary font-normal ml-2"
            >
              ({{ data().length }} registros)
            </span>
          </span>
        </div>

        <div class="p-4">
          <app-responsive-data-view
            [data]="data()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [loading]="tableLoading()"
            emptyMessage="No hay movimientos registrados"
            emptyIcon="activity"
          ></app-responsive-data-view>
        </div>
      </app-card>
      </div>

      <!-- Quick Links -->
      <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
        <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Inventario</span>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          @for (view of inventoryViews; track view.key) {
            <app-analytics-card [view]="view"></app-analytics-card>
          }
        </div>
      </app-card>
    </div>
  `})
export class StockMovementsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  tableLoading = signal(false);
  exporting = signal(false);
  data = signal<StockMovementReport[]>([]);
  typeFilter = signal<string>('');
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});
  typeOptions: SelectorOption[] = [
    { value: '', label: 'Todos' },
    { value: 'stock_in', label: 'Entrada' },
    { value: 'stock_out', label: 'Salida' },
    { value: 'sale', label: 'Venta' },
    { value: 'return', label: 'Devolución' },
    { value: 'transfer', label: 'Transferencia' },
    { value: 'adjustment', label: 'Ajuste' },
    { value: 'damage', label: 'Daño' },
  ];

  readonly inventoryViews: AnalyticsView[] = getViewsByCategory('inventory').filter(
    (v) => v.key !== 'inventory_movements'
  );

  columns: TableColumn[] = [
    {
      key: 'date',
      label: 'Fecha',
      sortable: true,
      priority: 1,
      width: '120px',
      transform: (val) => new Date(val).toLocaleDateString('es-CO')},
    { key: 'product_name', label: 'Producto', sortable: true, priority: 1 },
    { key: 'sku', label: 'SKU', sortable: true, priority: 2, width: '100px' },
    {
      key: 'movement_type',
      label: 'Tipo',
      align: 'center',
      priority: 1,
      width: '120px',
      badgeConfig: {
        type: 'status',
        colorMap: {
          stock_in: 'success',
          stock_out: 'info',
          sale: 'primary',
          return: 'warn',
          transfer: 'info',
          adjustment: 'default',
          damage: 'danger',
          expiration: 'danger'}}},
    {
      key: 'quantity',
      label: 'Cantidad',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px'},
    {
      key: 'from_location',
      label: 'Origen',
      priority: 2,
      width: '120px',
      transform: (val) => val || '-'},
    {
      key: 'to_location',
      label: 'Destino',
      priority: 2,
      width: '120px',
      transform: (val) => val || '-'},
    {
      key: 'user_name',
      label: 'Usuario',
      priority: 2,
      width: '120px',
      transform: (val) => val || '-'},
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    subtitleKey: 'sku',
    badgeKey: 'movement_type',
    badgeConfig: {
      type: 'status',
      colorMap: {
        stock_in: 'success',
        stock_out: 'info',
        sale: 'primary',
        return: 'warn',
        transfer: 'info',
        adjustment: 'default',
        damage: 'danger'}},
    detailKeys: [
      {
        key: 'quantity',
        label: 'Cantidad',
        transform: (val: any) => `${val} uds`},
      {
        key: 'date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: any) => new Date(val).toLocaleDateString('es-CO')},
    ]};

  ngOnInit(): void {
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
    }
    this.loadTableData();
  }
onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.loadTableData();
  }

  onTypeChange(type: string): void {
    this.typeFilter.set(type);
    this.loadTableData();
  }

  private buildQuery(): InventoryAnalyticsQueryDto {
    return {
      date_range: this.dateRange(),
      movement_type: this.typeFilter() || undefined,
    };
  }

  private loadTableData(): void {
    this.tableLoading.set(true);
    const query: InventoryAnalyticsQueryDto = {
      ...this.buildQuery(),
      page: 1,
      limit: 25,
    };

    this.analyticsService
      .getStockMovements(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.data.set(this.extractRows(response));
          this.tableLoading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar movimientos');
          this.tableLoading.set(false);
        }});
  }

  private extractRows(response: any): StockMovementReport[] {
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.data?.data)) return response.data.data;
    return [];
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportInventoryAnalytics({
        date_range: this.dateRange(),
        movement_type: this.typeFilter() || undefined})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `movimientos_stock_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.toastService.error('Error al exportar');
          this.exporting.set(false);
        }});
  }

  getTotalMovements(): number {
    return this.data().length;
  }

  getInCount(): number {
    return this.data().filter(m => ['stock_in', 'return'].includes(m.movement_type)).length;
  }

  getOutCount(): number {
    return this.data().filter(m =>
      ['stock_out', 'sale', 'damage', 'expiration'].includes(m.movement_type),
    ).length;
  }

  getNetCount(): number {
    const inCount = this.getInCount();
    const outCount = this.getOutCount();
    return inCount - outCount;
  }
}
