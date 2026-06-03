import { Component, input, computed, signal } from '@angular/core';
import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { SummaryLayoutConfig, SummaryField } from '../../interfaces/report.interface';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';

const FIELD_ICONS: Record<string, string> = {
  total_revenue: 'dollar-sign',
  total_orders: 'shopping-cart',
  average_order_value: 'receipt',
  total_units_sold: 'package',
  total_customers: 'users',
  revenue_growth: 'trending-up',
  orders_growth: 'trending-up',
  total_purchases: 'truck',
  total_suppliers: 'building-2',
  total_products: 'package',
  low_stock_count: 'alert-triangle',
  inventory_value: 'warehouse',
  average_rating: 'star',
  total_reviews: 'message-square',
  response_rate: 'reply',
  five_star_count: 'star',
  one_star_count: 'thumbs-down',
};

@Component({
  selector: 'app-summary-report',
  standalone: true,
  imports: [StatsComponent],
  providers: [CurrencyPipe, DecimalPipe, PercentPipe],
  templateUrl: './summary-report.component.html',
  styleUrls: ['./summary-report.component.scss'],
})
export class SummaryReportComponent {
  summaryData = input.required<Record<string, any>>();
  layout = input.required<SummaryLayoutConfig>();
  readonly loadingInput = input(false, { alias: 'loading' });
  private readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());

  private currencyPipe = new CurrencyPipe('es-CO');
  private decimalPipe = new DecimalPipe('es-CO');
  private percentPipe = new PercentPipe('es-CO');

  hasSections = computed(() => !!this.layout().sections && this.layout().sections!.length > 0);
  sections = computed(() => this.layout().sections || []);
  flatFields = computed(() => this.layout().fields);
  hasData = computed(() => Object.keys(this.summaryData()).length > 0);

  readonly allFields = computed(() => {
    const l = this.layout();
    if (l.sections) return l.sections.flatMap((s) => s.fields);
    return l.fields;
  });

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

  getFieldIcon(field: SummaryField): string {
    return FIELD_ICONS[field.key] || 'bar-chart-3';
  }

  getFieldBg(field: SummaryField): string {
    switch (field.type) {
      case 'currency': return 'bg-blue-100';
      case 'percentage': return 'bg-green-100';
      case 'number': return 'bg-purple-100';
      default: return 'bg-gray-100';
    }
  }

  getFieldColor(field: SummaryField): string {
    switch (field.type) {
      case 'currency': return 'text-blue-600';
      case 'percentage': return 'text-green-600';
      case 'number': return 'text-purple-600';
      default: return 'text-gray-600';
    }
  }
}
