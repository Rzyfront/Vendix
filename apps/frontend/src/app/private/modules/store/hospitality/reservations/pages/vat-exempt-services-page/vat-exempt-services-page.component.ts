import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  Injector,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
  ToastService,
  SpinnerComponent,
  TooltipComponent,
  IconComponent,
} from '../../../../../../../shared/components/index';
import { CountryService } from '../../../../../../../core/services/country.service';
import { ReportExportService } from '../../../../reports/services/report-export.service';
import { entryPermitLabel } from '../../../shared/hospitality-labels';
import { ReservationDetailModalComponent } from '../../components/reservation-detail-modal/reservation-detail-modal.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { formatStoreDate } from '../../../../../../../shared/utils/date.util';
import { VatExemptServiceRow } from '../../interfaces/folio.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

interface ReportRow extends VatExemptServiceRow {
  date_label: string;
  document_label: string;
  base_label: string;
  total_label: string;
  nationality_label: string;
  permit_label: string;
}

const COUNTRY_NAMES = new Intl.DisplayNames(['es'], { type: 'region' });

/** U18 (R-TERM-05) — the legal ground goes in the help, never in the title. */
const LEGAL_HELP =
  'Alojamiento vendido a turistas extranjeros no residentes, exento de IVA (art. 481 lit. d del Estatuto Tributario). ' +
  'Guarda el pasaporte y el permiso de ingreso de Migración como soporte ante la DIAN.';

/** Local civil date `YYYY-MM-DD` of the browser (the store's desk). */
function civilDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Default period: the current month up to today. */
function defaultPeriod(): FilterValues {
  const today = new Date();
  return {
    period_preset: 'thisMonth',
    from: civilDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: civilDate(today),
  };
}

/**
 * Hospitality Suite — "Servicios exentos" (H3.9). Invoices whose lodging went
 * out with VAT 0 % "Exento – art. 481 lit. d ET", with the holder's passport
 * and entry permit as support for the accountant.
 *
 * Standard admin list module: four stats, one card with the search, the
 * options dropdown (period filter + refresh) and the responsive data view.
 * The period reloads from the server; the search filters the loaded report.
 *
 * U18: country and entry permit by name, the legal ground in a help, an
 * "Exportar a Excel" built by the backend and rows that open the reservation.
 *
 * R3: embedded as a section of Configuración → General → Facturación (only for
 * hospitality stores), so the stats and the search header no longer stick —
 * the settings shell owns the sticky header.
 */
