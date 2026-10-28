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
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ReportExportService } from '../../../../reports/services/report-export.service';
import {
  LodgingChannel,
  LodgingLossesQuery,
  LodgingLossesReport,
  LodgingLossType,
} from '../../interfaces/cancellations.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

interface LossTableRow {
  occurred_label: string;
  reservation_number: string;
  guest_name: string;
  type_label: string;
  channel_label: string;
  stay_label: string;
  total_label: string;
  penalty_label: string;
  penalty_detail_label: string;
  reason_label: string;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const CHANNEL_LABELS: Record<LodgingChannel, string> = {
  front_desk: 'Recepción',
  web: 'Motor web',
};

const TYPE_LABELS: Record<LodgingLossType, string> = {
  cancelled: 'Cancelación',
  no_show: 'No-show',
};

/** `2026-11-05` → `5 nov 2026`. */
function dateLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function civilDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Current month up to today; channel and type empty = all. */
function defaultFilters(): FilterValues {
  const today = new Date();
  return {
    period_preset: 'thisMonth',
    from: civilDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: civilDate(today),
  };
}

/** Case- and accent-insensitive "contains". */
function matches(term: string, ...values: (string | null | undefined)[]): boolean {
  const normalize = (v: string) =>
    v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const needle = normalize(term.trim());
  return !needle || values.some((v) => !!v && normalize(v).includes(needle));
}

function isChannel(value: unknown): value is LodgingChannel {
  return value === 'front_desk' || value === 'web';
}

function isLossType(value: unknown): value is LodgingLossType {
  return value === 'cancelled' || value === 'no_show';
}

/**
 * Hospitality Suite — "No-shows y cancelaciones" (H7.4). The reservations
 * lost in the period by channel, with the stay value and the policy penalty,
 * so the manager spots leaks. The XLSX is built by the backend from the same
 * dataset, so screen and file match.
 *
 * Standard admin list module: four stats, one card with the sticky search and
 * the options dropdown (period, channel, type, export, refresh) and the
 * responsive data view.
 */
@Component({
  selector: 'app-hospitality-cancellations-page',
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
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Cancelaciones"
          [value]="count(totals()?.cancellations)"
          [smallText]="periodText()"
          iconName="calendar-x"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
          [loading]="loading() && !report()"
        />
        <app-stats
          title="No-shows"
          [value]="count(totals()?.no_shows)"
          smallText="Huéspedes que no llegaron"
          iconName="user-x"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading() && !report()"
        />
        <app-stats
          title="Valor perdido"
          [value]="money(totals()?.lost_amount)"
          smallText="Valor de las estadías perdidas"
          iconName="trending-down"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading() && !report()"
        />
        <app-stats
          title="Penalidades"
          [value]="money(totals()?.penalty_amount)"
          smallText="Según la política de cancelación"
          iconName="receipt"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading() && !report()"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <!-- Sticky search header -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              No-shows y cancelaciones
              <span class="text-text-secondary font-normal">({{ rows().length }})</span>
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar reserva o huésped..."
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
          @if (loading() && !report()) {
            <div class="p-4 md:p-6">
              <app-spinner [center]="true" text="Cargando reporte…" />
            </div>
          } @else if (!report()) {
            <app-empty-state
              icon="calendar-x"
              title="Sin reporte"
              description="No se pudo cargar el reporte. Usa Actualizar para reintentar."
              [showActionButton]="false"
            />
          } @else if (rows().length === 0) {
            <app-empty-state
              [icon]="search() ? 'search' : 'calendar-check'"
              [title]="search() ? 'Sin resultados' : 'Sin cancelaciones ni no-shows'"
              [description]="
                search()
                  ? 'Ninguna reserva coincide con la búsqueda.'
                  : 'No hubo reservas perdidas con estos filtros.'
              "
              actionButtonText="Limpiar búsqueda"
              [showActionButton]="!!search()"
              (actionClick)="search.set('')"
            />
          } @else {
            <app-responsive-data-view
              [data]="rows()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [striped]="true"
              [hoverable]="true"
              emptyMessage="No hay reservas con ese criterio"
              emptyIcon="search"
              data-testid="cancellations-table"
            />
            <p class="mt-2 text-xs text-text-secondary">
              Fecha del evento en la zona horaria de la tienda. No incluye reservas web que vencieron sin pagar.
            </p>
          }
        </div>
      </app-card>
    </div>
  `,
})
export class HospitalityCancellationsPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly exportService = inject(ReportExportService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly report = signal<LodgingLossesReport | null>(null);
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>(defaultFilters());

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'period',
      label: 'Periodo',
      type: 'date-range',
      startKey: 'from',
      endKey: 'to',
      presetKey: 'period_preset',
    },
    {
      key: 'channel',
      label: 'Canal',
      type: 'select',
      placeholder: 'Todos los canales',
      options: [
        { value: 'front_desk', label: CHANNEL_LABELS.front_desk },
        { value: 'web', label: CHANNEL_LABELS.web },
      ],
    },
    {
      key: 'type',
      label: 'Tipo',
      type: 'select',
      placeholder: 'Cancelaciones y no-shows',
      options: [
        { value: 'cancelled', label: 'Cancelaciones' },
        { value: 'no_show', label: 'No-shows' },
      ],
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      label: this.exporting() ? 'Exportando...' : 'Exportar XLSX',
      icon: 'download',
      action: 'export',
      variant: 'outline',
      disabled: this.exporting() || !this.report(),
    },
    { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' },
  ]);

  readonly totals = computed(() => this.report()?.totals ?? null);

  readonly periodText = computed(() => {
    const report = this.report();
    return report ? `${dateLabel(report.from)} → ${dateLabel(report.to)}` : '';
  });

  readonly rows = computed<LossTableRow[]>(() =>
    (this.report()?.rows ?? [])
      .map((row) => ({
        occurred_label: dateLabel(row.occurred_on),
        reservation_number: row.reservation_number,
        guest_name: row.guest_name || '—',
        type_label: TYPE_LABELS[row.type],
        channel_label: CHANNEL_LABELS[row.channel],
        stay_label: `${dateLabel(row.arrival_date)} · ${row.nights} ${row.nights === 1 ? 'noche' : 'noches'}`,
        total_label: this.money(row.total_amount),
        penalty_label: this.money(row.penalty_amount),
        penalty_detail_label: row.penalty_detail || '—',
        reason_label: row.reason || '—',
      }))
      .filter((row) => matches(this.search(), row.reservation_number, row.guest_name)),
  );

  readonly columns: TableColumn[] = [
    { key: 'occurred_label', label: 'Fecha' },
    { key: 'reservation_number', label: 'Reserva' },
    { key: 'guest_name', label: 'Huésped' },
    { key: 'type_label', label: 'Tipo' },
    { key: 'channel_label', label: 'Canal' },
    { key: 'stay_label', label: 'Estadía' },
    { key: 'total_label', label: 'Valor', align: 'right' },
    { key: 'penalty_label', label: 'Penalidad', align: 'right' },
    { key: 'penalty_detail_label', label: 'Regla', priority: 3 },
    { key: 'reason_label', label: 'Motivo', priority: 3 },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'reservation_number',
    subtitleKey: 'guest_name',
    detailKeys: [
      { key: 'type_label', label: 'Tipo' },
      { key: 'channel_label', label: 'Canal' },
      { key: 'occurred_label', label: 'Fecha' },
      { key: 'stay_label', label: 'Estadía' },
      { key: 'total_label', label: 'Valor' },
      { key: 'penalty_detail_label', label: 'Regla' },
      { key: 'reason_label', label: 'Motivo' },
    ],
    footerKey: 'penalty_label',
    footerLabel: 'Penalidad',
  };

  ngOnInit(): void {
    this.load();
  }

  onSearch(term: string | null): void {
    this.search.set((term ?? '').trim());
  }

  /** A period without both ends goes back to the current month. */
  onFilterChange(values: FilterValues): void {
    const from = values['from'];
    const to = values['to'];
    const period =
      typeof from === 'string' && from && typeof to === 'string' && to
        ? { period_preset: values['period_preset'] ?? null, from, to }
        : defaultFilters();
    const next: FilterValues = {
      ...period,
      channel: isChannel(values['channel']) ? values['channel'] : null,
      type: isLossType(values['type']) ? values['type'] : null,
    };
    const current = this.filterValues();
    const changed = (['from', 'to', 'channel', 'type'] as const).some(
      (key) => (next[key] ?? null) !== (current[key] ?? null),
    );
    this.filterValues.set(next);
    if (changed) this.load();
  }

  onActionClick(action: string): void {
    if (action === 'refresh') this.load();
    if (action === 'export') this.export();
  }

  load(): void {
    this.loading.set(true);
    this.reservationsService
      .cancellations(this.query())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.report.set(report);
          this.loading.set(false);
        },
        error: (message: unknown) => {
          this.loading.set(false);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo cargar el reporte');
        },
      });
  }

  /** Downloads the XLSX of the current filters (the backend builds it). */
  export(): void {
    const report = this.report();
    if (!report || this.exporting()) return;
    const query = this.query();
    this.exporting.set(true);
    this.reservationsService
      .exportCancellations(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.exporting.set(false);
          this.exportService.downloadBlob(blob, `no_shows_cancelaciones_${query.from}_${query.to}`);
        },
        error: () => {
          this.exporting.set(false);
          this.toastService.error('No se pudo exportar el reporte');
        },
      });
  }

  money(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : this.currency.format(value, 0);
  }

  count(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : value.toLocaleString('es-CO');
  }

  private query(): LodgingLossesQuery {
    const values = this.filterValues();
    return {
      from: String(values['from']),
      to: String(values['to']),
      channel: isChannel(values['channel']) ? values['channel'] : undefined,
      type: isLossType(values['type']) ? values['type'] : undefined,
    };
  }
}
