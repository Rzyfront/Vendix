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
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
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
  TRA_STATUS_CHIPS,
  TRA_STATUS_LABELS,
  statusBadgeConfig,
} from '../../../shared/hospitality-status';
import { TraTokenModalComponent, TRA_TOKEN_URL } from '../../components/tra-token-modal/tra-token-modal.component';
import { TraStatus, TraSubmission, TraSummary } from '../../interfaces/tra.interface';
import { LodgingTraService } from '../../services/lodging-tra.service';

const PAGE_SIZE = 20;
const STATUS_BADGE = statusBadgeConfig(TRA_STATUS_CHIPS);
const EVENT_LABELS = { check_in: 'Check-in', check_out: 'Check-out' } as const;
const OPEN: TraStatus[] = ['pending', 'failed'];

interface TraRow {
  id: number;
  reservation_id: number;
  reservation_number: string;
  guest: string;
  event_label: string;
  status: TraStatus;
  when_label: string;
  detail: string;
}

function isStatus(value: unknown): value is TraStatus {
  return value === 'pending' || value === 'sent' || value === 'manual' || value === 'failed';
}

/** `2026-11-10T14:05:00Z` → `10 nov, 9:05 a. m.` (local time). */
function dateTime(value: string): string {
  return format(parseISO(value), "d MMM, h:mm aaaa", { locale: es });
}

/**
 * Hospitality Suite (H4.1) — Hotelería → Cumplimiento → TRA. Each check-in
 * and check-out is reported to the MinCIT per guest and companion; this
 * screen shows "Enviado ✓" with its time, the pending ones with the reason
 * and "Reintentar", the token and the assisted path (Excel file + "Marcar
 * reportado"). Informative only (D14): nothing here stops the desk.
 *
 * Standard admin list module: four stats, one card with the sticky search,
 * the visible main action and the options dropdown, and the responsive view.
 */
