import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { map } from 'rxjs';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
} from '../../../../../../shared/components/index';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  ExogenousReport,
  ExogenousStats,
} from '../../../../store/exogenous/interfaces/exogenous.interface';
import { OrgExogenousService } from './services/org-exogenous.service';

interface ExogenousFormat {
  readonly code: string;
  readonly label: string;
}

/**
 * Organization-scoped exógena (información exógena DIAN) view.
 *
 * Mirrors the store exógena UX (stats + generate/validate controls + reports
 * table) but reads the shell-synced `?store_id` from the URL and fetches via
 * the org service so reports can be consolidated or scoped to a single store.
 */
@Component({
  selector: 'vendix-org-exogenous',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Generados"
          [value]="stats()?.total_reports ?? reports().length"
          smallText="Reportes generados"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Pendientes"
          [value]="stats()?.by_status?.['generated'] || 0"
          smallText="Por enviar"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
        <app-stats
          title="Enviados"
          [value]="stats()?.by_status?.['submitted'] || 0"
          smallText="Presentados a la DIAN"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Rechazados"
          [value]="stats()?.by_status?.['rejected'] || 0"
          smallText="Requieren corrección"
          iconName="x-circle"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar la información exógena">
          {{ msg }}
        </app-alert-banner>
      }

      @if (feedback(); as msg) {
        <app-alert-banner [variant]="feedbackVariant()" title="Validación de datos">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" class="mt-3 block">
        <h2 class="text-base font-semibold text-text-primary md:text-lg">Generar Reporte</h2>
        <div class="mt-4 flex flex-col gap-4 md:flex-row md:items-end">
          <div>
            <label class="mb-1 block text-sm font-medium text-text-secondary">Año Fiscal</label>
            <input
              type="number"
              [value]="selectedYear()"
              (input)="onYearInput($event)"
              class="block w-32 rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:ring-primary"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-text-secondary">Formato</label>
            <select
              [value]="selectedFormat()"
              (change)="onFormatChange($event)"
              class="block w-64 rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:ring-primary"
            >
              @for (format of formats; track format.code) {
                <option [value]="format.code">{{ format.code }} - {{ format.label }}</option>
              }
            </select>
          </div>
          <app-button variant="primary" [loading]="generating()" (clicked)="generate()">
            Generar
          </app-button>
          <app-button variant="secondary" [loading]="validating()" (clicked)="validate()">
            Validar Datos
          </app-button>
        </div>
      </app-card>

      <app-card [responsive]="true" [padding]="false" class="mt-3 block">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <div>
              <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
                Reportes Generados ({{ reports().length }})
              </h2>
              <p class="hidden text-sm text-text-secondary md:block">
                Reportes de información exógena del alcance fiscal seleccionado.
              </p>
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="reports()"
            [columns]="tableColumns"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin reportes"
            emptyMessage="Sin reportes"
            emptyDescription="No hay reportes de exógena para el alcance fiscal seleccionado."
            emptyIcon="file-text"
            [showEmptyAction]="false"
          />
        </div>
      </app-card>
    </div>
  `,
})
export class OrgExogenousComponent {
  private readonly service = inject(OrgExogenousService);
  private readonly errors = inject(ApiErrorService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly storeId = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('store_id'))),
    { initialValue: this.route.snapshot.queryParamMap.get('store_id') },
  );

  readonly loading = signal(true);
  readonly generating = signal(false);
  readonly validating = signal(false);
  readonly reports = signal<ExogenousReport[]>([]);
  readonly stats = signal<ExogenousStats | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly feedback = signal<string | null>(null);
  readonly feedbackVariant = signal<'success' | 'warning'>('success');

  readonly selectedYear = signal(new Date().getFullYear());
  readonly selectedFormat = signal('1007');

  readonly formats: ExogenousFormat[] = [
    { code: '1001', label: 'Retenciones practicadas' },
    { code: '1005', label: 'IVA descontable y generado' },
    { code: '1007', label: 'Ingresos recibidos' },
    { code: '1008', label: 'Saldos cuentas por cobrar' },
    { code: '1009', label: 'Saldos cuentas por pagar' },
  ];

  private readonly statusLabels: Record<string, string> = {
    draft: 'Borrador',
    generating: 'Generando',
    generated: 'Generado',
    validated: 'Validado',
    submitted: 'Enviado',
    rejected: 'Rechazado',
  };

  readonly tableColumns: TableColumn[] = [
    {
      key: 'format_code',
      label: 'Formato',
      priority: 1,
      cellClass: () => 'font-mono',
      transform: (value, row) => (row?.format_name ? `${value} - ${row.format_name}` : String(value)),
    },
    { key: 'fiscal_year', label: 'Año', sortable: true, priority: 1 },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          generated: 'info',
          validated: 'success',
          submitted: 'success',
          rejected: 'danger',
          draft: 'default',
          generating: 'warning',
        },
      },
      transform: (value) => this.statusLabel(String(value || '')),
    },
    { key: 'total_records', label: 'Registros', align: 'right', sortable: true, priority: 2 },
    {
      key: 'total_amount',
      label: 'Monto Total',
      align: 'right',
      priority: 2,
      transform: (value) => this.formatCurrency(Number(value) || 0),
    },
    {
      key: 'generated_at',
      label: 'Generado',
      priority: 3,
      transform: (value) => this.formatDate(value as string | null),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'format_code',
    titleTransform: (item) => `${item.format_code}${item.format_name ? ' - ' + item.format_name : ''}`,
    subtitleTransform: (item) => `Año ${item.fiscal_year}`,
    avatarFallbackIcon: 'file-text',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: { type: 'status' },
    badgeTransform: (value) => this.statusLabel(String(value || '')),
    detailKeys: [
      { key: 'total_records', label: 'Registros', icon: 'list', transform: (value) => String(value ?? 0) },
      { key: 'total_amount', label: 'Monto', icon: 'dollar-sign', transform: (value) => this.formatCurrency(Number(value) || 0) },
      { key: 'generated_at', label: 'Generado', icon: 'calendar', transform: (value) => this.formatDate(value as string | null) },
    ],
  };

  constructor() {
    this.route.queryParamMap
      .pipe(
        switchMap((params) => {
          this.loading.set(true);
          this.errorMessage.set(null);
          const storeId = params.get('store_id');
          this.loadStats();
          return this.service.getReports(storeId ? { store_id: storeId } : undefined);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.reports.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar los reportes de exógena.'),
          );
          this.reports.set([]);
          this.loading.set(false);
        },
      });
  }

  private scopeQuery(extra?: Record<string, any>): Record<string, any> | undefined {
    const storeId = this.storeId();
    const query = { ...(storeId ? { store_id: storeId } : {}), ...(extra ?? {}) };
    return Object.keys(query).length ? query : undefined;
  }

  private loadStats(): void {
    this.service
      .getStats(this.selectedYear(), this.scopeQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.stats.set(res?.data ?? null),
        error: () => this.stats.set(null),
      });
  }

  private reloadReports(): void {
    this.loading.set(true);
    this.service
      .getReports(this.scopeQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.reports.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar los reportes de exógena.'),
          );
          this.loading.set(false);
        },
      });
  }

  onYearInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isNaN(value) && value > 0) {
      this.selectedYear.set(value);
    }
  }

  onFormatChange(event: Event): void {
    this.selectedFormat.set((event.target as HTMLSelectElement).value);
  }

  generate(): void {
    this.generating.set(true);
    this.feedback.set(null);
    this.service
      .generateReport(
        { fiscal_year: this.selectedYear(), format_code: this.selectedFormat() },
        this.scopeQuery(),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.generating.set(false);
          this.loadStats();
          this.reloadReports();
        },
        error: (err) => {
          this.generating.set(false);
          this.errorMessage.set(this.errors.humanize(err, 'No se pudo generar el reporte.'));
        },
      });
  }

  validate(): void {
    this.validating.set(true);
    this.feedback.set(null);
    this.service
      .validateYear(this.selectedYear(), this.scopeQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.validating.set(false);
          const data = res?.data;
          if (data?.is_complete) {
            this.feedbackVariant.set('success');
            this.feedback.set('Datos completos. No se encontraron errores.');
          } else {
            this.feedbackVariant.set('warning');
            this.feedback.set(
              `Se encontraron ${data?.error_count ?? 0} errores de completitud. Revise los NITs faltantes.`,
            );
          }
        },
        error: (err) => {
          this.validating.set(false);
          this.errorMessage.set(this.errors.humanize(err, 'No se pudieron validar los datos.'));
        },
      });
  }

  statusLabel(status: string): string {
    return this.statusLabels[status] || status || '—';
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0, 0);
  }

  formatDate(value: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
}
