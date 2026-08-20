import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import type { EChartsOption } from 'echarts';

import {
  CardComponent,
  ChartComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { PaginationComponent } from '../../../../../../../shared/components/pagination/pagination.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../../services/analytics.service';
import { LowStockBySupplierAnalyticsEnvelope } from '../../../interfaces/low-stock-by-supplier-analytics.interface';
import { getViewsByCategory, AnalyticsView } from '../../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../../components/analytics-card/analytics-card.component';
import { truncateLabel, compactCountAxis } from '../../../../../../../shared/utils/chart-labels.util';

type TabId = 'summary' | 'by-supplier' | 'by-category' | 'history';

/**
 * Analytics shell for "Stock Bajo por Proveedor" (CP-low-stock-by-supplier,
 * Phase H, FB-06).
 *
 * Four tabs:
 *   1. Resumen      — 4 KPIs + donut (low vs out) + bar (top critical).
 *   2. Por Proveedor — horizontal bar (`by_supplier`), drill-down to the
 *                     report page on click (FB-07).
 *   3. Por Categoría — bar (`by_category`).
 *   4. Histórico    — line chart over `history_30d`; empty state when
 *                     the snapshot table is absent (ADR-2).
 *
 * Single backend pass produces the envelope; no re-aggregation client-side.
 * Cache key in `AnalyticsService` includes `supplier_id`/`category_id`/
 * `date_from`/`date_to` so the drill-down from the report does
 * not leak across filters.
 */
@Component({
  selector: 'vendix-inventory-low-stock-by-supplier',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    ChartComponent,
    CurrencyPipe,
    IconComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    AnalyticsCardComponent,
  ],
  templateUrl: './inventory-low-stock-by-supplier.component.html',
  styleUrls: ['./inventory-low-stock-by-supplier.component.scss'],
})
export class InventoryLowStockBySupplierComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // ─── Tab + filter state ────────────────────────────────────────────────────

  readonly activeTab = signal<TabId>('summary');
  readonly supplierId = signal<number | null>(null);
  readonly categoryId = signal<number | null>(null);
  /**
   * `date_from` / `date_to` are inherited from the parent DTO and bound
   * the `history_30d` series. Renamed from the historical `history_from`
   * /`history_to` to match the parent DTO (Major R2-M6). They are still
   * optional and unused by the UI today — the analytics page does not
   * expose a date picker — but keeping them in sync with the backend
   * prevents a future 400 from `forbidNonWhitelisted`.
   */
  readonly dateFrom = signal<string | null>(null);
  readonly dateTo = signal<string | null>(null);

  // ─── Envelope + chart state ────────────────────────────────────────────────

  readonly envelope = signal<LowStockBySupplierAnalyticsEnvelope | null>(null);
  readonly loading = signal<boolean>(false);
  readonly exporting = signal<boolean>(false);

  readonly statusDonutOptions = signal<EChartsOption>({});
  readonly topCriticalBarOptions = signal<EChartsOption>({});
  readonly bySupplierBarOptions = signal<EChartsOption>({});
  readonly byCategoryBarOptions = signal<EChartsOption>({});
  readonly historyLineOptions = signal<EChartsOption>({});

  // Pagination for the top-critical table.
  readonly criticalPage = signal<number>(1);
  readonly criticalLimit = signal<number>(10);
  readonly criticalTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.envelope()?.top_critical.length ?? 0) / this.criticalLimit()),
  );

  readonly inventoryViews: AnalyticsView[] = getViewsByCategory('inventory').filter(
    (v) => v.key !== 'inventory_low_stock_by_supplier',
  );

  readonly criticalColumns: TableColumn[] = [
    {
      key: 'product_name',
      label: 'Producto',
      sortable: false,
      priority: 1,
      transform: (v: unknown) => String(v ?? '-'),
    },
    {
      key: 'sku',
      label: 'SKU',
      sortable: false,
      priority: 2,
      width: '110px',
      transform: (v: unknown) => (v ? String(v) : '-'),
    },
    {
      key: 'supplier_name',
      label: 'Proveedor',
      sortable: false,
      priority: 2,
      transform: (v: unknown) => (v ? String(v) : 'Sin proveedor'),
    },
    {
      key: 'current_stock',
      label: 'Stock',
      sortable: false,
      align: 'right',
      priority: 1,
      width: '90px',
      transform: (v: unknown) => Number(v ?? 0).toLocaleString('es-CO'),
    },
    {
      key: 'min_threshold',
      label: 'Mínimo',
      sortable: false,
      align: 'right',
      priority: 2,
      width: '90px',
      transform: (v: unknown) => Number(v ?? 0).toLocaleString('es-CO'),
    },
    {
      key: 'status',
      label: 'Estado',
      sortable: false,
      align: 'center',
      priority: 1,
      width: '120px',
      badgeConfig: {
        type: 'custom',
        colorMap: {
          out_of_stock: '#ef4444',
          low_stock: '#f59e0b',
        },
      },
      transform: (v: unknown) =>
        v === 'out_of_stock' ? 'Sin stock' : 'Bajo stock',
    },
    {
      key: 'value_at_risk',
      label: 'Valor en riesgo',
      sortable: false,
      align: 'right',
      priority: 1,
      width: '140px',
      transform: (v: unknown) => Number(v ?? 0).toLocaleString('es-CO'),
    },
  ];

  readonly criticalCardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    subtitleKey: 'sku',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      colorMap: {
        out_of_stock: '#ef4444',
        low_stock: '#f59e0b',
      },
    },
    badgeTransform: (v: unknown) =>
      v === 'out_of_stock' ? 'Sin stock' : 'Bajo stock',
    detailKeys: [
      {
        key: 'supplier_name',
        label: 'Proveedor',
        icon: 'truck',
        transform: (v: unknown) => (v ? String(v) : 'Sin proveedor'),
      },
      {
        key: 'current_stock',
        label: 'Stock',
        icon: 'package',
        transform: (v: unknown) => `${Number(v ?? 0).toLocaleString('es-CO')} uds`,
      },
      {
        key: 'value_at_risk',
        label: 'Valor en riesgo',
        icon: 'dollar-sign',
        transform: (v: unknown) => Number(v ?? 0).toLocaleString('es-CO'),
      },
    ],
  };

  readonly pagedTopCritical = computed(() => {
    const list = this.envelope()?.top_critical ?? [];
    const start = (this.criticalPage() - 1) * this.criticalLimit();
    return list.slice(start, start + this.criticalLimit());
  });

  /**
   * Major R2-M5 — render the `cost_coverage` warning under the
   * "Valor en Riesgo" KPI. Mirrors the pattern in
   * `overview-summary.component.ts#incompleteCostText`.
   */
  readonly costCoverageWarning = computed<string>(() => {
    const coverage = this.envelope()?.cost_coverage;
    if (!coverage || coverage.units_without_cost === 0) return '';
    const known = coverage.units_total - coverage.units_without_cost;
    const pct = (coverage.coverage_ratio * 100).toFixed(0);
    return `${known} de ${coverage.units_total} con costo conocido (${pct}%). El valor en riesgo puede estar subestimado hasta registrar el costo faltante.`;
  });

  constructor() {
    // Read query params from the analytics shell entry point.
    const qp = this.route.snapshot.queryParamMap;
    const tab = qp.get('tab');
    if (tab === 'summary' || tab === 'by-supplier' || tab === 'by-category' || tab === 'history') {
      this.activeTab.set(tab);
    }
    const supplierId = qp.get('supplier_id');
    if (supplierId && !isNaN(Number(supplierId))) {
      this.supplierId.set(Number(supplierId));
    }
    const categoryId = qp.get('category_id');
    if (categoryId && !isNaN(Number(categoryId))) {
      this.categoryId.set(Number(categoryId));
    }

    this.refresh();
  }

  // ─── Loaders ───────────────────────────────────────────────────────────────

  /**
   * Single fetch for the whole envelope. Filters are forwarded as
   * query params and become part of the cache key in
   * `AnalyticsService.getLowStockBySupplierAnalytics`.
   */
  refresh(): void {
    const query: Record<string, any> = {};
    const supplierId = this.supplierId();
    if (supplierId !== null) query['supplier_id'] = supplierId;
    const categoryId = this.categoryId();
    if (categoryId !== null) query['category_id'] = categoryId;
    if (this.dateFrom()) query['date_from'] = this.dateFrom();
    if (this.dateTo()) query['date_to'] = this.dateTo();

    this.loading.set(true);
    this.analyticsService
      .getLowStockBySupplierAnalytics(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const env = res.data ?? null;
          this.envelope.set(env);
          if (env) {
            // Render every chart off the same envelope so all four tabs
            // share a single source of truth.
            this.updateStatusDonut(env);
            this.updateTopCriticalBar(env);
            this.updateBySupplierBar(env);
            this.updateByCategoryBar(env);
            this.updateHistoryLine(env);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error(
            'No se pudo cargar la analítica de stock bajo por proveedor.',
          );
        },
      });
  }

  // ─── Tab handlers ──────────────────────────────────────────────────────────

  setTab(tab: TabId): void {
    this.activeTab.set(tab);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * FB-07 — drill-down from chart → report. Click on a supplier bar to
   * open the report page filtered to that supplier.
   *
   * Major R2-M7 — `supplier_id === null` is the "Sin proveedor asignado"
   * bucket. Angular drops `null` from `queryParams`, so we forward
   * `without_supplier: true` instead; the backend DTO now accepts that
   * flag and filters to `supplier_id IS NULL`.
   */
  openSupplierReport(supplierId: number | null): void {
    const queryParams: Record<string, string | number | boolean> =
      supplierId === null
        ? { without_supplier: true }
        : { supplier_id: supplierId };
    this.router.navigate(
      ['/admin/reports/inventory/inventory-low-stock-by-supplier'],
      { queryParams },
    );
  }

  onCriticalPageChange(page: number): void {
    this.criticalPage.set(page);
  }

  // ─── Chart builders ────────────────────────────────────────────────────────

  private getThemeColors() {
    const style =
      typeof document !== 'undefined'
        ? getComputedStyle(document.documentElement)
        : null;
    return {
      border: style?.getPropertyValue('--color-border').trim() || '#e5e7eb',
      textSecondary:
        style?.getPropertyValue('--color-text-secondary').trim() || '#6b7280',
    };
  }

  private updateStatusDonut(env: LowStockBySupplierAnalyticsEnvelope): void {
    const { textSecondary } = this.getThemeColors();
    const low = env.kpis.total_low_stock || 0;
    const out = env.kpis.total_out_of_stock || 0;
    this.statusDonutOptions.set({
      tooltip: {
        trigger: 'item',
        formatter: (p: any) =>
          `${p.name}<br/><b>${p.value.toLocaleString('es-CO')}</b> productos (${p.percent}%)`,
      },
      legend: {
        bottom: 0,
        textStyle: { color: textSecondary },
      },
      series: [
        {
          name: 'Distribución',
          type: 'pie',
          radius: ['45%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: '#fff',
            borderWidth: 2,
          },
          label: {
            show: true,
            formatter: '{b}: {c}',
            color: textSecondary,
          },
          data: [
            { name: 'Bajo stock', value: low, itemStyle: { color: '#f59e0b' } },
            { name: 'Sin stock', value: out, itemStyle: { color: '#ef4444' } },
          ],
        },
      ],
    });
  }

  private updateTopCriticalBar(env: LowStockBySupplierAnalyticsEnvelope): void {
    const { border, textSecondary } = this.getThemeColors();
    const top = [...env.top_critical]
      .sort((a, b) => b.value_at_risk - a.value_at_risk)
      .slice(0, 10);

    this.topCriticalBarOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}<br/>Valor en riesgo: <b>${p.value.toLocaleString(
            'es-CO',
          )}</b>`;
        },
      },
      grid: { left: '3%', right: '4%', bottom: '8%', top: '4%', containLabel: true },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => compactCountAxis(v),
        },
        splitLine: { lineStyle: { color: border } },
      },
      yAxis: {
        type: 'category',
        data: top.map((p) => p.product_name),
        axisLine: { lineStyle: { color: border } },
        axisLabel: {
          color: textSecondary,
          formatter: (val: string) => truncateLabel(val, 22),
        },
      },
      series: [
        {
          name: 'Valor en riesgo',
          type: 'bar',
          data: top.map((p) => p.value_at_risk),
          itemStyle: { color: '#ef4444' },
          barMaxWidth: 18,
        },
      ],
    });
  }

  private updateBySupplierBar(env: LowStockBySupplierAnalyticsEnvelope): void {
    const { border, textSecondary } = this.getThemeColors();
    const list = env.by_supplier ?? [];

    this.bySupplierBarOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          const bucket = list[p.dataIndex];
          const supplier = bucket?.supplier_name ?? 'Sin proveedor';
          const low = bucket?.low_stock_count ?? 0;
          const out = bucket?.out_of_stock_count ?? 0;
          return `<b>${supplier}</b><br/>Valor en riesgo: ${p.value.toLocaleString(
            'es-CO',
          )}<br/>Bajo: ${low} · Sin stock: ${out}<br/><i>Click para abrir el reporte</i>`;
        },
      },
      grid: { left: '3%', right: '4%', bottom: '4%', top: '6%', containLabel: true },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => compactCountAxis(v),
        },
        splitLine: { lineStyle: { color: border } },
      },
      yAxis: {
        type: 'category',
        data: list.map((s) => s.supplier_name),
        axisLine: { lineStyle: { color: border } },
        axisLabel: {
          color: textSecondary,
          formatter: (val: string) => truncateLabel(val, 24),
        },
      },
      series: [
        {
          name: 'Valor en riesgo',
          type: 'bar',
          data: list.map((s) => s.value_at_risk),
          itemStyle: { color: '#3b82f6' },
          barMaxWidth: 18,
        },
      ],
    });
  }

  private updateByCategoryBar(env: LowStockBySupplierAnalyticsEnvelope): void {
    const { border, textSecondary } = this.getThemeColors();
    const list = env.by_category ?? [];
    this.byCategoryBarOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          const bucket = list[p.dataIndex];
          return `<b>${p.name}</b><br/>Bajo: ${bucket?.low_stock_count ?? 0}<br/>Sin stock: ${bucket?.out_of_stock_count ?? 0}`;
        },
      },
      legend: {
        bottom: 0,
        data: ['Bajo stock', 'Sin stock'],
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '4%', bottom: '14%', top: '6%', containLabel: true },
      xAxis: {
        type: 'category',
        data: list.map((c) => c.category_name),
        axisLine: { lineStyle: { color: border } },
        axisLabel: {
          color: textSecondary,
          formatter: (val: string) => truncateLabel(val, 16),
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => compactCountAxis(v),
        },
        splitLine: { lineStyle: { color: border } },
      },
      series: [
        {
          name: 'Bajo stock',
          type: 'bar',
          stack: 'total',
          data: list.map((c) => c.low_stock_count),
          itemStyle: { color: '#f59e0b' },
          barMaxWidth: 32,
        },
        {
          name: 'Sin stock',
          type: 'bar',
          stack: 'total',
          data: list.map((c) => c.out_of_stock_count),
          itemStyle: { color: '#ef4444' },
          barMaxWidth: 32,
        },
      ],
    });
  }

  private updateHistoryLine(env: LowStockBySupplierAnalyticsEnvelope): void {
    const series = env.history_30d ?? [];
    const { border, textSecondary } = this.getThemeColors();

    this.historyLineOptions.set({
      tooltip: { trigger: 'axis' },
      legend: {
        bottom: 0,
        data: ['Bajo stock', 'Sin stock'],
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '4%', bottom: '14%', top: '6%', containLabel: true },
      xAxis: {
        type: 'category',
        data: series.map((p) => p.date),
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => compactCountAxis(v),
        },
        splitLine: { lineStyle: { color: border } },
      },
      series: [
        {
          name: 'Bajo stock',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: series.map((p) => p.low_stock_count),
          lineStyle: { color: '#f59e0b' },
          itemStyle: { color: '#f59e0b' },
        },
        {
          name: 'Sin stock',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: series.map((p) => p.out_of_stock_count),
          lineStyle: { color: '#ef4444' },
          itemStyle: { color: '#ef4444' },
        },
      ],
    });
  }

  /**
   * echarts click → drill into the report filtered by the supplier.
   * Wrapped so the template can call it without `$any` casts.
   */
  onSupplierChartClick(event: any): void {
    const idx = event?.dataIndex;
    if (typeof idx !== 'number') return;
    const bucket = this.envelope()?.by_supplier?.[idx];
    if (!bucket) return;
    this.openSupplierReport(bucket.supplier_id);
  }

  // ─── Export ────────────────────────────────────────────────────────────────

  exportXlsx(): void {
    const query: Record<string, any> = {};
    const supplierId = this.supplierId();
    if (supplierId !== null) query['supplier_id'] = supplierId;
    const categoryId = this.categoryId();
    if (categoryId !== null) query['category_id'] = categoryId;

    this.exporting.set(true);
    this.analyticsService
      .exportLowStockBySupplier(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `stock_bajo_por_proveedor_${new Date()
            .toISOString()
            .slice(0, 10)}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.exporting.set(false);
          this.toastService.error('No se pudo exportar el reporte');
        },
      });
  }

  // ─── KPI getters ───────────────────────────────────────────────────────────

  getTotalLowStock(): number {
    return this.envelope()?.kpis.total_low_stock ?? 0;
  }
  getTotalOutOfStock(): number {
    return this.envelope()?.kpis.total_out_of_stock ?? 0;
  }
  getValueAtRisk(): number {
    return this.envelope()?.kpis.total_value_at_risk ?? 0;
  }
  getProductsWithoutSupplier(): number {
    return this.envelope()?.kpis.products_without_supplier ?? 0;
  }
  getAvgDaysWithoutSale(): string {
    const v = this.envelope()?.kpis.avg_days_without_sale;
    return v === null || v === undefined ? '∞' : `${v.toFixed(1)} d`;
  }

  hasHistory(): boolean {
    return (this.envelope()?.history_30d?.length ?? 0) > 0;
  }
}
