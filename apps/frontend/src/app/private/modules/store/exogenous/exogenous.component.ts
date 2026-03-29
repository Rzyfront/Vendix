import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExogenousService } from './services/exogenous.service';
import { ExogenousReport, ExogenousStats } from './interfaces/exogenous.interface';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-exogenous',
  standalone: true,
  imports: [CommonModule, FormsModule, StatsComponent],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="sticky top-0 z-20 bg-white dark:bg-gray-900 pb-2 md:static md:z-auto">
        <div class="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible">
          <app-stats title="Total Generados" [value]="stats()?.total_reports || 0" icon="file-text" color="blue"></app-stats>
          <app-stats title="Pendientes" [value]="stats()?.by_status?.['generated'] || 0" icon="clock" color="orange"></app-stats>
          <app-stats title="Enviados" [value]="stats()?.by_status?.['submitted'] || 0" icon="check-circle" color="green"></app-stats>
          <app-stats title="Rechazados" [value]="stats()?.by_status?.['rejected'] || 0" icon="x-circle" color="red"></app-stats>
        </div>
      </div>

      <!-- Generate Section -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow mt-4 p-4">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Generar Reporte</h2>
        <div class="flex flex-col md:flex-row gap-4 items-end">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Año Fiscal</label>
            <input type="number" [(ngModel)]="selectedYear" class="block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Formato</label>
            <select [(ngModel)]="selectedFormat" class="block w-64 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm px-3 py-2">
              <option value="1001">1001 - Retenciones practicadas</option>
              <option value="1005">1005 - IVA descontable y generado</option>
              <option value="1007">1007 - Ingresos recibidos</option>
              <option value="1008">1008 - Saldos cuentas por cobrar</option>
              <option value="1009">1009 - Saldos cuentas por pagar</option>
            </select>
          </div>
          <button (click)="generate()" [disabled]="generating()"
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
            {{ generating() ? 'Generando...' : 'Generar' }}
          </button>
          <button (click)="validate()"
            class="px-4 py-2 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium">
            Validar Datos
          </button>
        </div>
      </div>

      <!-- Reports Table -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow mt-4">
        <div class="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Reportes Generados</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead class="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Formato</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Año</th>
                <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Estado</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Registros</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Monto Total</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Generado</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              @for (report of reports(); track report.id) {
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td class="px-4 py-3 text-sm">
                    <span class="font-mono font-medium">{{ report.format_code }}</span>
                    <span class="text-gray-500 ml-1 hidden md:inline">- {{ report.format_name }}</span>
                  </td>
                  <td class="px-4 py-3 text-sm">{{ report.fiscal_year }}</td>
                  <td class="px-4 py-3 text-sm text-center">
                    <span [class]="getStatusClass(report.status)" class="px-2 py-1 rounded-full text-xs font-medium">
                      {{ getStatusLabel(report.status) }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-sm text-right">{{ report.total_records }}</td>
                  <td class="px-4 py-3 text-sm text-right hidden md:table-cell">{{ formatCurrency(report.total_amount) }}</td>
                  <td class="px-4 py-3 text-sm hidden md:table-cell">{{ report.generated_at ? (report.generated_at | date:'short') : '-' }}</td>
                </tr>
              }
              @empty {
                <tr>
                  <td colspan="6" class="px-4 py-8 text-center text-gray-500">No hay reportes generados</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class ExogenousComponent implements OnInit {
  private service = inject(ExogenousService);
  private currencyService = inject(CurrencyFormatService);

  reports = signal<ExogenousReport[]>([]);
  stats = signal<ExogenousStats | null>(null);
  generating = signal(false);
  selectedYear = new Date().getFullYear();
  selectedFormat = '1007';

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.service.getReports().subscribe((res: any) => {
      this.reports.set(res.data || []);
    });
    this.service.getStats(this.selectedYear).subscribe((res: any) => {
      this.stats.set(res.data || null);
    });
  }

  generate() {
    this.generating.set(true);
    this.service.generateReport({ fiscal_year: this.selectedYear, format_code: this.selectedFormat }).subscribe({
      next: () => { this.generating.set(false); this.loadData(); },
      error: () => { this.generating.set(false); },
    });
  }

  validate() {
    this.service.validateYear(this.selectedYear).subscribe((res: any) => {
      const data = res.data;
      if (data.is_complete) {
        alert('Datos completos. No se encontraron errores.');
      } else {
        alert(`Se encontraron ${data.error_count} errores de completitud. Revise los NITs faltantes.`);
      }
    });
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador', generating: 'Generando', generated: 'Generado',
      validated: 'Validado', submitted: 'Enviado', rejected: 'Rechazado',
    };
    return labels[status] || status;
  }

  getStatusClass(status: string): string {
    const classes: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-800', generating: 'bg-yellow-100 text-yellow-800',
      generated: 'bg-blue-100 text-blue-800', validated: 'bg-green-100 text-green-800',
      submitted: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800',
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0, 0);
  }
}
