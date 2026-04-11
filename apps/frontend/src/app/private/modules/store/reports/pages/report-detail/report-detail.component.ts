import { Component, inject, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { Subject, takeUntil } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ReportTableComponent } from '../../components/report-table/report-table.component';
import { SummaryReportComponent } from '../../components/summary-report/summary-report.component';
import { NestedReportComponent } from '../../components/nested-report/nested-report.component';
import { AgingReportComponent } from '../../components/aging-report/aging-report.component';
import { DateRangeFilterComponent } from '../../../analytics/components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../../analytics/components/export-button/export-button.component';
import { DateRangeFilter } from '../../../analytics/interfaces/analytics.interface';
import { SummaryLayoutConfig } from '../../interfaces/report.interface';
import { ReportsActions } from '../../state/reports.actions';
import {
  selectSelectedReport,
  selectDateRange,
  selectReportData,
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
import { selectFiscalPeriods } from '../../../accounting/state/selectors/accounting.selectors';
import * as AccountingActions from '../../../accounting/state/actions/accounting.actions';

@Component({
  selector: 'vendix-report-detail',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    ReportTableComponent,
    SummaryReportComponent,
    NestedReportComponent,
    AgingReportComponent,
    DateRangeFilterComponent,
    ExportButtonComponent,
    ButtonComponent,
    SelectorComponent,
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

  // Pagination computed values
  paginationStart = computed(() => ((this.currentPage() - 1) * this.itemsPerPage()) + 1);
  paginationEnd = computed(() => {
    const end = this.currentPage() * this.itemsPerPage();
    return end < this.totalItems() ? end : this.totalItems();
  });

  // Pagination helpers
  showPagination(): boolean {
    return this.getReportType() === 'list' && this.totalItems() > 0;
  }

  onPageChange(page: number): void {
    this.store.dispatch(ReportsActions.setPage({ page }));
    this.store.dispatch(ReportsActions.loadReportData());
  }

  onItemsPerPageChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = Number(select.value);
    this.store.dispatch(ReportsActions.setItemsPerPage({ itemsPerPage: value }));
    this.store.dispatch(ReportsActions.loadReportData());
  }

  getPageNumbers(): number[] {
    const total = this.totalPages();
    const current = this.currentPage();
    const pages: number[] = [];

    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (current > 3) pages.push(-1); // ellipsis
      for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
        pages.push(i);
      }
      if (current < total - 2) pages.push(-1); // ellipsis
      pages.push(total);
    }

    return pages;
  }
}