@Component({
  selector: 'app-hospitality-vat-exempt-services-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SpinnerComponent,
    FormsModule,
    StatsComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
    TooltipComponent,
    IconComponent,
    ReservationDetailModalComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <div class="stats-container">
        <app-stats
          title="Facturas exentas"
          [value]="report().length"
          smallText="alojamiento con IVA 0 % en el periodo"
          iconName="receipt"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Base exenta"
          [value]="exemptTotal()"
          smallText="alojamiento de turistas extranjeros"
          iconName="percent"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Total facturado"
          [value]="invoicedTotal()"
          smallText="incluye consumos con impuesto"
          iconName="banknote"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
        <app-stats
          title="Huéspedes"
          [value]="guestCount()"
          [smallText]="countriesText()"
          iconName="globe"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border">
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              Servicios exentos
              <span class="text-text-secondary font-normal">({{ rows().length }})</span>
              <app-tooltip [content]="legalHelp" position="bottom" size="lg">
                <button
                  type="button"
                  class="inline-flex items-center justify-center w-11 h-11 -my-3 align-middle text-text-secondary hover:text-text-primary"
                  aria-label="¿Qué es esto?"
                  data-testid="exempt-legal-help"
                >
                  <app-icon name="help-circle" [size]="16" />
                </button>
              </app-tooltip>
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar factura, huésped o documento..."
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
          @if (loading() && report().length === 0) {
            <div class="p-4 md:p-6">
              <app-spinner [center]="true" text="Cargando servicios exentos…" />
            </div>
          } @else if (rows().length === 0 && search()) {
            <app-empty-state
              icon="search"
              title="Sin resultados"
              description="Ninguna factura exenta coincide con la búsqueda."
              actionButtonText="Limpiar búsqueda"
              [showActionButton]="true"
              (actionClick)="search.set('')"
            />
          } @else if (rows().length === 0) {
            <app-empty-state
              icon="file-check"
              title="Sin servicios exentos en el periodo"
              description="Las facturas de folios con la exención de IVA aplicada aparecen aquí con el pasaporte y el permiso del huésped."
              [showActionButton]="false"
            />
          } @else {
            <app-responsive-data-view
              [data]="rows()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [loading]="loading()"
              [striped]="true"
              [hoverable]="true"
              (rowClick)="openReservation($event)"
              emptyMessage="No hay facturas exentas con ese criterio"
              emptyIcon="search"
              data-testid="exempt-table"
            />
          }
        </div>
      </app-card>

      <app-reservation-detail-modal
        [reservationId]="detailId()"
        (closed)="detailId.set(null)"
        (changed)="load()"
      />
    </div>
  `,
})
export class HospitalityVatExemptServicesPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly countries = inject(CountryService);
  private readonly exportService = inject(ReportExportService);

  readonly legalHelp = LEGAL_HELP;

  /** Fires once, after the first load renders, so the host can scroll to it. */
  readonly ready = output<void>();
  private announced = false;

  private readonly storeSettings = inject(StoreSettingsFacade);

  readonly loading = signal(true);
  readonly report = signal<VatExemptServiceRow[]>([]);
  readonly search = signal('');
  readonly exporting = signal(false);
  /** U18 (R-NAV-07) — the reservation a row opened. */
  readonly detailId = signal<number | null>(null);
  readonly filterValues = signal<FilterValues>(defaultPeriod());

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'period',
      label: 'Periodo de emisión',
      type: 'date-range',
      startKey: 'from',
      endKey: 'to',
      presetKey: 'period_preset',
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      label: this.exporting() ? 'Exportando...' : 'Exportar a Excel',
      icon: 'download',
      action: 'export',
      variant: 'outline',
      disabled: this.exporting() || this.report().length === 0,
    },
    { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' },
  ]);

  readonly rows = computed<ReportRow[]>(() => {
    const term = this.search().toLowerCase();
    const list = term
      ? this.report().filter((row) =>
          [row.invoice_number, row.guest_name, row.document_number, row.reservation_number].some(
            (value) => (value ?? '').toLowerCase().includes(term),
          ),
        )
      : this.report();
    return list.map((row) => ({
      ...row,
      date_label: formatStoreDate(row.issue_date, this.storeSettings.timezone()),
      document_label: [row.document_type, row.document_number].filter(Boolean).join(' '),
      base_label: this.currency.format(row.exempt_base, 0),
      total_label: this.currency.format(row.invoice_total, 0),
      nationality_label: this.countryName(row.nationality_country_code),
      permit_label: entryPermitLabel(row.entry_permit_type),
    }));
  });

  readonly exemptTotal = computed(() =>
    this.currency.format(
      this.report().reduce((sum, row) => sum + row.exempt_base, 0),
      0,
    ),
  );

  readonly invoicedTotal = computed(() =>
    this.currency.format(
      this.report().reduce((sum, row) => sum + row.invoice_total, 0),
      0,
    ),
  );

  /** Distinct guests by document (falls back to the name without document). */
  readonly guestCount = computed(
    () =>
      new Set(
        this.report().map((row) =>
          row.document_number ? `${row.document_type}:${row.document_number}` : row.guest_name,
        ),
      ).size,
  );

  readonly countriesText = computed(() => {
    const countries = new Set(
      this.report()
        .map((row) => row.nationality_country_code)
        .filter((code): code is string => !!code),
    ).size;
    return countries === 1 ? '1 nacionalidad' : `${countries} nacionalidades`;
  });

  readonly columns: TableColumn[] = [
    { key: 'invoice_number', label: 'Factura' },
    { key: 'date_label', label: 'Fecha' },
    { key: 'reservation_number', label: 'Reserva' },
    { key: 'guest_name', label: 'Huésped' },
    { key: 'document_label', label: 'Documento' },
    { key: 'nationality_label', label: 'Nacionalidad' },
    { key: 'permit_label', label: 'Permiso de ingreso' },
    { key: 'base_label', label: 'Base exenta', align: 'right' },
    { key: 'total_label', label: 'Total factura', align: 'right' },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'invoice_number',
    subtitleKey: 'guest_name',
    detailKeys: [
      { key: 'document_label', label: 'Documento' },
      { key: 'nationality_label', label: 'Nacionalidad' },
      { key: 'permit_label', label: 'Permiso de ingreso' },
      { key: 'date_label', label: 'Fecha' },
    ],
    footerKey: 'base_label',
    footerLabel: 'Base exenta',
  };

  ngOnInit(): void {
    this.load();
  }

  onSearch(term: string | null): void {
    this.search.set((term ?? '').trim());
  }

  /** Clearing the filters goes back to the current month, never to "no period". */
  onFilterChange(values: FilterValues): void {
    const from = values['from'];
    const to = values['to'];
    this.filterValues.set(
      typeof from === 'string' && from && typeof to === 'string' && to ? values : defaultPeriod(),
    );
    this.load();
  }

  onActionClick(action: string): void {
    if (action === 'refresh') this.load();
    if (action === 'export') this.export();
  }

  /** Invoices without a linked reservation have nothing to open. */
  openReservation(row: ReportRow): void {
    if (row.reservation_id) this.detailId.set(row.reservation_id);
  }

  export(): void {
    if (this.exporting() || this.report().length === 0) return;
    const { from, to } = this.filterValues();
    this.exporting.set(true);
    this.reservationsService
      .exportVatExemptServices(String(from), String(to))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.exporting.set(false);
          this.exportService.downloadBlob(blob, `servicios_exentos_${from}_${to}`);
        },
        error: () => {
          this.exporting.set(false);
          this.toastService.error('No se pudo exportar el reporte');
        },
      });
  }

  /** "US" → "Estados Unidos": Spanish name like the guest form, then the shared catalog. */
  private countryName(code: string | null): string {
    if (!code) return '—';
    const upper = code.toUpperCase();
    const catalog = this.countries.getCountryByCode(upper)?.name ?? upper;
    try {
      return COUNTRY_NAMES.of(upper) ?? catalog;
    } catch {
      return catalog;
    }
  }

  load(): void {
    const { from, to } = this.filterValues();
    this.loading.set(true);
    this.reservationsService
      .vatExemptServices(String(from), String(to))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.report.set(report.rows);
          this.loading.set(false);
          this.announceReady();
        },
        error: (message: unknown) => {
          this.loading.set(false);
          this.announceReady();
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudo cargar el reporte',
          );
        },
      });
  }

  private announceReady(): void {
    if (this.announced) return;
    this.announced = true;
    afterNextRender(() => this.ready.emit(), { injector: this.injector });
  }
}
