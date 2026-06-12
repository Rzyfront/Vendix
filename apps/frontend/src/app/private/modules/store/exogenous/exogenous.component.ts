import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ExogenousService } from './services/exogenous.service';
import {
  ExogenousDownloadResult,
  ExogenousReport,
  ExogenousStats,
  ExogenousValidationResult,
} from './interfaces/exogenous.interface';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import {
  ResponsiveDataViewComponent,
  ToastService,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { ExogenousValidationPanelComponent } from './components/exogenous-validation-panel.component';

@Component({
  selector: 'app-exogenous',
  standalone: true,
  imports: [
    FormsModule,
    StatsComponent,
    ResponsiveDataViewComponent,
    ExogenousValidationPanelComponent,
  ],
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
              <option value="2276">Formato 2276 — Rentas de trabajo (nómina)</option>
            </select>
          </div>
          <button (click)="generate()" [disabled]="generating()"
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
            {{ generating() ? 'Generando...' : 'Generar' }}
          </button>
          <button (click)="validate()" [disabled]="validating()"
            class="px-4 py-2 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium disabled:opacity-50">
            {{ validating() ? 'Validando...' : 'Validar Datos' }}
          </button>
        </div>
      </div>

      <!-- Validation Panel -->
      <app-exogenous-validation-panel [validation]="validation()"></app-exogenous-validation-panel>

      <!-- Reports List -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow mt-4">
        <div class="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Reportes Generados</h2>
        </div>
        <div class="p-2 md:p-4">
          <app-responsive-data-view
            [data]="reports()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [actions]="actions"
            emptyMessage="No hay reportes generados"
          />
        </div>
      </div>
    </div>
  `,
})
export class ExogenousComponent {
  private service = inject(ExogenousService);
  private currencyService = inject(CurrencyFormatService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  // Pagination exception: bounded reference data — one report per formato DIAN
  // (1001-1009, 2276) por año fiscal; the backend list stays in the tens of rows.
  reports = signal<ExogenousReport[]>([]);
  stats = signal<ExogenousStats | null>(null);
  generating = signal(false);
  validating = signal(false);
  validation = signal<ExogenousValidationResult | null>(null);
  selectedYear = new Date().getFullYear();
  selectedFormat = '1007';

  private readonly statusLabels: Record<string, string> = {
    draft: 'Borrador', generating: 'Generando', generated: 'Generado',
    validated: 'Validado', submitted: 'Enviado', rejected: 'Rechazado',
  };

  private readonly downloadableStatuses = ['generated', 'validated', 'submitted'];

  // ── Table / cards config ─────────────────────────────────────────
  columns: TableColumn[] = [
    {
      key: 'format_code',
      label: 'Formato',
      priority: 1,
      transform: (val: any, item: any) =>
        item?.format_name ? `${val} - ${item.format_name}` : String(val ?? '-'),
    },
    { key: 'fiscal_year', label: 'Año', priority: 1 },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          draft: '#9ca3af',
          generating: '#eab308',
          generated: '#3b82f6',
          validated: '#22c55e',
          submitted: '#16a34a',
          rejected: '#ef4444',
        },
      },
      transform: (val: any) => this.statusLabels[val] || val,
    },
    { key: 'total_records', label: 'Registros', align: 'right', priority: 2 },
    {
      key: 'total_amount',
      label: 'Monto Total',
      align: 'right',
      priority: 2,
      transform: (val: any) => this.formatCurrency(val),
    },
    {
      key: 'generated_at',
      label: 'Generado',
      priority: 3,
      transform: (val: any) => (val ? new Date(val).toLocaleString() : '-'),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'format_code',
    titleTransform: (item: ExogenousReport) =>
      item.format_name ? `${item.format_code} - ${item.format_name}` : item.format_code,
    subtitleKey: 'fiscal_year',
    subtitleTransform: (item: ExogenousReport) => `Año fiscal ${item.fiscal_year}`,
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        draft: '#9ca3af',
        generating: '#eab308',
        generated: '#3b82f6',
        validated: '#22c55e',
        submitted: '#16a34a',
        rejected: '#ef4444',
      },
    },
    badgeTransform: (val: any) => this.statusLabels[val] || String(val),
    detailKeys: [
      { key: 'total_records', label: 'Registros', icon: 'list' },
      {
        key: 'generated_at',
        label: 'Generado',
        icon: 'calendar',
        transform: (val: any) => (val ? new Date(val).toLocaleString() : '-'),
      },
    ],
    footerKey: 'total_amount',
    footerLabel: 'Monto Total',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.formatCurrency(val),
  };

  actions: TableAction[] = [
    {
      label: 'Descargar TXT',
      icon: 'download',
      variant: 'primary',
      action: (report: ExogenousReport) => this.download(report),
      show: (report: ExogenousReport) => this.downloadableStatuses.includes(report.status),
    },
    {
      label: 'Marcar enviado',
      icon: 'send',
      variant: 'success',
      action: (report: ExogenousReport) => this.submit(report),
      show: (report: ExogenousReport) => ['generated', 'validated'].includes(report.status),
    },
  ];

  constructor() {
    this.loadData();
  }

  loadData() {
    this.service.getReports()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res: any) => {
        this.reports.set(res.data || []);
      });
    this.service.getStats(this.selectedYear)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res: any) => {
        this.stats.set(res.data || null);
      });
  }

  generate() {
    this.generating.set(true);
    this.service.generateReport({ fiscal_year: this.selectedYear, format_code: this.selectedFormat })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.generating.set(false); this.loadData(); },
        error: () => {
          this.generating.set(false);
          this.toastService.show({ variant: 'error', description: 'Error generando el reporte' });
        },
      });
  }

  validate() {
    this.validating.set(true);
    this.service.validateYear(this.selectedYear)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.validation.set(res.data || null);
          this.validating.set(false);
        },
        error: () => {
          this.validating.set(false);
          this.toastService.show({ variant: 'error', description: 'Error validando los datos' });
        },
      });
  }

  download(report: ExogenousReport) {
    this.service.downloadReport(report.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const data: ExogenousDownloadResult | null = res.data || null;
          if (data?.download_url) {
            window.open(data.download_url, '_blank');
          } else {
            this.toastService.show({ variant: 'error', description: 'No se pudo obtener el enlace de descarga' });
          }
        },
        error: () => {
          this.toastService.show({ variant: 'error', description: 'Error descargando el archivo' });
        },
      });
  }

  submit(report: ExogenousReport) {
    this.service.submitReport(report.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.show({ variant: 'success', description: 'Reporte marcado como enviado' });
          this.loadData();
        },
        error: () => {
          this.toastService.show({ variant: 'error', description: 'Error marcando el reporte como enviado' });
        },
      });
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0, 0);
  }
}
