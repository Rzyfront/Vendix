import { Component, input, computed, signal } from '@angular/core';
import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ReportColumn } from '../../interfaces/report.interface';

interface GroupedSection {
  name: string;
  rows: any[];
  total: number;
}

@Component({
  selector: 'app-nested-report',
  standalone: true,
  imports: [IconComponent],
  providers: [CurrencyPipe, DecimalPipe, PercentPipe],
  templateUrl: './nested-report.component.html',
  styleUrls: ['./nested-report.component.scss'],
})
export class NestedReportComponent {
  data = input.required<any[]>();
  columns = input.required<ReportColumn[]>();
  readonly loadingInput = input(false, { alias: 'loading' });
  private readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());

  private currencyPipe = new CurrencyPipe('es-CO');
  private decimalPipe = new DecimalPipe('es-CO');
  private percentPipe = new PercentPipe('es-CO');

  openSections = signal<Set<string>>(new Set());

  sections = computed<GroupedSection[]>(() => {
    const rows = this.data();
    if (!rows || rows.length === 0) return [];

    const groupKey = rows.some((r) => r.section != null) ? 'section' : 'group';
    const grouped = new Map<string, any[]>();

    for (const row of rows) {
      const key = String(row[groupKey] ?? 'Sin clasificar');
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(row);
    }

    const result: GroupedSection[] = [];
    for (const [name, sectionRows] of grouped) {
      const amountKey = this.getAmountColumnKey();
      const total = sectionRows.reduce((sum, r) => sum + (Number(r[amountKey]) || 0), 0);
      result.push({ name, rows: sectionRows, total });
    }

    return result;
  });

  skeletonSections = [1, 2, 3];
  skeletonRows = [1, 2, 3, 4];

  private getAmountColumnKey(): string {
    const cols = this.columns();
    const currencyCol = cols.find((c) => c.type === 'currency');
    return currencyCol?.key ?? 'amount';
  }

  toggleSection(name: string): void {
    this.openSections.update((set) => {
      const next = new Set(set);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  isOpen(name: string): boolean {
    return this.openSections().has(name);
  }

  isTotalRow(row: any): boolean {
    return row.is_total === true || row.isTotal === true;
  }

  hasSubItems(row: any): boolean {
    return row.level != null && row.level > 0;
  }

  formatCurrency(value: any): string {
    if (value == null) return '—';
    return this.currencyPipe.transform(value, 'COP', 'symbol-narrow', '1.0-0') || String(value);
  }

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

  isAccountCodeColumn(column: ReportColumn): boolean {
    const key = column.key.toLowerCase();
    return key.includes('account_code') || key.includes('accountcode') || key.includes('codigo');
  }

  trackByColumn(index: number, col: ReportColumn): string {
    return col.key;
  }

  trackByRowIndex(index: number): number {
    return index;
  }
}
