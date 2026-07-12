import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IcaService } from './services/ica.service';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency/currency.pipe';
import { IcaReportSectionComponent } from './components/ica-report-section.component';

@Component({
  selector: 'app-ica-rates',
  standalone: true,
  imports: [StatsComponent, IcaReportSectionComponent],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="sticky top-0 z-20 bg-background pb-2 md:static md:z-auto">
        <div class="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible">
          <app-stats title="Tarifa Actual" [value]="storeRate()?.rate_per_mil ? storeRate()!.rate_per_mil + '‰' : 'N/A'" icon="percent" color="blue"></app-stats>
          <app-stats title="Municipio" [value]="storeRate()?.municipality_name || 'No configurado'" icon="map-pin" color="green"></app-stats>
          <app-stats title="ICA del Mes" [value]="monthIca()" icon="trending-up" color="orange"></app-stats>
          <app-stats title="ICA del Año" [value]="yearIca()" icon="calendar" color="purple"></app-stats>
        </div>
      </div>

      <!-- Store Rate -->
      @if (storeRate()) {
        <div class="bg-[var(--color-info-light)] border border-[var(--color-info)] rounded-lg p-4 mt-4">
          <h3 class="font-medium text-[var(--color-info)]">Tarifa ICA de tu tienda</h3>
          <p class="text-sm text-[var(--color-info)] mt-1">
            Municipio: <strong>{{ storeRate()!.municipality_name }}</strong> |
            Código: {{ storeRate()!.municipality_code }} |
            Tarifa: <strong>{{ storeRate()!.rate_per_mil }}‰</strong>
          </p>
        </div>
      }

      <!-- Report by Period -->
      <app-ica-report-section></app-ica-report-section>

      <!-- Rates Table -->
      <div class="bg-[var(--color-surface)] rounded-lg shadow mt-4">
        <div class="p-4 border-b border-border">
          <h2 class="text-lg font-semibold text-text-primary">Tarifas ICA por Municipio</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-[var(--color-border)]">
            <thead class="bg-[var(--color-surface-secondary)]">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Municipio</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase hidden md:table-cell">Departamento</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase hidden md:table-cell">CIIU</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Tarifa ‰</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[var(--color-border)]">
              @for (rate of rates(); track rate.id) {
                <tr class="hover:bg-[var(--color-surface-secondary)]">
                  <td class="px-4 py-3 text-sm">{{ rate.municipality_name }} <span class="text-text-secondary">({{ rate.municipality_code }})</span></td>
                  <td class="px-4 py-3 text-sm hidden md:table-cell">{{ rate.department_name }}</td>
                  <td class="px-4 py-3 text-sm hidden md:table-cell">{{ rate.ciiu_code || 'General' }}</td>
                  <td class="px-4 py-3 text-sm text-right font-medium">{{ rate.rate_per_mil }}‰</td>
                </tr>
              }
              @empty {
                <tr>
                  <td colspan="4" class="px-4 py-8 text-center text-text-secondary">No hay tarifas ICA disponibles</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class IcaRatesComponent {
  private service = inject(IcaService);
  private currencyService = inject(CurrencyFormatService);
  private destroyRef = inject(DestroyRef);

  rates = signal<any[]>([]);
  storeRate = signal<any>(null);
  monthIca = signal('—');
  yearIca = signal('—');

  constructor() {
    this.service.getRates({ limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res: any) => {
        this.rates.set(res.data || []);
      });
    this.service.resolveStoreRate()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => { this.storeRate.set(res.data || null); },
        error: () => { /* Store may not have municipality configured */ },
      });
    this.loadIcaTotals();
  }

  private loadIcaTotals(): void {
    const now = new Date();
    const monthPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const yearPeriod = `${now.getFullYear()}`;

    this.service.getReport(monthPeriod)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.monthIca.set(this.formatCurrency(res.data?.total_ica));
        },
        error: () => this.monthIca.set('—'),
      });

    this.service.getReport(yearPeriod)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.yearIca.set(this.formatCurrency(res.data?.total_ica));
        },
        error: () => this.yearIca.set('—'),
      });
  }

  private formatCurrency(value: any): string {
    return this.currencyService.format(Number(value) || 0, 0);
  }
}
