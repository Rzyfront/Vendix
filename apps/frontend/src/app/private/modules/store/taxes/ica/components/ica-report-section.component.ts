import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { IcaService } from '../services/ica.service';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';

export interface IcaReportBreakdownEntry {
  municipality: string;
  municipality_code: string;
  base: number;
  ica_amount: number;
  rate_per_mil: number;
  invoice_count: number;
}

export interface IcaReport {
  period: string;
  date_range: { start: string; end: string };
  total_base: number;
  total_ica: number;
  invoice_count: number;
  breakdown: IcaReportBreakdownEntry[];
}

type IcaPeriodType = 'month' | 'quarter' | 'year';

@Component({
  selector: 'app-ica-report-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SelectorComponent],
  template: `
    <div class="bg-[var(--color-surface)] rounded-lg shadow mt-4">
      <div class="p-4 border-b border-border">
        <h2 class="text-lg font-semibold text-text-primary">Reporte ICA por Período</h2>
        <div class="flex flex-col md:flex-row gap-3 mt-3 md:items-end">
          <div class="w-full md:w-36">
            <app-selector
              label="Año"
              [options]="yearOptions"
              [ngModel]="selectedYear()"
              (ngModelChange)="onYearChange($event)"
            ></app-selector>
          </div>
          <div class="w-full md:w-44">
            <app-selector
              label="Periodicidad"
              [options]="periodTypeOptions"
              [ngModel]="periodType()"
              (ngModelChange)="onPeriodTypeChange($event)"
            ></app-selector>
          </div>
          @if (periodType() === 'month') {
            <div class="w-full md:w-44">
              <app-selector
                label="Mes"
                [options]="monthOptions"
                [ngModel]="selectedMonth()"
                (ngModelChange)="onMonthChange($event)"
              ></app-selector>
            </div>
          }
          @if (periodType() === 'quarter') {
            <div class="w-full md:w-44">
              <app-selector
                label="Trimestre"
                [options]="quarterOptions"
                [ngModel]="selectedQuarter()"
                (ngModelChange)="onQuarterChange($event)"
              ></app-selector>
            </div>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="p-8 text-center text-text-secondary text-sm">Cargando reporte...</div>
      } @else if (report(); as r) {
        <!-- Summary -->
        <div class="grid grid-cols-3 gap-4 p-4 border-b border-border">
          <div>
            <p class="text-xs text-text-secondary uppercase">Base Gravable</p>
            <p class="text-lg font-semibold text-text-primary">{{ formatCurrency(r.total_base) }}</p>
          </div>
          <div>
            <p class="text-xs text-text-secondary uppercase">Total ICA</p>
            <p class="text-lg font-semibold text-text-primary">{{ formatCurrency(r.total_ica) }}</p>
          </div>
          <div>
            <p class="text-xs text-text-secondary uppercase">Facturas</p>
            <p class="text-lg font-semibold text-text-primary">{{ r.invoice_count }}</p>
          </div>
        </div>

        <!-- Breakdown table -->
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-[var(--color-border)]">
            <thead class="bg-[var(--color-surface-secondary)]">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Municipio</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Base</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Tarifa ‰</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">ICA</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase"># Facturas</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[var(--color-border)]">
              @for (row of r.breakdown; track row.municipality_code) {
                <tr class="hover:bg-[var(--color-surface-secondary)]">
                  <td class="px-4 py-3 text-sm">
                    {{ row.municipality }}
                    <span class="text-text-secondary">({{ row.municipality_code }})</span>
                  </td>
                  <td class="px-4 py-3 text-sm text-right">{{ formatCurrency(row.base) }}</td>
                  <td class="px-4 py-3 text-sm text-right">{{ row.rate_per_mil }}‰</td>
                  <td class="px-4 py-3 text-sm text-right font-medium">{{ formatCurrency(row.ica_amount) }}</td>
                  <td class="px-4 py-3 text-sm text-right">{{ row.invoice_count }}</td>
                </tr>
              }
              @empty {
                <tr>
                  <td colspan="5" class="px-4 py-8 text-center text-text-secondary">
                    Sin movimientos ICA en el período seleccionado
                  </td>
                </tr>
              }
              @if (r.breakdown.length > 0) {
                <tr class="bg-[var(--color-surface-secondary)] font-semibold">
                  <td class="px-4 py-3 text-sm">Totales</td>
                  <td class="px-4 py-3 text-sm text-right">{{ formatCurrency(r.total_base) }}</td>
                  <td class="px-4 py-3 text-sm text-right">—</td>
                  <td class="px-4 py-3 text-sm text-right">{{ formatCurrency(r.total_ica) }}</td>
                  <td class="px-4 py-3 text-sm text-right">{{ r.invoice_count }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="p-8 text-center text-text-secondary text-sm">
          No se pudo cargar el reporte para el período seleccionado
        </div>
      }
    </div>
  `,
})
export class IcaReportSectionComponent {
  private service = inject(IcaService);
  private currencyService = inject(CurrencyFormatService);
  private destroyRef = inject(DestroyRef);