@Component({
  selector: 'app-hospitality-tra-page',
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
    TraTokenModalComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Enviados"
          [value]="count(summary()?.stats?.sent)"
          smallText="Huéspedes reportados a la TRA"
          iconName="circle-check"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="!summary() && !summaryError()"
        />
        <app-stats
          title="Pendientes"
          [value]="count(summary()?.stats?.pending)"
          smallText="Esperan envío o reintento"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="!summary() && !summaryError()"
        />
        <app-stats
          title="Rechazados"
          [value]="count(summary()?.stats?.failed)"
          smallText="La TRA no los aceptó"
          iconName="x-circle"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
          [loading]="!summary() && !summaryError()"
        />
        <app-stats
          title="Reportados en el portal"
          [value]="count(summary()?.stats?.manual)"
          smallText="Registrados a mano en tramincit.gov.co"
          iconName="user-check"
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
              Registros TRA
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
              @if (canOperate()) {
                <app-button
                  variant="primary"
                  size="md"
                  [iconOnlyMobile]="true"
                  customClasses="!h-11 !w-11 !px-0 md:!w-auto md:!px-4 !rounded-[10px]"
                  class="shrink-0"
                  [disabled]="openCount() === 0 || retrying()"
                  [loading]="retrying()"
                  [ariaLabel]="'Enviar pendientes'"
                  (clicked)="retryAll()"
                  data-testid="tra-send-pending"
                >
                  <app-icon slot="icon" name="send" [size]="18" />
                  Enviar pendientes
                </app-button>
              }
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

        <div class="px-2 pb-2 pt-3 md:p-4 space-y-3">
          <!-- Token and hotel-wide notice: informative, never blocking (D14) -->
          @if (summary(); as s) {
            <div
              class="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm md:flex-row md:items-center md:justify-between"
              data-testid="tra-token-panel"
            >
              <div class="space-y-1">
                @if (!s.enabled) {
                  <p class="text-text-secondary">
                    El reporte a la TRA está apagado. Actívalo en
                    <a routerLink="/admin/settings/general/hoteleria" class="font-medium text-primary underline">Configuración → Hotelería</a>.
                  </p>
                } @else if (s.notice; as notice) {
                  <p role="status" class="flex items-start gap-1.5 font-medium text-warning" data-testid="tra-notice">
                    <app-icon name="alert-triangle" [size]="16" class="mt-0.5 shrink-0" />
                    {{ notice.message }}
                  </p>
                }
                <p class="text-text-secondary">
                  @if (s.credential; as credential) {
                    Token TRA ••••{{ credential.hint }}
                    @if (credential.tested_at) {
                      · probado el {{ when(credential.tested_at) }}
                    }
                  } @else {
                    Sin token TRA.
                    <a [href]="tokenUrl" target="_blank" rel="noopener noreferrer" class="font-medium text-primary underline">Solicitar token</a>
                    (llega al correo del RNT).
                  }
                  @if (!s.rnt_number) {
                    · Falta el RNT en
                    <a routerLink="/admin/settings/general/hoteleria" class="font-medium text-primary underline">Configuración → Hotelería</a>.
                  }
                </p>
                <p class="text-xs text-text-secondary">
                  La TRA no permite corregir un registro enviado: las correcciones se hacen a mano en el portal del MinCIT.
                </p>
              </div>
              @if (canManage()) {
                <app-button variant="outline" size="sm" class="shrink-0" (clicked)="tokenOpen.set(true)" data-testid="tra-token-open">
                  <app-icon slot="icon" name="key-round" [size]="16" />
                  {{ s.credential ? 'Cambiar o probar token' : 'Configurar token' }}
                </app-button>
              }
            </div>
          }

          @if (loadError(); as message) {
            <app-hospitality-load-error what="los registros TRA" [message]="message" (retry)="reload()" />
          } @else if (loading() && rows().length === 0) {
            <div class="p-4 md:p-6">
              <app-spinner [center]="true" text="Cargando registros…" />
            </div>
          } @else if (rows().length === 0) {
            <app-empty-state
              [icon]="hasFilters() ? 'search' : 'shield-check'"
              [title]="hasFilters() ? 'Sin resultados' : 'Aún no hay registros TRA'"
              [description]="
                hasFilters()
                  ? 'Ningún registro coincide con la búsqueda o el filtro.'
                  : 'Cada check-in y check-out crea aquí un registro por huésped y acompañante.'
              "
              [actionButtonText]="hasFilters() ? 'Limpiar filtros' : 'Ir a Recepción'"
              [showActionButton]="true"
              (actionClick)="hasFilters() ? clearFilters() : goToFrontDesk()"
            />
          } @else {
            <app-responsive-data-view
              [data]="rows()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="actions"
              [striped]="true"
              [hoverable]="true"
              (rowClick)="openReservation($event)"
              emptyMessage="No hay registros con ese criterio"
              emptyIcon="search"
              data-testid="tra-table"
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

      <app-reservation-detail-modal
        [reservationId]="detailId()"
        (closed)="detailId.set(null)"
        (changed)="reload()"
      />

      <app-tra-token-modal
        [isOpen]="tokenOpen()"
        [summary]="summary()"
        (closed)="tokenOpen.set(false)"
        (changed)="reload()"
      />
    </div>
  `,
})
export class HospitalityTraPageComponent implements OnInit {
  private readonly traService = inject(LodgingTraService);
  private readonly exportService = inject(ReportExportService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly authFacade = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageSize = PAGE_SIZE;
  readonly tokenUrl = TRA_TOKEN_URL;

  readonly summary = signal<TraSummary | null>(null);
  readonly summaryError = signal(false);
  readonly items = signal<TraSubmission[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly page = signal(1);
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly retrying = signal(false);
  readonly exporting = signal(false);
  readonly tokenOpen = signal(false);
  readonly detailId = signal<number | null>(null);

  readonly canOperate = signal(this.authFacade.hasPermission('store:lodging:front_desk:operate'));
  readonly canManage = signal(this.authFacade.hasPermission('store:lodging:channels:manage'));

  readonly openCount = computed(() => {
    const stats = this.summary()?.stats;
    return stats ? stats.pending + stats.failed : 0;
  });

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      placeholder: 'Todos los estados',
      options: (Object.keys(TRA_STATUS_LABELS) as TraStatus[]).map((value) => ({
        value,
        label: TRA_STATUS_LABELS[value],
      })),
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      label: this.exporting() ? 'Exportando...' : 'Exportar a Excel',
      icon: 'download',
      action: 'export',
      variant: 'outline',
      disabled: this.exporting(),
    },
    { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' },
  ]);

  readonly rows = computed<TraRow[]>(() =>
    this.items().map((item) => ({
      id: item.id,
      reservation_id: item.reservation_id,
      reservation_number: item.reservation_number,
      guest: item.is_primary ? item.guest_name : `${item.guest_name} (acompañante)`,
      event_label: EVENT_LABELS[item.event] ?? item.event,
      status: item.status,
      when_label: item.sent_at ? dateTime(item.sent_at) : '—',
      detail: this.detailOf(item),
    })),
  );

  readonly columns: TableColumn[] = [
    { key: 'guest', label: 'Huésped' },
    { key: 'reservation_number', label: 'Reserva' },
    { key: 'event_label', label: 'Evento' },
    {
      key: 'status',
      label: 'Estado',
      width: '140px',
      badge: true,
      badgeConfig: STATUS_BADGE,
      transform: (value: TraStatus) => TRA_STATUS_LABELS[value] ?? value,
    },
    { key: 'when_label', label: 'Hora' },
    { key: 'detail', label: 'Detalle', priority: 3 },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'guest',
    subtitleTransform: (row: TraRow) => `${row.reservation_number} · ${row.event_label}`,
    badgeKey: 'status',
    badgeConfig: STATUS_BADGE,
    badgeTransform: (value: TraStatus) => TRA_STATUS_LABELS[value] ?? value,
    detailKeys: [
      { key: 'when_label', label: 'Hora' },
      { key: 'detail', label: 'Detalle' },
    ],
  };

  /** R-ROW-01 — every row opens its reservation; open ones also retry or get marked. */
  readonly actions: TableAction[] = [
    {
      label: 'Ver reserva',
      icon: 'eye',
      variant: 'secondary',
      action: (row: TraRow) => this.openReservation(row),
    },
    {
      label: 'Reintentar',
      icon: 'refresh-cw',
      variant: 'primary',
      show: (row: TraRow) => this.canOperate() && OPEN.includes(row.status),
      action: (row: TraRow) => this.retryOne(row),
    },
    {
      label: 'Marcar reportado',
      icon: 'check-check',
      variant: 'secondary',
      show: (row: TraRow) => this.canOperate() && OPEN.includes(row.status),
      action: (row: TraRow) => void this.markReported(row),
    },
  ];

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loadSummary();
    this.loadList();
  }

  hasFilters(): boolean {
    return !!this.search() || isStatus(this.filterValues()['status']);
  }

  onSearch(term: string | null): void {
    const next = (term ?? '').trim();
    if (next === this.search()) return;
    this.search.set(next);
    this.page.set(1);
    this.loadList();
  }

  onFilterChange(values: FilterValues): void {
    const status = isStatus(values['status']) ? values['status'] : null;
    this.filterValues.set({ status });
    this.page.set(1);
    this.loadList();
  }

  clearFilters(): void {
    this.search.set('');
    this.onFilterChange({});
  }

  goToFrontDesk(): void {
    window.location.assign('/admin/hospitality/front-desk');
  }

  onPage(page: number): void {
    this.page.set(page);
    this.loadList();
  }

  onActionClick(action: string): void {
    if (action === 'refresh') this.reload();
    if (action === 'export') this.export();
  }

  openReservation(row: TraRow): void {
    this.detailId.set(row.reservation_id);
  }

  retryAll(): void {
    this.retry(undefined);
  }

  retryOne(row: TraRow): void {
    this.retry([row.id]);
  }

  /** R-CONF-02 — hand-reported records cannot be sent again: confirm first. */
  async markReported(row: TraRow): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Marcar como reportado en el portal',
      message:
        `Confirma que ya registraste el ${row.event_label.toLowerCase()} de ${row.guest} ` +
        `(reserva ${row.reservation_number}) en tramincit.gov.co. Vendix no lo enviará después.`,
      confirmText: 'Marcar reportado',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;
    this.traService
      .markReported([row.id])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Registro marcado como reportado en el portal');
          this.reload();
        },
        error: (message: unknown) =>
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo marcar el registro'),
      });
  }

  when(value: string): string {
    return dateTime(value);
  }

  count(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : value.toLocaleString('es-CO');
  }

  private retry(ids: number[] | undefined): void {
    if (this.retrying()) return;
    this.retrying.set(true);
    this.traService
      .retry(ids)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ queued }) => {
          this.retrying.set(false);
          if (queued > 0) {
            this.toastService.success(
              queued === 1 ? 'Reintentando 1 registro' : `Reintentando ${queued} registros`,
            );
          } else {
            this.toastService.info('No hay registros pendientes');
          }
          // The queue answers in seconds: refresh shortly after.
          setTimeout(() => this.reload(), 3000);
        },
        error: (message: unknown) => {
          this.retrying.set(false);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo reintentar');
        },
      });
  }

  private detailOf(item: TraSubmission): string {
    if (item.status === 'manual') {
      return item.reported_by_name ? `Marcado por ${item.reported_by_name}` : 'Marcado a mano';
    }
    if (item.status === 'sent') return 'Recibido por la TRA';
    // The banner above carries the full store-wide message; rows keep it short.
    if (item.error_code === 'not_configured') return 'Envío automático no disponible';
    if (item.error_code === 'token_missing') return 'Falta el token TRA';
    if (item.error_code === 'token_expired') return 'Token TRA vencido';
    return item.last_error ?? 'En cola de envío';
  }

  private status(): TraStatus | undefined {
    const value = this.filterValues()['status'];
    return isStatus(value) ? value : undefined;
  }

  private loadSummary(): void {
    this.summaryError.set(false);
    this.traService
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
    this.traService
      .list({
        page: this.page(),
        limit: PAGE_SIZE,
        search: this.search() || undefined,
        status: this.status(),
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

  /** The TRA fields of the open records (or the filtered ones) to load in the portal. */
  private export(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.traService
      .export({ search: this.search() || undefined, status: this.status() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.exporting.set(false);
          this.exportService.downloadBlob(blob, 'tra_registros');
          this.toastService.success('Archivo TRA descargado');
        },
        error: () => {
          this.exporting.set(false);
          this.toastService.error('No se pudo exportar el archivo TRA');
        },
      });
  }
}
