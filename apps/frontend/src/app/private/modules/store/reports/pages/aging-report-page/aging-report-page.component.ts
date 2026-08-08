import { Component, inject, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReportsActions } from '../../state/reports.actions';
import {
  selectSelectedReport,
  selectReportData,
  selectSummaryData,
  selectLoading,
  selectIsForbidden,
  selectDateRange,
} from '../../state/reports.selectors';
import { ReportViewerComponent } from '../../components/report-viewer/report-viewer.component';
import { AgingReportComponent } from '../../components/aging-report/aging-report.component';
import { ReportColumn } from '../../interfaces/report.interface';

/**
 * Wrapper para reports de tipo "aging" (QUI-539 cartera clientes,
 * QUI-540 cuentas por cobrar, QUI-542 CxP proveedores). Usa el
 * `app-aging-report` con buckets coloreados (verde/amarillo/naranja/
 * rojo/rojo fuerte para 0-30/31-60/61-90/90+) + skeleton + empty
 * state. Envuelve también el `ReportViewerComponent` para stats cards,
 * filtro de fecha y botón export.
 */
@Component({
  selector: 'app-aging-report-page',
  standalone: true,
  imports: [ReportViewerComponent, AgingReportComponent],
  template: `
    <div class="flex flex-col gap-6">
      <app-report-viewer
        [report]="report() ?? null"
        [data]="[]"
        [summaryData]="summaryData() ?? null"
        [loading]="!!loading()"
        [isForbidden]="!!forbidden()"
        [dateRange]="dateRange()"
        (dateRangeChange)="onDateRangeChange($event)"
        (exportClick)="onExportClick()"
      ></app-report-viewer>

      @if (report() && agingRows().length > 0) {
        <app-aging-report
          [data]="agingRows()"
          [columns]="agingColumns()"
          [loading]="!!loading()"
          [entityLabel]="report()!.title"
        />
      }
    </div>
  `,
})
export class AgingReportPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private store = inject(Store);

  readonly report = toSignal(this.store.select(selectSelectedReport));
  readonly data = toSignal(this.store.select(selectReportData));
  readonly summaryData = toSignal(this.store.select(selectSummaryData));
  readonly loading = toSignal(this.store.select(selectLoading));
  readonly forbidden = toSignal(this.store.select(selectIsForbidden));
  readonly dateRange = toSignal(this.store.select(selectDateRange));

  readonly agingColumns = computed<ReportColumn[]>(() => {
    const report = this.report();
    if (!report) return [];
    return [
      {
        key: 'entity_label',
        header: report.columns[0]?.header ?? 'Entidad',
        type: 'text',
      },
      { key: 'current_amount', header: 'Corriente', type: 'currency' },
      { key: '1_30_amount', header: '1-30 días', type: 'currency' },
      { key: '31_60_amount', header: '31-60 días', type: 'currency' },
      { key: '61_90_amount', header: '61-90 días', type: 'currency' },
      { key: '90_plus_amount', header: '90+ días', type: 'currency' },
      { key: 'total_amount', header: 'Total', type: 'currency', footer: 'sum' },
    ];
  });

  readonly agingRows = computed<any[]>(() => {
    const rows = this.data();
    if (!rows || !rows.length) return [];
    const amountKey = this.detectAmountKey(rows[0]);
    return rows.map((r) => this.toAgingRow(r, amountKey));
  });

  ngOnInit(): void {
    const data = this.route.snapshot.data;
    const reportId = data['reportId'] || this.route.snapshot.paramMap.get('id');
    if (!reportId) return;
    this.store.dispatch(ReportsActions.selectReport({ reportId }));
  }

  onDateRangeChange(range: any): void {
    this.store.dispatch(ReportsActions.setDateRange({ dateRange: range }));
    // loadReportData lee el reportId del state via loadReportData$
    // effect, no necesita prop.
    this.store.dispatch(ReportsActions.loadReportData());
  }

  onExportClick(): void {
    this.store.dispatch(ReportsActions.exportReport());
  }

  private detectAmountKey(row: any): string {
    for (const k of ['balance', 'total_amount', 'amount', 'lifetime_value', 'total_spent']) {
      if (typeof row[k] === 'number' || typeof row[k] === 'string') return k;
    }
    return 'amount';
  }

  private toAgingRow(row: any, amountKey: string): any {
    const amount = Number(row[amountKey] ?? 0);
    const bucket = (row['aging_bucket'] ?? '').toString();
    return {
      entity_label: this.buildEntityLabel(row),
      current_amount: bucket === '0-30' ? amount : 0,
      '1_30_amount': bucket === '0-30' ? amount : 0,
      '31_60_amount': bucket === '31-60' ? amount : 0,
      '61_90_amount': bucket === '61-90' ? amount : 0,
      '90_plus_amount': bucket === '90+' ? amount : 0,
      total_amount: amount,
    };
  }

  private buildEntityLabel(row: any): string {
    return (
      row['customer_name'] ??
      row['supplier_name'] ??
      row['document_number'] ??
      row['order_number'] ??
      'Entidad'
    ).toString();
  }
}
