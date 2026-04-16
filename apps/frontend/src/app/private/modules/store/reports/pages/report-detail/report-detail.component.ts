import { Component, inject, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { Subject, takeUntil } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ResponsiveDataViewComponent, TableColumn, ItemListCardConfig } from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { SummaryReportComponent } from '../../components/summary-report/summary-report.component';
import { NestedReportComponent } from '../../components/nested-report/nested-report.component';
import { AgingReportComponent } from '../../components/aging-report/aging-report.component';
import { DateRangeFilterComponent } from '../../../analytics/components/date-range-filter/date-range-filter.component';
import { DateRangeFilter } from '../../../analytics/interfaces/analytics.interface';
import { SummaryLayoutConfig } from '../../interfaces/report.interface';
import { ReportsActions } from '../../state/reports.actions';
import {
  selectSelectedReport,
  selectDateRange,
  selectReportData,
  selectReportMeta,
  selectLoading,
  selectExporting,
  selectError,
  selectIsSummary,
  selectSummaryData,
  selectCurrentPage,
  selectTotalPages,
  selectTotalItems,
  selectItemsPerPage,
} from '../../state/reports.selectors';
import { getCategoryById, getReportById } from '../../config/report-registry';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { StickyHeaderComponent, StickyHeaderActionButton, StickyHeaderBadgeColor } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { selectFiscalPeriods } from '../../../accounting/state/selectors/accounting.selectors';
import * as AccountingActions from '../../../accounting/state/actions/accounting.actions';

