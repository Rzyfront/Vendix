import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WithholdingTaxService } from './services/withholding-tax.service';
import { WithholdingConcept, WithholdingStats } from './interfaces/withholding.interface';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-withholding-tax',
  standalone: true,
  imports: [StatsComponent],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="sticky top-0 z-20 bg-white dark:bg-gray-900 pb-2 md:static md:z-auto">
        <div class="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible">
          <app-stats title="Conceptos Activos" [value]="stats()?.active_concepts || 0" icon="file-text" color="blue"></app-stats>
          <app-stats title="UVT Vigente" [value]="formatCurrency(stats()?.current_uvt || 0)" icon="calculator" color="green"></app-stats>
          <app-stats title="Ret. del Mes" [value]="formatCurrency(stats()?.month_withholdings || 0)" icon="trending-down" color="orange"></app-stats>
          <app-stats title="Ret. del Año" [value]="formatCurrency(stats()?.year_withholdings || 0)" icon="calendar" color="purple"></app-stats>
        </div>
      </div>

      <!-- Concepts Table -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow mt-4">
        <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Conceptos de Retención</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead class="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Código</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tasa %</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Umbral UVT</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Aplica a</th>
                <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Estado</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              @for (concept of concepts(); track concept.id) {
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td class="px-4 py-3 text-sm font-mono">{{ concept.code }}</td>
                  <td class="px-4 py-3 text-sm">{{ concept.name }}</td>
                  <td class="px-4 py-3 text-sm text-right">{{ (concept.rate * 100).toFixed(1) }}%</td>
                  <td class="px-4 py-3 text-sm text-right hidden md:table-cell">{{ concept.min_uvt_threshold }}</td>
                  <td class="px-4 py-3 text-sm hidden md:table-cell capitalize">{{ concept.applies_to }}</td>
                  <td class="px-4 py-3 text-sm text-center">
                    <span [class]="concept.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'"
                          class="px-2 py-1 rounded-full text-xs font-medium">
                      {{ concept.is_active ? 'Activo' : 'Inactivo' }}
                    </span>
                  </td>
                </tr>
              }
              @empty {
                <tr>
                  <td colspan="6" class="px-4 py-8 text-center text-gray-500">No hay conceptos de retención configurados</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class WithholdingTaxComponent {
  private service = inject(WithholdingTaxService);
  private currencyService = inject(CurrencyFormatService);
  private destroyRef = inject(DestroyRef);

  concepts = signal<WithholdingConcept[]>([]);
  stats = signal<WithholdingStats | null>(null);

  constructor() {
    this.loadData();
  }

  loadData() {
    this.service.getConcepts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res: any) => {
        this.concepts.set(res.data || []);
      });
    this.service.getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res: any) => {
        this.stats.set(res.data || null);
      });
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0, 0);
  }
}
