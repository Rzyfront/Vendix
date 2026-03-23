import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IcaService } from './services/ica.service';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';

@Component({
  selector: 'app-ica-rates',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="sticky top-0 z-20 bg-white dark:bg-gray-900 pb-2 md:static md:z-auto">
        <div class="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible">
          <app-stats title="Tarifa Actual" [value]="storeRate()?.rate_per_mil ? storeRate()!.rate_per_mil + '‰' : 'N/A'" icon="percent" color="blue"></app-stats>
          <app-stats title="Municipio" [value]="storeRate()?.municipality_name || 'No configurado'" icon="map-pin" color="green"></app-stats>
          <app-stats title="ICA del Mes" [value]="'$0'" icon="trending-up" color="orange"></app-stats>
          <app-stats title="ICA del Año" [value]="'$0'" icon="calendar" color="purple"></app-stats>
        </div>
      </div>

      <!-- Store Rate -->
      @if (storeRate()) {
        <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mt-4">
          <h3 class="font-medium text-blue-900 dark:text-blue-300">Tarifa ICA de tu tienda</h3>
          <p class="text-sm text-blue-700 dark:text-blue-400 mt-1">
            Municipio: <strong>{{ storeRate()!.municipality_name }}</strong> |
            Código: {{ storeRate()!.municipality_code }} |
            Tarifa: <strong>{{ storeRate()!.rate_per_mil }}‰</strong>
          </p>
        </div>
      }

      <!-- Rates Table -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow mt-4">
        <div class="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Tarifas ICA por Municipio</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead class="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Municipio</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Departamento</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">CIIU</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tarifa ‰</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              @for (rate of rates(); track rate.id) {
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td class="px-4 py-3 text-sm">{{ rate.municipality_name }} <span class="text-gray-400">({{ rate.municipality_code }})</span></td>
                  <td class="px-4 py-3 text-sm hidden md:table-cell">{{ rate.department_name }}</td>
                  <td class="px-4 py-3 text-sm hidden md:table-cell">{{ rate.ciiu_code || 'General' }}</td>
                  <td class="px-4 py-3 text-sm text-right font-medium">{{ rate.rate_per_mil }}‰</td>
                </tr>
              }
              @empty {
                <tr>
                  <td colspan="4" class="px-4 py-8 text-center text-gray-500">No hay tarifas ICA disponibles</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class IcaRatesComponent implements OnInit {
  private service = inject(IcaService);

  rates = signal<any[]>([]);
  storeRate = signal<any>(null);

  ngOnInit() {
    this.service.getRates({ limit: 50 }).subscribe((res: any) => {
      this.rates.set(res.data || []);
    });
    this.service.resolveStoreRate().subscribe({
      next: (res: any) => { this.storeRate.set(res.data || null); },
      error: () => { /* Store may not have municipality configured */ },
    });
  }
}