  readonly periodType = signal<IcaPeriodType>('month');
  readonly selectedYear = signal(new Date().getFullYear());
  readonly selectedMonth = signal(new Date().getMonth() + 1);
  readonly selectedQuarter = signal(Math.floor(new Date().getMonth() / 3) + 1);

  readonly report = signal<IcaReport | null>(null);
  readonly loading = signal(false);

  readonly period = computed<string>(() => {
    const year = this.selectedYear();
    switch (this.periodType()) {
      case 'month':
        return `${year}-${String(this.selectedMonth()).padStart(2, '0')}`;
      case 'quarter':
        return `${year}-Q${this.selectedQuarter()}`;
      default:
        return `${year}`;
    }
  });

  readonly yearOptions: SelectorOption[] = Array.from({ length: 5 }, (_, i) => {
    const year = new Date().getFullYear() - i;
    return { value: year, label: String(year) };
  });

  readonly periodTypeOptions: SelectorOption[] = [
    { value: 'month', label: 'Mensual' },
    { value: 'quarter', label: 'Trimestral' },
    { value: 'year', label: 'Anual' },
  ];

  readonly monthOptions: SelectorOption[] = [
    { value: 1, label: 'Enero' }, { value: 2, label: 'Febrero' },
    { value: 3, label: 'Marzo' }, { value: 4, label: 'Abril' },
    { value: 5, label: 'Mayo' }, { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' }, { value: 8, label: 'Agosto' },
    { value: 9, label: 'Septiembre' }, { value: 10, label: 'Octubre' },
    { value: 11, label: 'Noviembre' }, { value: 12, label: 'Diciembre' },
  ];

  readonly quarterOptions: SelectorOption[] = [
    { value: 1, label: 'Q1 (Ene-Mar)' },
    { value: 2, label: 'Q2 (Abr-Jun)' },
    { value: 3, label: 'Q3 (Jul-Sep)' },
    { value: 4, label: 'Q4 (Oct-Dic)' },
  ];

  constructor() {
    this.loadReport();
  }

  onYearChange(value: string | number | null): void {
    if (value == null) return;
    this.selectedYear.set(Number(value));
    this.loadReport();
  }

  onPeriodTypeChange(value: string | number | null): void {
    if (value == null) return;
    this.periodType.set(value as IcaPeriodType);
    this.loadReport();
  }

  onMonthChange(value: string | number | null): void {
    if (value == null) return;
    this.selectedMonth.set(Number(value));
    this.loadReport();
  }

  onQuarterChange(value: string | number | null): void {
    if (value == null) return;
    this.selectedQuarter.set(Number(value));
    this.loadReport();
  }

  private loadReport(): void {
    this.loading.set(true);
    this.service.getReport(this.period())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.report.set(res.data || null);
          this.loading.set(false);
        },
        error: () => {
          this.report.set(null);
          this.loading.set(false);
        },
      });
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0, 0);
  }
}
