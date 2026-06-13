import {
  Component,
  inject,
  DestroyRef,
  signal,
  computed,
  viewChild,
  TemplateRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { PayrollService } from '../services/payroll.service';
import {
  PilaReport,
  PilaEmployeeRow,
  PilaTotals,
} from '../interfaces/payroll.interface';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { CardComponent } from '../../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../shared/components/selector/selector.component';
import {
  ResponsiveDataViewComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../shared/components/responsive-data-view/responsive-data-view.component';

const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const FLAG_LABELS: Record<string, string> = {
  vacation: 'Vacaciones',
  incapacity_general: 'Incap. General',
  incapacity_laboral: 'Incap. Laboral',
  unpaid_leave: 'Lic. No Remun.',
};

const FLAG_CLASSES: Record<string, string> = {
  vacation: 'bg-teal-100 text-teal-700',
  incapacity_general: 'bg-orange-100 text-orange-700',
  incapacity_laboral: 'bg-red-100 text-red-700',
  unpaid_leave: 'bg-gray-100 text-gray-600',
};

@Component({
  selector: 'vendix-payroll-pila-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    StatsComponent,
    CardComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Empleados"
          [value]="report()?.employees?.length || 0"
          smallText="Cotizantes del período"
          iconName="users"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="IBC Total"
          [value]="formatCurrency(totals().ibc || 0)"
          smallText="Base de cotización"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Seguridad Social"
          [value]="formatCurrency(socialSecurityTotal())"
          smallText="Salud + Pensión + ARL"
          iconName="shield-check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Total a Pagar"
          [value]="formatCurrency(totals().total || 0)"
          smallText="Planilla PILA"
          iconName="banknote"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <app-card
        [responsive]="true"
        [padding]="false"
        overflow="visible"
        customClasses="md:min-h-[600px]"
      >
        <!-- Header: período + export -->
        <div
          class="px-2 py-2 md:px-6 md:py-4 md:border-b md:border-border flex flex-col gap-2 md:flex-row md:justify-between md:items-end"
        >
          <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:text-text-primary">
            Reporte PILA
          </h2>
          <div class="flex items-end gap-2 w-full md:w-auto">
            <div class="flex-1 md:w-32">
              <app-selector
                label="Año"
                size="sm"
                [formControl]="yearControl"
                [options]="yearOptions"
              ></app-selector>
            </div>
            <div class="flex-1 md:w-40">
              <app-selector
                label="Mes"
                size="sm"
                [formControl]="monthControl"
                [options]="monthOptions"
              ></app-selector>
            </div>
            <app-button
              variant="outline"
              size="sm"
              (clicked)="onExportCsv()"
              [loading]="exporting()"
              [disabled]="loading() || tableData().length === 0"
            >
              <app-icon slot="icon" name="download" [size]="14" class="mr-1"></app-icon>
              Exportar CSV
            </app-button>
          </div>
        </div>

        <!-- Tabla empleados + fila de totales -->
        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="tableData()"
            [columns]="columns()"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            tableSize="sm"
            emptyMessage="No hay datos PILA para el período seleccionado"
            emptyIcon="file-spreadsheet"
          ></app-responsive-data-view>
        </div>
      </app-card>
    </div>

    <!-- Flags de novedad como badges -->
    <ng-template #flagsTpl let-row>
      <div class="flex flex-wrap gap-1">
        @for (flag of row.active_flags; track flag) {
          <span
            class="px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap"
            [class]="getFlagClass(flag)"
          >
            {{ getFlagLabel(flag) }}
          </span>
        }
        @if (!row.active_flags?.length && !row._is_total) {
          <span class="text-xs text-text-secondary">—</span>
        }
      </div>
    </ng-template>
  `,
})
export class PayrollPilaPageComponent {
  private payrollService = inject(PayrollService);
  private currencyService = inject(CurrencyFormatService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  private readonly flagsTpl = viewChild<TemplateRef<any>>('flagsTpl');

  readonly loading = signal(false);
  readonly exporting = signal(false);
  readonly report = signal<PilaReport | null>(null);

  readonly totals = computed<PilaTotals>(() => this.report()?.totals || {});
  readonly socialSecurityTotal = computed(() => {
    const t = this.totals();
    return (
      (t.health_employee || 0) +
      (t.health_employer || 0) +
      (t.pension_employee || 0) +
      (t.pension_employer || 0) +
      (t.arl || 0)
    );
  });

  // Selectores de período (signals vía FormControl tipado)
  readonly yearControl = new FormControl<number>(new Date().getFullYear(), {
    nonNullable: true,
  });
  readonly monthControl = new FormControl<number>(new Date().getMonth() + 1, {
    nonNullable: true,
  });

  readonly yearOptions: SelectorOption[] = Array.from({ length: 6 }, (_, i) => {
    const year = new Date().getFullYear() - i;
    return { label: String(year), value: year };
  });

  readonly monthOptions: SelectorOption[] = MONTH_LABELS.map((label, i) => ({
    label,
    value: i + 1,
  }));

  // Pagination exception: el reporte PILA es un consolidado mensual generado
  // server-side (una fila por empleado cotizante del período + fila de totales),
  // análogo a los reportes de exógena. El backend devuelve el período completo.
  // Datos de tabla: filas de empleados + fila sintética de totales
  readonly tableData = computed(() => {
    const report = this.report();
    if (!report || report.employees.length === 0) return [];
    const rows = report.employees.map((emp) => this.toTableRow(emp));
    rows.push(this.toTotalsRow(report.totals));
    return rows;
  });

  readonly columns = computed<TableColumn[]>(() => {
    const boldIfTotal = (_: any, item: any) =>
      item?._is_total ? 'font-bold text-text-primary' : '';
    return [
      { key: 'document', label: 'Documento', cellClass: boldIfTotal },
      { key: 'full_name', label: 'Nombre', cellClass: boldIfTotal },
      { key: 'ibc_fmt', label: 'IBC', align: 'right', cellClass: boldIfTotal },
      { key: 'worked_days', label: 'Días', align: 'center', cellClass: boldIfTotal },
      { key: 'health_employee_fmt', label: 'Salud Emp.', align: 'right', cellClass: boldIfTotal },
      { key: 'health_employer_fmt', label: 'Salud Empl.', align: 'right', cellClass: boldIfTotal },
      { key: 'pension_employee_fmt', label: 'Pensión Emp.', align: 'right', cellClass: boldIfTotal },
      { key: 'pension_employer_fmt', label: 'Pensión Empl.', align: 'right', cellClass: boldIfTotal },
      { key: 'arl_fmt', label: 'ARL', align: 'right', cellClass: boldIfTotal },
      { key: 'sena_fmt', label: 'SENA', align: 'right', cellClass: boldIfTotal },
      { key: 'icbf_fmt', label: 'ICBF', align: 'right', cellClass: boldIfTotal },
      { key: 'compensation_fund_fmt', label: 'Caja', align: 'right', cellClass: boldIfTotal },
      {
        key: 'active_flags',
        label: 'Novedades',
        template: this.flagsTpl(),
      },
      {
        key: 'total_fmt',
        label: 'Total',
        align: 'right',
        cellClass: (_: any, item: any) =>
          item?._is_total
            ? 'font-bold text-green-700'
            : 'font-semibold text-green-600',
      },
    ];
  });

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'full_name',
    subtitleKey: 'document',
    avatarFallbackIcon: 'user',
    avatarShape: 'circle',
    detailKeys: [
      { key: 'ibc_fmt', label: 'IBC' },
      { key: 'worked_days', label: 'Días' },
      {
        key: 'active_flags',
        label: 'Novedades',
        transform: (flags: string[]) =>
          flags?.length
            ? flags.map((f) => FLAG_LABELS[f] || f).join(', ')
            : '—',
      },
    ],
    footerKey: 'total_fmt',
    footerLabel: 'Total PILA',
    footerStyle: 'prominent',
  };

  constructor() {
    this.currencyService.loadCurrency();
    this.loadReport();

    this.yearControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadReport());
    this.monthControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadReport());
  }

  loadReport(): void {
    this.loading.set(true);
    this.payrollService
      .getPilaReport(this.yearControl.value, this.monthControl.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.report.set(res.data || null);
          this.loading.set(false);
        },
        error: () => {
          this.report.set(null);
          this.loading.set(false);
          this.toastService.show({
            variant: 'error',
            description: 'Error cargando el reporte PILA',
          });
        },
      });
  }

  onExportCsv(): void {
    const year = this.yearControl.value;
    const month = this.monthControl.value;
    this.exporting.set(true);
    this.payrollService
      .exportPilaCsv(year, month)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `pila-${year}-${String(month).padStart(2, '0')}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.exporting.set(false);
          this.toastService.show({
            variant: 'error',
            description: 'Error al exportar el CSV de PILA',
          });
        },
      });
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  getFlagLabel(flag: string): string {
    return FLAG_LABELS[flag] || flag;
  }

  getFlagClass(flag: string): string {
    return FLAG_CLASSES[flag] || 'bg-gray-100 text-gray-600';
  }

  private toTableRow(emp: PilaEmployeeRow): Record<string, any> {
    return {
      _is_total: false,
      document: `${emp.document_type || ''} ${emp.document_number || ''}`.trim(),
      full_name: emp.full_name,
      ibc_fmt: this.formatCurrency(emp.ibc),
      worked_days: emp.worked_days,
      health_employee_fmt: this.formatCurrency(emp.health_employee),
      health_employer_fmt: this.formatCurrency(emp.health_employer),
      pension_employee_fmt: this.formatCurrency(emp.pension_employee),
      pension_employer_fmt: this.formatCurrency(emp.pension_employer),
      arl_fmt: this.formatCurrency(emp.arl),
      sena_fmt: this.formatCurrency(emp.sena),
      icbf_fmt: this.formatCurrency(emp.icbf),
      compensation_fund_fmt: this.formatCurrency(emp.compensation_fund),
      active_flags: Object.entries(emp.novelty_flags || {})
        .filter(([, active]) => active)
        .map(([flag]) => flag),
      total_fmt: this.formatCurrency(emp.total),
    };
  }

  private toTotalsRow(totals: PilaTotals): Record<string, any> {
    return {
      _is_total: true,
      document: '',
      full_name: 'TOTALES',
      ibc_fmt: this.formatCurrency(totals.ibc || 0),
      worked_days: '',
      health_employee_fmt: this.formatCurrency(totals.health_employee || 0),
      health_employer_fmt: this.formatCurrency(totals.health_employer || 0),
      pension_employee_fmt: this.formatCurrency(totals.pension_employee || 0),
      pension_employer_fmt: this.formatCurrency(totals.pension_employer || 0),
      arl_fmt: this.formatCurrency(totals.arl || 0),
      sena_fmt: this.formatCurrency(totals.sena || 0),
      icbf_fmt: this.formatCurrency(totals.icbf || 0),
      compensation_fund_fmt: this.formatCurrency(totals.compensation_fund || 0),
      active_flags: [],
      total_fmt: this.formatCurrency(totals.total || 0),
    };
  }
}