@Component({
  selector: 'vendix-report-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    ResponsiveDataViewComponent,
    SummaryReportComponent,
    NestedReportComponent,
    AgingReportComponent,
    DateRangeFilterComponent,
    ButtonComponent,
    SelectorComponent,
    StickyHeaderComponent,
    CardComponent,
    StatsComponent,
    EmptyStateComponent,
    PaginationComponent,
  ],
  templateUrl: './report-detail.component.html',
  styleUrls: ['./report-detail.component.scss'],
})
export class ReportDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private store = inject(Store);
  private destroy$ = new Subject<void>();

  // State from NgRx
  report = toSignal(this.store.select(selectSelectedReport));
  private dateRange$ = toSignal(this.store.select(selectDateRange));
  dateRange = computed<DateRangeFilter | undefined>(() => this.dateRange$());
  reportData = toSignal(this.store.select(selectReportData));
  loading = toSignal(this.store.select(selectLoading));
  exporting = toSignal(this.store.select(selectExporting));
  error = toSignal(this.store.select(selectError));
  isSummary = toSignal(this.store.select(selectIsSummary));
  summaryData = toSignal(this.store.select(selectSummaryData));
  reportMeta = toSignal(this.store.select(selectReportMeta));

  // Pagination signals
  currentPage = toSignal(this.store.select(selectCurrentPage), { initialValue: 1 });
  totalPages = toSignal(this.store.select(selectTotalPages), { initialValue: 1 });
  totalItems = toSignal(this.store.select(selectTotalItems), { initialValue: 0 });
  itemsPerPage = toSignal(this.store.select(selectItemsPerPage), { initialValue: 25 });

  // Fiscal Periods (from accounting state)
  fiscalPeriods = toSignal(this.store.select(selectFiscalPeriods), { initialValue: [] });

  fiscalPeriodOptions = computed<SelectorOption[]>(() =>
    this.fiscalPeriods().map((p) => ({
      value: p.id,
      label: p.name,
    })),
  );

  // Local state
  hasGenerated = signal(false);

  listSummaryStats = computed(() => {
    if (!this.hasGenerated() || this.getReportType() !== 'list') return [];
    const report = this.report();
    const data = this.reportData();
    if (!report || !data?.length) return [];

    const footerCols = report.columns.filter(c => c.footer);
    return footerCols.slice(0, 4).map(col => {
      const values = data.map(r => Number(r[col.key]) || 0);
      let value: number;
      switch (col.footer) {
        case 'sum': value = values.reduce((a, b) => a + b, 0); break;
        case 'average': value = values.reduce((a, b) => a + b, 0) / values.length; break;
        case 'count': value = values.length; break;
        default: value = 0;
      }
      return { key: col.key, label: col.header, value, type: col.type };
    });
  });

  categoryLabel = computed(() => {
    const r = this.report();
    if (!r) return '';
    return getCategoryById(r.category)?.label || '';
  });

  categoryColor = computed(() => {
    const r = this.report();
    if (!r) return '';
    return getCategoryById(r.category)?.color || 'var(--color-primary)';
  });

  categoryBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    const category = this.report()?.category;
    const map: Record<string, StickyHeaderBadgeColor> = {
      sales: 'green',
      inventory: 'blue',
      products: 'yellow',
      customers: 'blue',
      accounting: 'gray',
      payroll: 'yellow',
      financial: 'green',
    };
    return map[category || ''] || 'blue';
  });

  hasExportableData = computed(() =>
    this.hasGenerated() && (
      (this.reportData() && this.reportData()!.length > 0) || this.isSummary()
    )
  );

  headerActions = computed<StickyHeaderActionButton[]>(() => {
    const r = this.report();
    const actions: StickyHeaderActionButton[] = [];

    if (this.hasExportableData()) {
      actions.push({
        id: 'export',
        label: 'Exportar',
        icon: 'download',
        variant: 'outline' as const,
        loading: !!this.exporting(),
      });
    }

    if (r?.fullViewRoute) {
      actions.push({
        id: 'full-view',
        label: 'Ver completo',
        icon: 'external-link',
        variant: 'ghost' as const,
      });
    }

    return actions;
  });

  onHeaderAction(actionId: string): void {
    if (actionId === 'export') this.exportReport();
    if (actionId === 'full-view') this.goToFullView();
  }

  ngOnInit(): void {
    this.route.paramMap
      .pipe(takeUntil(this.destroy$))
      .subscribe((params) => {
        const reportId = params.get('reportId');
        if (reportId) {
          this.store.dispatch(ReportsActions.selectReport({ reportId }));
          this.hasGenerated.set(false);
          if (getReportById(reportId)?.requiresFiscalPeriod) {
            this.store.dispatch(AccountingActions.loadFiscalPeriods());
          }
        }
      });
  }

  ngOnDestroy(): void {
    this.store.dispatch(ReportsActions.clearReport());
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  onDateRangeChange(dateRange: DateRangeFilter): void {
    this.store.dispatch(ReportsActions.setDateRange({
      dateRange: {
        start_date: dateRange.start_date,
        end_date: dateRange.end_date,
        preset: dateRange.preset || 'custom',
      },
    }));
  }

  generateReport(): void {
    this.hasGenerated.set(true);
    this.store.dispatch(ReportsActions.loadReportData());
  }

  exportReport(): void {
    this.store.dispatch(ReportsActions.exportReport());
  }

  goToFullView(): void {
    const r = this.report();
    if (r?.fullViewRoute) {
      this.router.navigateByUrl(r.fullViewRoute);
    }
  }

  onFiscalPeriodChange(value: string | number | null): void {
    const id = value !== null ? Number(value) : null;
    this.store.dispatch(ReportsActions.setFiscalPeriod({ fiscalPeriodId: id }));
  }

  getReportType(): 'summary' | 'nested' | 'aging' | 'list' {
    const r = this.report();
    if (!r) return 'list';
    if (this.isSummary()) return 'summary';
    if (r.id === 'customer-aging' || r.id === 'accounts-payable-aging') return 'aging';
    if (r.type === 'nested') return 'nested';
    return 'list';
  }

  getSummaryLayout(): SummaryLayoutConfig {
    const r = this.report();
    if (r?.summaryLayout) return r.summaryLayout;
    // Fallback: generate layout from columns
    return {
      fields: r!.columns.map((col) => ({
        key: col.key,
        label: col.header,
        type: col.type as 'currency' | 'number' | 'text' | 'percentage',
      })),
    };
  }

  // --- Data Display: convert ReportColumn[] → TableColumn[] + ItemListCardConfig ---
  private currencyPipe = new CurrencyPipe('es-CO');
  private decimalPipe = new DecimalPipe('es-CO');
  private percentPipe = new PercentPipe('es-CO');
  private datePipe = new DatePipe('es-CO');

  private formatReportValue(value: any, type: string): string {
    if (value == null || value === '') return '—';
    switch (type) {
      case 'currency': return this.currencyPipe.transform(value, 'COP', 'symbol-narrow', '1.0-0') || String(value);
      case 'date': return this.datePipe.transform(value, 'dd MMM yyyy') || String(value);
      case 'number': return this.decimalPipe.transform(value, '1.0-2') || String(value);
      case 'percentage': return this.percentPipe.transform(value / 100, '1.1-1') || String(value);
      default: return String(value);
    }
  }

  tableColumns = computed<TableColumn[]>(() => {
    const r = this.report();
    if (!r) return [];
    return r.columns.map(col => ({
      key: col.key,
      label: col.header,
      align: col.align || (['number', 'currency', 'percentage'].includes(col.type) ? 'right' as const : 'left' as const),
      transform: (value: any) => this.formatReportValue(value, col.type),
    }));
  });

  cardConfig = computed<ItemListCardConfig>(() => {
    const r = this.report();
    if (!r) return { titleKey: 'id' };

    const cols = r.columns;
    const textCol = cols.find(c => c.type === 'text');
    const currencyCol = cols.find(c => c.type === 'currency');
    const detailCols = cols.filter(c => c !== textCol && c !== currencyCol);

    return {
      titleKey: textCol?.key || cols[0].key,
      detailKeys: detailCols.map(c => ({
        key: c.key,
        label: c.header,
        transform: (value: any) => this.formatReportValue(value, c.type),
      })),
      ...(currencyCol ? {
        footerKey: currencyCol.key,
        footerLabel: currencyCol.header,
        footerTransform: (value: any) => this.formatReportValue(value, 'currency'),
        footerStyle: 'prominent' as const,
      } : {}),
    };
  });

  getEmptyDescription(): string {
    const r = this.report();
    if (!r) return '';
    if (r.requiresDateRange && r.requiresFiscalPeriod)
      return 'Selecciona el periodo y el periodo fiscal, luego haz clic en "Generar Reporte"';
    if (r.requiresDateRange)
      return 'Selecciona el rango de fechas y haz clic en "Generar Reporte"';
    if (r.requiresFiscalPeriod)
      return 'Selecciona el periodo fiscal y haz clic en "Generar Reporte"';
    return 'Haz clic en "Generar Reporte" para ver los datos';
  }

  formatStatValue(value: number, type: string): string {
    if (type === 'currency')
      return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value);
    if (type === 'percentage') return `${value.toFixed(1)}%`;
    return new Intl.NumberFormat('es-CO').format(value);
  }

  getStatIcon(type: string): string {
    const map: Record<string, string> = { currency: 'dollar-sign', number: 'hash', percentage: 'percent', text: 'file-text' };
    return map[type] || 'bar-chart-2';
  }

  getStatColor(type: string): { bg: string; fg: string } {
    const map: Record<string, { bg: string; fg: string }> = {
      currency: { bg: 'rgba(139, 92, 246, 0.1)', fg: '#8b5cf6' },
      number: { bg: 'rgba(59, 130, 246, 0.1)', fg: '#3b82f6' },
      percentage: { bg: 'rgba(16, 185, 129, 0.1)', fg: '#10b981' },
    };
    return map[type] || { bg: 'rgba(107, 114, 128, 0.1)', fg: '#6b7280' };
  }

  // Pagination
  pageSizeOptions: SelectorOption[] = [
    { value: 10, label: '10 por página' },
    { value: 25, label: '25 por página' },
    { value: 50, label: '50 por página' },
    { value: 100, label: '100 por página' },
  ];

  showPagination(): boolean {
    return this.getReportType() === 'list' && this.totalItems() > 0;
  }

  onPageChange(page: number): void {
    this.store.dispatch(ReportsActions.setPage({ page }));
    this.store.dispatch(ReportsActions.loadReportData());
  }

  onItemsPerPageChange(value: string | number | null): void {
    if (value == null) return;
    this.store.dispatch(ReportsActions.setItemsPerPage({ itemsPerPage: Number(value) }));
    this.store.dispatch(ReportsActions.loadReportData());
  }
}
