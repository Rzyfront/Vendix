import { Component, input, computed } from '@angular/core';
import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { ReportColumn } from '../../interfaces/report.interface';

@Component({
  selector: 'app-aging-report',
  standalone: true,
  imports: [],
  providers: [CurrencyPipe, DecimalPipe, PercentPipe],
  templateUrl: './aging-report.component.html',
  styleUrls: ['./aging-report.component.scss'],
})
export class AgingReportComponent {
  data = input.required<any[]>();
  columns = input.required<ReportColumn[]>();
  loading = input(false);
  entityLabel = input('Entidad');

  private currencyPipe = new CurrencyPipe('es-CO');
  private decimalPipe = new DecimalPipe('es-CO');
  private percentPipe = new PercentPipe('es-CO');

  private readonly agingColumns = [
    'current',
    'current_amount',
    '1_30',
    '1-30',
    '1_30_days',
    '31_60',
    '31-60',
    '31_60_days',
    '61_90',
    '61-90',
    '61_90_days',
    '91_120',
    '91-120',
    '91_120_days',
    '120_plus',
    '120+',
    'over_120',
    'total',
    'total_amount',
  ];

  hasFooter = computed(() => this.columns().some((col) => col.footer));

  footerValues = computed(() => {
    const cols = this.columns();
    const rows = this.data();
    if (!rows.length) return {};

    const result: Record<string, any> = {};
    for (const col of cols) {
      if (!col.footer) continue;
      const values = rows.map((r) => Number(r[col.key]) || 0);
      switch (col.footer) {
        case 'sum':
          result[col.key] = values.reduce((a, b) => a + b, 0);
          break;
        case 'average':
          result[col.key] = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case 'count':
          result[col.key] = values.length;
          break;
      }
    }
    return result;
  });

  skeletonRows = [1, 2, 3, 4, 5];

  formatValue(value: any, column: ReportColumn): string {
    if (value == null || value === '') return '—';
    switch (column.type) {
      case 'currency':
        return this.currencyPipe.transform(value, 'COP', 'symbol-narrow', '1.0-0') || String(value);
      case 'number':
        return this.decimalPipe.transform(value, '1.0-2') || String(value);
      case 'percentage':
        return this.percentPipe.transform(value / 100, '1.1-1') || String(value);
      default:
        return String(value);
    }
  }

  getAlign(column: ReportColumn): string {
    if (column.align) return column.align;
    return ['number', 'currency', 'percentage'].includes(column.type) ? 'right' : 'left';
  }

  getAgingClass(column: ReportColumn): string {
    const key = column.key.toLowerCase();
    if (key.includes('current')) return 'aging-current';
    if (key.includes('1_30') || key.includes('1-30')) return 'aging-1-30';
    if (key.includes('31_60') || key.includes('31-60')) return 'aging-31-60';
    if (key.includes('61_90') || key.includes('61-90')) return 'aging-61-90';
    if (key.includes('91') || key.includes('120') || key.includes('over')) return 'aging-90-plus';
    return '';
  }

  isAgingColumn(column: ReportColumn): boolean {
    const key = column.key.toLowerCase();
    return (
      key.includes('current') ||
      key.includes('1_30') ||
      key.includes('1-30') ||
      key.includes('31_60') ||
      key.includes('31-60') ||
      key.includes('61_90') ||
      key.includes('61-90') ||
      key.includes('91') ||
      key.includes('120') ||
      key.includes('over')
    );
  }

  isOverdue(column: ReportColumn, row: any): boolean {
    if (!this.isAgingColumn(column)) return false;
    const key = column.key.toLowerCase();
    // Anything beyond current is overdue
    if (key.includes('current')) return false;
    const value = Number(row[column.key]) || 0;
    return value > 0;
  }
}
