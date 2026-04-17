import { Component, input, computed } from '@angular/core';
import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { SummaryLayoutConfig, SummaryField } from '../../interfaces/report.interface';

@Component({
  selector: 'app-summary-report',
  standalone: true,
  imports: [],
  providers: [CurrencyPipe, DecimalPipe, PercentPipe],
  templateUrl: './summary-report.component.html',
  styleUrls: ['./summary-report.component.scss'],
})
export class SummaryReportComponent {
  summaryData = input.required<Record<string, any>>();
  layout = input.required<SummaryLayoutConfig>();
  loading = input(false);

  private currencyPipe = new CurrencyPipe('es-CO');
  private decimalPipe = new DecimalPipe('es-CO');
  private percentPipe = new PercentPipe('es-CO');

  hasSections = computed(() => !!this.layout().sections && this.layout().sections!.length > 0);

  sections = computed(() => this.layout().sections || []);

  flatFields = computed(() => this.layout().fields);

  hasData = computed(() => Object.keys(this.summaryData()).length > 0);

  skeletonRows = [1, 2, 3, 4, 5, 6];

  formatValue(value: any, field: SummaryField): string {
    if (value == null || value === '') return '—';
    switch (field.type) {
      case 'currency':
        return this.currencyPipe.transform(value, 'COP', 'symbol-narrow', '1.0-0') || String(value);
      case 'number':
        return this.decimalPipe.transform(value, field.format || '1.0-2') || String(value);
      case 'percentage':
        return this.percentPipe.transform(value / 100, '1.1-1') || String(value);
      default:
        return String(value);
    }
  }

  getValueClass(field: SummaryField): string {
    return field.type === 'currency' ? 'currency' : field.type === 'percentage' ? 'percentage' : '';
  }
}
