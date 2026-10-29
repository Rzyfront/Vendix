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
import { Router, RouterLink } from '@angular/router';
import {
  ButtonComponent,
  CardComponent,
  DialogService,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SpinnerComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { ReportExportService } from '../../../../reports/services/report-export.service';
import { ReservationDetailModalComponent } from '../../../reservations/components/reservation-detail-modal/reservation-detail-modal.component';
import { HospitalityLoadErrorComponent } from '../../../shared/load-error.component';
import {
  SIRE_STATUS_CHIPS,
  SIRE_STATUS_LABELS,
  statusBadgeConfig,
} from '../../../shared/hospitality-status';
import {
  SIRE_PORTAL_URL,
  SireSheetModalComponent,
  sireAge,
} from '../../components/sire-sheet-modal/sire-sheet-modal.component';
import { SireFilter, SireSubmission, SireSummary } from '../../interfaces/sire.interface';
import { LodgingSireService } from '../../services/lodging-sire.service';

const PAGE_SIZE = 20;
const STATUS_BADGE = statusBadgeConfig(SIRE_STATUS_CHIPS);
const EVENT_LABELS = { check_in: 'Entrada', check_out: 'Salida' } as const;
/** The screen opens on "Pendientes" (plan H4.2: Cumplimiento → SIRE → Pendientes). */
const DEFAULT_FILTER: SireFilter = 'pending';
const LIST_TITLES: Record<SireFilter, string> = {
  pending: 'Pendientes por reportar',
  overdue: 'Atrasados',
  manual: 'Reportados',
};

type ChipKey = keyof typeof SIRE_STATUS_CHIPS;

interface SireRow {
  id: number;
  reservation_id: number;
  reservation_number: string;
  guest: string;
  event_label: string;
  chip: ChipKey;
  age_label: string;
  detail: string;
  pending: boolean;
}

function isFilter(value: unknown): value is SireFilter {
  return value === 'pending' || value === 'overdue' || value === 'manual';
}

/**
 * Hospitality Suite (H4.2) — Hotelería → Cumplimiento → Planilla de viajeros
 * (SIRE). Each entry and exit of a foreign guest is pending here with its age
 * (red past the store threshold); the desk downloads the file or opens the
 * copyable sheet, reports it in the Migración Colombia portal and marks it.
 * Informative only (D14): nothing here stops the desk.
 *
 * Standard admin list module: four stats, one card with the sticky search,
 * the visible main action and the options dropdown, and the responsive view.
 */
@Component({
  selector: 'app-hospitality-sire-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    SpinnerComponent,
    StatsComponent,
    HospitalityLoadErrorComponent,
    ReservationDetailModalComponent,
    SireSheetModalComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Pendientes"
          [value]="count(summary()?.stats?.pending)"
          smallText="Entradas y salidas por reportar"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="!summary() && !summaryError()"
        />
        <app-stats
          title="Atrasados"
          [value]="count(summary()?.stats?.overdue)"
          [smallText]="'Más de ' + overdueHours() + ' h sin reportar'"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
          [loading]="!summary() && !summaryError()"
        />
        <app-stats
          title="Reportados"
          [value]="count(summary()?.stats?.manual)"
          smallText="Marcados como reportados en el SIRE"
          iconName="circle-check"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="!summary() && !summaryError()"
        />
        <app-stats
          title="Movimientos de extranjeros"
          [value]="count(summary()?.stats?.total)"
          smallText="Entradas y salidas registradas"
          iconName="globe"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="!summary() && !summaryError()"
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
              {{ listTitle() }}
              <span class="text-text-secondary font-normal">({{ total() }})</span>
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar huésped, documento o reserva..."
                [debounceTime]="300"
                [ngModel]="search()"
                (ngModelChange)="onSearch($event)"
              />
              <app-button
                variant="primary"
                size="md"
                [iconOnlyMobile]="true"
                customClasses="!h-11 !w-11 !px-0 md:!w-auto md:!px-4 !rounded-[10px]"
                class="shrink-0"
                [disabled]="exporting()"
                [loading]="exporting()"
                [ariaLabel]="'Descargar planilla'"
                (clicked)="export()"
                data-testid="sire-download"
              >
                <app-icon slot="icon" name="download" [size]="18" />
                Descargar planilla
              </app-button>
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [actions]="dropdownActions"
                [isLoading]="loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="onFilterChange({})"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4 space-y-3">
          <!-- How it works and whether it is on: informative, never blocking (D14) -->
          @if (summary(); as s) {
            <div class="rounded-lg border border-border bg-surface p-3 text-sm" data-testid="sire-info">
              @if (!s.enabled) {
                <p class="text-text-secondary">
                  La planilla de viajeros (SIRE) está apagada: no se registran nuevos movimientos. Actívala en
                  <a routerLink="/admin/settings/general/hoteleria" class="font-medium text-primary underline">Configuración → Hotelería</a>.
                </p>
              } @else {
                <p class="text-text-secondary">
                  Cada entrada y salida de un huésped extranjero queda aquí. Descarga la planilla o abre la ficha,
                  repórtala en el
                  <a [href]="portalUrl" target="_blank" rel="noopener noreferrer" class="font-medium text-primary underline">portal SIRE</a>
                  y márcala como reportada. Las que pasan de {{ s.overdue_hours }} h sin reportar se ven en rojo.
                </p>
              }
            </div>
          }

          @if (loadError(); as message) {
            <app-hospitality-load-error what="la planilla SIRE" [message]="message" (retry)="reload()" />
          } @else if (loading() && rows().length === 0) {
            <div class="p-4 md:p-6">
              <app-spinner [center]="true" text="Cargando planilla…" />
            </div>
          } @else if (rows().length === 0) {
            <app-empty-state
              [icon]="search() ? 'search' : 'shield-check'"
              [title]="emptyTitle()"
              [description]="emptyDescription()"
              [actionButtonText]="search() || filter() !== 'pending' ? 'Limpiar filtros' : 'Ir a Recepción'"
              [showActionButton]="true"
              (actionClick)="search() || filter() !== 'pending' ? clearFilters() : goToFrontDesk()"
            />
          } @else {
            <!-- R-ROW-05: mark several movements reported at once. -->
            @if (bulkIds().length > 0) {
              <div
                class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                role="region"
                aria-label="Acciones de la selección"
                data-testid="sire-bulk-bar"
              >
                <span class="text-sm font-medium text-text-primary">
                  {{ bulkIds().length }} {{ bulkIds().length === 1 ? 'seleccionado' : 'seleccionados' }}
                </span>
                <div class="flex gap-2">
                  <app-button variant="ghost" size="sm" customClasses="!min-h-11" (clicked)="clearSelection()">
                    Quitar selección
                  </app-button>
                  <app-button
                    variant="primary"
                    size="sm"
                    customClasses="!min-h-11"
                    [loading]="marking()"
                    [disabled]="marking()"
                    (clicked)="markReported(bulkIds())"
                    data-testid="sire-bulk-mark"
                  >
                    <app-icon slot="icon" name="check-check" [size]="16" />
                    Marcar reportados
                  </app-button>
                </div>
              </div>
            }
            <app-responsive-data-view
              [data]="rows()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="actions"
              [mobileActions]="actions"
              [striped]="true"
              [hoverable]="true"
              [selectable]="canOperate() && hasPendingRows()"
              rowLabelKey="guest"
              [(selectedIds)]="selectedIds"
              (rowClick)="openSheet($event)"
              emptyMessage="No hay movimientos con ese criterio"
              emptyIcon="search"
              data-testid="sire-table"
            />
            @if (totalPages() > 1) {
              <app-pagination
                [currentPage]="page()"
                [total]="total()"
                [limit]="pageSize"
                [totalPages]="totalPages()"
                infoStyle="none"
                (pageChange)="onPage($event)"
              />
            }
          }
        </div>
      </app-card>

      <app-sire-sheet-modal
        [sireId]="sheetId()"
        [canOperate]="canOperate()"
        (closed)="sheetId.set(null)"
        (changed)="reload()"
      />

      <app-reservation-detail-modal
        [reservationId]="detailId()"
        (closed)="detailId.set(null)"
        (changed)="reload()"
      />
    </div>
  `,
})
export class HospitalitySirePageComponent implements OnInit {
  private readonly sireService = inject(LodgingSireService);
  private readonly exportService = inject(ReportExportService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly authFacade = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  readonly pageSize = PAGE_SIZE;
  readonly portalUrl = SIRE_PORTAL_URL;

  readonly summary = signal<SireSummary | null>(null);
  readonly summaryError = signal(false);
  readonly items = signal<SireSubmission[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly page = signal(1);
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({ status: DEFAULT_FILTER });
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly exporting = signal(false);
  readonly marking = signal(false);
  readonly sheetId = signal<number | null>(null);
  readonly detailId = signal<number | null>(null);
  readonly selectedIds = signal<Set<string | number>>(new Set<string | number>());

  readonly canOperate = signal(this.authFacade.hasPermission('store:lodging:front_desk:operate'));

  readonly overdueHours = computed(() => this.summary()?.overdue_hours ?? 24);

  readonly filter = computed<SireFilter | null>(() => {
    const value = this.filterValues()['status'];
    return isFilter(value) ? value : null;
  });

  readonly listTitle = computed(() => {
    const filter = this.filter();
    return filter ? LIST_TITLES[filter] : 'Planilla de viajeros (SIRE)';
  });

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      placeholder: 'Todos los estados',
      options: [
        { value: 'pending', label: 'Pendientes' },
        { value: 'overdue', label: 'Atrasados' },
        { value: 'manual', label: 'Reportados' },
      ],
    },
  ];

  readonly dropdownActions: DropdownAction[] = [
    { label: 'Abrir portal SIRE', icon: 'external-link', action: 'portal', variant: 'outline' },
    { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' },
  ];

  readonly rows = computed<SireRow[]>(() =>
    this.items().map((item) => ({
      id: item.id,
      reservation_id: item.reservation_id,
      reservation_number: item.reservation_number,
      guest: item.guest_name,
      event_label: EVENT_LABELS[item.event] ?? item.event,
      chip: item.status === 'manual' ? 'manual' : item.overdue ? 'overdue' : 'pending',
      age_label: item.status === 'manual' ? '—' : `Hace ${sireAge(item.age_hours)}`,
      detail: this.detailOf(item),
      pending: item.status === 'pending',
    })),
  );

  readonly hasPendingRows = computed(() => this.rows().some((row) => row.pending));

  /** Selected rows still pending and visible (a hidden row is never touched). */
  readonly bulkIds = computed<number[]>(() => {
    const selected = this.selectedIds();
    return this.rows()
      .filter((row) => row.pending && selected.has(row.id))
      .map((row) => row.id);
  });

  readonly columns: TableColumn[] = [
    { key: 'guest', label: 'Huésped' },
    { key: 'reservation_number', label: 'Reserva' },
    { key: 'event_label', label: 'Movimiento' },
    {
      key: 'chip',
      label: 'Estado',
      width: '130px',
      badge: true,
      badgeConfig: STATUS_BADGE,
      transform: (value: ChipKey) => SIRE_STATUS_LABELS[value] ?? value,
    },
    { key: 'age_label', label: 'Antigüedad' },
    { key: 'detail', label: 'Detalle', priority: 3 },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'guest',
    subtitleTransform: (row: SireRow) => `${row.reservation_number} · ${row.event_label}`,
    badgeKey: 'chip',
    badgeConfig: STATUS_BADGE,
    badgeTransform: (value: ChipKey) => SIRE_STATUS_LABELS[value] ?? value,
    detailKeys: [
      { key: 'age_label', label: 'Antigüedad' },
      { key: 'detail', label: 'Detalle' },
    ],
  };

  /** R-ROW-01 — every row opens its sheet; pending ones can also be marked. */
  readonly actions: TableAction[] = [
    {
      label: 'Ver ficha',
      icon: 'file-text',
      variant: 'primary',
      action: (row: SireRow) => this.openSheet(row),
    },
    {
      label: 'Marcar reportado',
      icon: 'check-check',
      variant: 'secondary',
      show: (row: SireRow) => this.canOperate() && row.pending,
      action: (row: SireRow) => void this.markReported([row.id], row),
    },
    {
      label: 'Ver reserva',
      icon: 'eye',
      variant: 'secondary',
      action: (row: SireRow) => this.detailId.set(row.reservation_id),
    },
  ];

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loadSummary();
    this.loadList();
  }

  emptyTitle(): string {
    if (this.search()) return `Sin resultados para "${this.search()}"`;
    const filter = this.filter();
    if (filter === 'pending') return 'Nada por reportar';
    if (filter === 'overdue') return 'No hay movimientos atrasados';
    if (filter === 'manual') return 'Aún no hay movimientos reportados';
    return 'Aún no hay huéspedes extranjeros';
  }

  emptyDescription(): string {
    if (this.search()) return 'Ningún movimiento coincide con la búsqueda.';
    if (this.filter() === 'pending') {
      return 'Cada entrada y salida de un huésped extranjero aparece aquí sola al hacer el check-in o el check-out.';
    }
    if (this.filter()) return 'Cambia el estado del filtro para ver los demás movimientos.';
    return 'Cada entrada y salida de un huésped extranjero aparece aquí sola al hacer el check-in o el check-out.';
  }

  onSearch(term: string | null): void {
    const next = (term ?? '').trim();
    if (next === this.search()) return;
    this.search.set(next);
    this.page.set(1);
    this.loadList();
  }

  onFilterChange(values: FilterValues): void {
    const status = isFilter(values['status']) ? values['status'] : null;
    this.filterValues.set({ status });
    this.page.set(1);
    this.loadList();
  }

  clearFilters(): void {
    this.search.set('');
    this.onFilterChange({ status: DEFAULT_FILTER });
  }

  clearSelection(): void {
    this.selectedIds.set(new Set<string | number>());
  }

  goToFrontDesk(): void {
    void this.router.navigate(['/admin/hospitality/front-desk']);
  }

  onPage(page: number): void {
    this.page.set(page);
    this.loadList();
  }

  onActionClick(action: string): void {
    if (action === 'refresh') this.reload();
    if (action === 'portal') globalThis.open?.(SIRE_PORTAL_URL, '_blank', 'noopener');
  }

  openSheet(row: SireRow): void {
    this.sheetId.set(row.id);
  }

  /** Marks the given pending movements; asks first, naming who or how many. */
  async markReported(ids: number[], row?: SireRow): Promise<void> {
    if (ids.length === 0 || this.marking()) return;
    const what = row
      ? `la ${row.event_label.toLowerCase()} de ${row.guest} (reserva ${row.reservation_number})`
      : ids.length === 1
        ? '1 movimiento seleccionado'
        : `${ids.length} movimientos seleccionados`;
    const confirmed = await this.dialogService.confirm({
      title: 'Marcar como reportado en el SIRE',
      message:
        `Confirma que ya reportaste ${what} en el portal de Migración Colombia. ` +
        'Quedará tu nombre y la hora.',
      confirmText: ids.length === 1 ? 'Marcar reportado' : `Marcar ${ids.length} reportados`,
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;
    this.marking.set(true);
    this.sireService
      .markReported(ids)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ updated }) => {
          this.marking.set(false);
          this.clearSelection();
          this.toastService.success(
            updated === 1 ? 'Marcado como reportado en el SIRE' : `${updated} marcados como reportados`,
          );
          this.reload();
        },
        error: (message: unknown) => {
          this.marking.set(false);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo marcar');
        },
      });
  }

  count(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : value.toLocaleString('es-CO');
  }

  /** The SIRE fields of the pending movements (or the filtered ones), as an Excel file. */
  export(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.sireService
      .export({ search: this.search() || undefined, status: this.filter() ?? undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.exporting.set(false);
          this.exportService.downloadBlob(blob, 'sire_planilla_viajeros');
          this.toastService.success('Planilla SIRE descargada');
        },
        error: () => {
          this.exporting.set(false);
          this.toastService.error('No se pudo descargar la planilla SIRE');
        },
      });
  }

  private detailOf(item: SireSubmission): string {
    if (item.status === 'manual') {
      const at = item.sent_at
        ? new Date(item.sent_at).toLocaleString('es-CO', {
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })
        : '';
      return `Reportado${item.reported_by_name ? ` por ${item.reported_by_name}` : ''}${at ? ` · ${at}` : ''}`;
    }
    return item.overdue ? `Más de ${this.overdueHours()} h sin reportar` : 'Por reportar en el portal';
  }

  private loadSummary(): void {
    this.summaryError.set(false);
    this.sireService
      .summary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => this.summary.set(summary),
        error: () => this.summaryError.set(true),
      });
  }

  private loadList(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.sireService
      .list({
        page: this.page(),
        limit: PAGE_SIZE,
        search: this.search() || undefined,
        status: this.filter() ?? undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.items.set(result.data);
          this.total.set(result.total);
          this.totalPages.set(Math.max(1, result.totalPages));
          this.loading.set(false);
        },
        error: (message: unknown) => {
          this.loading.set(false);
          this.items.set([]);
          this.loadError.set(typeof message === 'string' ? message : 'Error de conexión');
        },
      });
  }
}
