import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  SpinnerComponent,
  StatsComponent,
  TableColumn,
  ToastService,
  TooltipComponent,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ReportExportService } from '../../../../reports/services/report-export.service';
import { HospitalityLoadErrorComponent } from '../../../shared/load-error.component';
import { LodgingFonturReport } from '../../interfaces/fontur.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

interface FonturTableRow {
  label: string;
  kind_label: string;
  documents_label: string;
  base_label: string;
}

const QUARTER_LABELS: Record<number, string> = {
  1: '1.er trimestre (enero a marzo)',
  2: '2.º trimestre (abril a junio)',
  3: '3.er trimestre (julio a septiembre)',
  4: '4.º trimestre (octubre a diciembre)',
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-07-01" → "1 jul 2026" (civil date, no time zone shift). */
function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Plain-language help of each figure (R-REP-02); the legal ground stays in the help (R-TERM-05). */
const HELP = {
  base:
    'Lo facturado en el trimestre por las estadías y los consumos cargados a la habitación, sin IVA. ' +
    'Resta las notas crédito. Si la tienda no factura electrónicamente, cuenta las cuentas del huésped cerradas en el trimestre.',
  contribution:
    'Contribución parafiscal al turismo que se declara cada trimestre en la plataforma de Fontur, ' +
    'en los primeros 20 días hábiles del trimestre siguiente. Es un estimado: confírmalo con tu contador.',
  lodging: 'Noches de alojamiento facturadas, por tipo de habitación.',
  other: 'Restaurante, minibar y demás consumos cargados a la habitación y facturados con la estadía.',
} as const;

/**
 * Hospitality Suite — "Fontur" (H4.4). Invoiced income of the hotel stays in
 * one quarter, by line (room type or other guest charges), and the estimated
 * contribution at the store's rate (Configuración → Hotelería, 2,5 por mil by
 * default). Informative only (D14): nothing here blocks the operation.
 *
 * Standard report: four stats, one card with the search, the options dropdown
 * (year and quarter + export + refresh) and the responsive data view. The
 * screen and the XLSX come from the same backend report.
 */
@Component({
  selector: 'app-hospitality-fontur-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    SpinnerComponent,
    StatsComponent,
    CardComponent,
    IconComponent,
    TooltipComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
    HospitalityLoadErrorComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Ingresos facturados"
          [attr.title]="'Ingresos facturados: ' + help.base"
          [value]="money(totals()?.base)"
          [smallText]="periodText()"
          iconName="receipt"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading() && !report()"
        />
        <app-stats
          title="Contribución estimada"
          [attr.title]="'Contribución estimada: ' + help.contribution"
          [value]="money(totals()?.contribution)"
          [smallText]="rateText()"
          iconName="landmark"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading() && !report()"
        />
        <app-stats
          title="Alojamiento"
          [attr.title]="'Alojamiento: ' + help.lodging"
          [value]="money(lodgingBase())"
          smallText="Noches facturadas, sin IVA"
          iconName="bed-double"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading() && !report()"
        />
        <app-stats
          title="Otros consumos"
          [attr.title]="'Otros consumos: ' + help.other"
          [value]="money(otherBase())"
          smallText="Cargados a la habitación, sin IVA"
          iconName="utensils"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading() && !report()"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <!-- Sticky search header -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              Base de la contribución a Fontur
              <span class="text-text-secondary font-normal">({{ rows().length }})</span>
              <app-tooltip [content]="help.contribution" position="bottom" size="lg">
                <button
                  type="button"
                  class="inline-flex items-center justify-center w-11 h-11 -my-3 align-middle text-text-secondary hover:text-text-primary"
                  aria-label="¿Qué es esto?"
                  data-testid="fontur-help"
                >
                  <app-icon name="help-circle" [size]="16" />
                </button>
              </app-tooltip>
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar tipo de habitación..."
                [debounceTime]="300"
                [ngModel]="search()"
                (ngModelChange)="onSearch($event)"
              />
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [actions]="dropdownActions()"
                [isLoading]="loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="onFilterChange({})"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          @if (loadError(); as message) {
            <app-hospitality-load-error what="el reporte de Fontur" [message]="message" (retry)="load()" />
          } @else if (loading() && !report()) {
            <div class="p-4 md:p-6">
              <app-spinner [center]="true" text="Cargando reporte de Fontur…" />
            </div>
          } @else if (report(); as current) {
            <p class="mb-3 text-xs text-text-secondary" data-testid="fontur-note">
              {{ quarterLabel(current.quarter) }} de {{ current.year }}. Tarifa de
              {{ rateLabel(current.rate_per_mil) }} por mil sobre lo facturado sin IVA.
              <a routerLink="/admin/settings/general/hoteleria" class="text-primary underline">Cambiar tarifa</a>
            </p>
            @if (current.totals.without_invoice > 0) {
              <p
                class="mb-3 flex items-start gap-2 rounded-lg border border-border bg-surface p-2 text-xs text-text-secondary"
                role="status"
                data-testid="fontur-without-invoice"
              >
                <app-icon name="info" [size]="14" class="mt-0.5 shrink-0" />
                {{ withoutInvoiceText() }}
              </p>
            }

            @if (current.lines.length === 0) {
              <app-empty-state
                icon="file-search"
                [title]="'Sin ingresos en el ' + quarterLabel(current.quarter) + ' de ' + current.year"
                description="Las estadías facturadas o cerradas en ese trimestre aparecen aquí. Elige otro trimestre en el filtro."
                [showActionButton]="false"
              />
            } @else if (rows().length === 0) {
              <app-empty-state
                icon="search"
                title="Sin resultados"
                description="Ninguna línea coincide con la búsqueda."
                actionButtonText="Limpiar búsqueda"
                [showActionButton]="true"
                (actionClick)="search.set('')"
              />
            } @else {
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [striped]="true"
                [hoverable]="true"
                emptyMessage="No hay líneas con ese criterio"
                emptyIcon="search"
                data-testid="fontur-table"
              />
            }
          }
        </div>
      </app-card>
    </div>
  `,
})
export class HospitalityFonturPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly exportService = inject(ReportExportService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly help = HELP;

  readonly loading = signal(true);
  readonly exporting = signal(false);
  /** R-FB-02 — a failed load shows this with "Reintentar", never zeros. */
  readonly loadError = signal<string | null>(null);
  readonly report = signal<LodgingFonturReport | null>(null);
  readonly search = signal('');
  /** Empty until the first load: the backend picks the last closed quarter in the store's zone. */
  readonly filterValues = signal<FilterValues>({});

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'year',
      label: 'Año',
      type: 'select',
      options: Array.from({ length: 5 }, (_, i) => {
        const year = String(new Date().getFullYear() - i);
        return { value: year, label: year };
      }),
    },
    {
      key: 'quarter',
      label: 'Trimestre',
      type: 'select',
      options: [1, 2, 3, 4].map((q) => ({ value: String(q), label: QUARTER_LABELS[q] })),
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      label: this.exporting() ? 'Exportando...' : 'Exportar a Excel',
      icon: 'download',
      action: 'export',
      variant: 'outline',
      disabled: this.exporting() || !this.report(),
    },
    { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' },
  ]);

  readonly totals = computed(() => this.report()?.totals ?? null);

  readonly lodgingBase = computed(() => this.sumKind('lodging'));
  readonly otherBase = computed(() => this.sumKind('other'));

  readonly periodText = computed(() => {
    const report = this.report();
    return report ? `${dateLabel(report.from)} → ${dateLabel(report.to)}` : '';
  });

  readonly rateText = computed(() => {
    const report = this.report();
    return report ? `${this.rateLabel(report.rate_per_mil)} por mil de lo facturado` : '';
  });

  /** D14 — informative only: accounts closed without electronic invoice still count. */
  readonly withoutInvoiceText = computed(() => {
    const count = this.report()?.totals.without_invoice ?? 0;
    return count === 1
      ? '1 cuenta del huésped se cerró sin factura electrónica: su venta se suma igual a la base.'
      : `${count} cuentas del huésped se cerraron sin factura electrónica: sus ventas se suman igual a la base.`;
  });

  readonly rows = computed<FonturTableRow[]>(() => {
    const term = this.search().toLowerCase();
    return (this.report()?.lines ?? [])
      .filter((line) => !term || line.label.toLowerCase().includes(term))
      .map((line) => ({
        label: line.label,
        kind_label: line.kind === 'lodging' ? 'Alojamiento' : 'Otros consumos',
        documents_label: String(line.documents),
        base_label: this.currency.format(line.base, 0),
      }));
  });

  readonly columns: TableColumn[] = [
    { key: 'label', label: 'Línea' },
    { key: 'kind_label', label: 'Tipo' },
    { key: 'documents_label', label: 'Facturas o cuentas', align: 'right' },
    { key: 'base_label', label: 'Ingresos sin IVA', align: 'right' },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'label',
    subtitleKey: 'kind_label',
    detailKeys: [{ key: 'documents_label', label: 'Facturas o cuentas' }],
    footerKey: 'base_label',
    footerLabel: 'Ingresos sin IVA',
  };

  ngOnInit(): void {
    this.load();
  }

  quarterLabel(quarter: number): string {
    return QUARTER_LABELS[quarter] ?? `Trimestre ${quarter}`;
  }

  /** 2.5 → "2,5". */
  rateLabel(rate: number): string {
    return rate.toLocaleString('es-CO', { maximumFractionDigits: 3 });
  }

  money(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : this.currency.format(value, 0);
  }

  onSearch(term: string | null): void {
    this.search.set((term ?? '').trim());
  }

  /** Clearing the filters goes back to the last closed quarter. */
  onFilterChange(values: FilterValues): void {
    const year = values['year'];
    const quarter = values['quarter'];
    this.filterValues.set(
      typeof year === 'string' && year && typeof quarter === 'string' && quarter
        ? { year, quarter }
        : typeof year === 'string' && year
          ? { year, quarter: String(this.report()?.quarter ?? 1) }
          : typeof quarter === 'string' && quarter
            ? { year: String(this.report()?.year ?? new Date().getFullYear()), quarter }
            : {},
    );
    this.load();
  }

  onActionClick(action: string): void {
    if (action === 'refresh') this.load();
    if (action === 'export') this.export();
  }

  load(): void {
    const { year, quarter } = this.filterValues();
    this.loading.set(true);
    this.loadError.set(null);
    this.reservationsService
      .fontur(year ? Number(year) : undefined, quarter ? Number(quarter) : undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.report.set(report);
          this.filterValues.set({ year: String(report.year), quarter: String(report.quarter) });
          this.loading.set(false);
        },
        error: (message: unknown) => {
          this.loading.set(false);
          this.report.set(null);
          this.loadError.set(typeof message === 'string' ? message : null);
        },
      });
  }

  export(): void {
    const report = this.report();
    if (this.exporting() || !report) return;
    this.exporting.set(true);
    this.reservationsService
      .exportFontur(report.year, report.quarter)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.exporting.set(false);
          this.exportService.downloadBlob(blob, `fontur_${report.year}_t${report.quarter}`);
          this.toastService.success('Reporte de Fontur exportado');
        },
        error: () => {
          this.exporting.set(false);
          this.toastService.error('No se pudo exportar el reporte');
        },
      });
  }

  private sumKind(kind: 'lodging' | 'other'): number | null {
    const report = this.report();
    if (!report) return null;
    return report.lines.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.base, 0);
  }
}
