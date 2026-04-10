import { Component, input, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { ReportColumn } from '../../interfaces/report.interface';

@Component({
  selector: 'vendix-report-table',
  standalone: true,
  imports: [CommonModule],
  providers: [CurrencyPipe, DatePipe, DecimalPipe, PercentPipe],
  templateUrl: './report-table.component.html',
  styleUrls: ['./report-table.component.scss'],
})
export class ReportTableComponent {
  columns = input.required<ReportColumn[]>();
  data = input.required<any[]>();
  loading = input(false);

  private currencyPipe = new CurrencyPipe('es-CO');
  private datePipe = new DatePipe('es-CO');
  private decimalPipe = new DecimalPipe('es-CO');
  private percentPipe = new PercentPipe('es-CO');

  hasFooter = computed(() => this.columns().some(col => col.footer));

  footerValues = computed(() => {
    const cols = this.columns();
    const rows = this.data();
    if (!rows.length) return {};

    const result: Record<string, any> = {};
    for (const col of cols) {
      if (!col.footer) continue;
      const values = rows.map(r => Number(r[col.key]) || 0);
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

  formatValue(value: any, column: ReportColumn): string {
    if (value == null || value === '') return '—';
    switch (column.type) {
      case 'currency':
        return this.currencyPipe.transform(value, 'COP', 'symbol-narrow', '1.0-0') || String(value);
      case 'date':
        return this.datePipe.transform(value, 'dd MMM yyyy') || String(value);
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
}
