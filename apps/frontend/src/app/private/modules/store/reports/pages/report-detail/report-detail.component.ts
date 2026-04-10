import { Component, inject, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { Subject, takeUntil } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ReportTableComponent } from '../../components/report-table/report-table.component';
import { DateRangeFilterComponent } from '../../../analytics/components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../../analytics/components/export-button/export-button.component';
import { DateRangeFilter } from '../../../analytics/interfaces/analytics.interface';
import { ReportsActions } from '../../state/reports.actions';
import {
  selectSelectedReport,
  selectDateRange,
  selectReportData,
  selectLoading,
  selectExporting,
  selectError,
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
}
