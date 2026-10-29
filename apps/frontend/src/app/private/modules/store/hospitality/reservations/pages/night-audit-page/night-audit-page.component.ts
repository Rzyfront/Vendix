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
  BadgeComponent,
  BadgeVariant,
  ButtonComponent,
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ModalComponent,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  ScrollableTab,
  ScrollableTabsComponent,
  StatsComponent,
  TableColumn,
  TextareaComponent,
  ToastService,
  ToggleComponent,
  SpinnerComponent,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { NightAuditView } from '../../interfaces/night-audit.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import { ReservationDetailModalComponent } from '../../components/reservation-detail-modal/reservation-detail-modal.component';
import { HospitalityLoadErrorComponent } from '../../../shared/load-error.component';

type AuditTab = 'pending_arrivals' | 'no_shows' | 'discrepancies';

interface AuditRow {
  id: string;
  /** U15 (R-NAV-07) — the row opens this reservation. */
  reservation_id: number;
  reservation_number: string;
  guest_name: string;
  room: string;
  amount_label: string;
  reason: string;
}

const STATUS_LABELS: Record<NightAuditView['status'], { label: string; variant: BadgeVariant }> = {
  open: { label: 'Abierto', variant: 'warning' },
  closed: { label: 'Cerrado', variant: 'success' },
  reopened: { label: 'Reabierto', variant: 'info' },
};

const REASON_BADGE = {
  type: 'custom' as const,
  size: 'sm' as const,
  colorMap: { not_posted: 'var(--color-warning)', voided: 'var(--color-error)' },
};

const reasonLabel = (value: string): string =>
  value === 'voided' ? 'Noche anulada' : 'Noche sin cargar';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `2026-11-10` → `10 nov 2026`. */
function longDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** `2026-11-10` → `10 nov`. */
function shortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** R-CONF-04 — the reopen reason the API accepts: 3 to 500 characters. */
const REOPEN_REASON_MIN = 3;

/** Case- and accent-insensitive "contains". */
function matches(term: string, ...values: (string | null | undefined)[]): boolean {
  const normalize = (v: string) =>
    v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const needle = normalize(term.trim());
  return !needle || values.some((v) => !!v && normalize(v).includes(needle));
}

const EMPTY_TEXT: Record<AuditTab, { icon: string; title: string; description: string }> = {
  pending_arrivals: {
    icon: 'log-in',
    title: 'Sin llegadas pendientes',
    description: 'Las reservas confirmadas del día que no hicieron check-in aparecen aquí.',
  },
  no_shows: {
    icon: 'user-x',
    title: 'Sin no presentados',
    description: 'Las llegadas que no se presentaron aparecen aquí.',
  },
  discrepancies: {
    icon: 'check-circle',
    title: 'Sin descuadre',
    description: 'Cada huésped en casa tiene su noche cargada en el folio.',
  },
};

/**
 * Hospitality Suite — "Cierre del día" (H7.1). The night auditor reviews the
 * business day (nights charged, no-shows, pending arrivals and the
 * discrepancy) and closes it: the nights are posted, pending arrivals become
 * no-show and the date is frozen until a manager reopens it with a reason.
 *
 * Standard admin list module: four stats, the tabs (pending arrivals,
 * no-shows, discrepancy), one card with the sticky search, the visible
 * "Cerrar día" / "Reabrir día" button (U15, R-CTA-04), the options dropdown
 * (refresh) and the responsive data view. A day picker with "Aplicar" loads
 * another business day. Closing confirms with the nights, amount and
 * no-shows it will record; reopening asks the reason inside its dialog.
 * Every row opens its reservation.
 */
@Component({
  selector: 'app-hospitality-night-audit-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SpinnerComponent,
    FormsModule,
    HospitalityLoadErrorComponent,
    IconComponent,
    InputComponent,
    ReservationDetailModalComponent,
    StatsComponent,
    CardComponent,
    BadgeComponent,
    ButtonComponent,
    EmptyStateComponent,
    InputsearchComponent,
    ModalComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    ScrollableTabsComponent,
    TextareaComponent,
    ToggleComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Noches cargadas"
          [value]="nightsLabel()"
          smallText="cargadas / habitaciones ocupadas"
          iconName="bed-double"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading() && !audit()"
        />
        <app-stats
          title="Ingreso alojamiento"
          [value]="revenueLabel()"
          smallText="noches del día"
          iconName="wallet"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading() && !audit()"
        />
        <app-stats
          title="No presentados"
          [value]="summary()?.no_shows?.length ?? 0"
          [smallText]="pendingLabel()"
          iconName="user-x"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading() && !audit()"
        />
        <app-stats
          title="Descuadre"
          [value]="summary()?.discrepancies?.length ?? 0"
          smallText="noches sin cargar o anuladas"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
          [loading]="loading() && !audit()"
        />
      </div>

      <app-scrollable-tabs
        ariaLabel="Cierre del día"
        [tabs]="tabs()"
        [activeTab]="tab()"
        (tabChange)="onTab($event)"
      />

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
              class="flex flex-wrap items-center gap-2 text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              <span>
                {{ dayTitle() }}
                <span class="text-text-secondary font-normal">({{ rows().length }})</span>
              </span>
              @if (audit()) {
                <app-badge [variant]="statusBadge().variant" size="sm" data-testid="audit-status">
                  {{ statusBadge().label }}
                </app-badge>
              }
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
              <!-- U15 (R-CTA-04) — closing the day is a visible button, never a dropdown item -->
              @if (canClose()) {
                <app-button
                  variant="primary"
                  size="md"
                  customClasses="!h-11 !px-3 md:!px-4 !rounded-[10px] whitespace-nowrap"
                  class="shrink-0"
                  [ariaLabel]="closeLabel()"
                  [disabled]="busy()"
                  (clicked)="openClose()"
                  data-testid="audit-close-open"
                >
                  <app-icon slot="icon" name="moon" [size]="18" />
                  <span class="md:hidden">Cerrar día</span>
                  <span class="hidden md:inline">{{ closeLabel() }}</span>
                </app-button>
              } @else if (canReopenDay()) {
                <app-button
                  variant="outline"
                  size="md"
                  customClasses="!h-11 !px-3 md:!px-4 bg-surface !rounded-[10px] whitespace-nowrap"
                  class="shrink-0"
                  [ariaLabel]="'Reabrir día · ' + shortDay()"
                  [disabled]="busy()"
                  (clicked)="openReopen()"
                  data-testid="audit-reopen-open"
                >
                  <app-icon slot="icon" name="unlock" [size]="18" />
                  Reabrir día
                </app-button>
              }
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [actions]="dropdownActions"
                [isLoading]="loading() || busy()"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <!-- U15 (RP7) — another business day loads only on "Aplicar" -->
          <form
            class="mb-3 flex flex-wrap items-end gap-2"
            (ngSubmit)="applyDate()"
            data-testid="audit-date-form"
          >
            <app-input
              class="w-44"
              label="Día de negocio"
              type="date"
              size="sm"
              customWrapperClass="mt-0"
              name="business_date"
              [max]="currentDay() ?? ''"
              [ngModel]="pickedDate()"
              (ngModelChange)="pickedDate.set($event ?? '')"
              data-testid="audit-date"
            />
            <app-button
              type="submit"
              variant="outline"
              size="sm"
              customClasses="min-h-11 sm:min-h-0"
              [disabled]="!canApplyDate()"
              data-testid="audit-date-apply"
            >
              Aplicar
            </app-button>
            @if (currentDay() && audit()?.business_date !== currentDay()) {
              <app-button
                variant="ghost"
                size="sm"
                customClasses="min-h-11 sm:min-h-0"
                (clicked)="goToCurrentDay()"
                data-testid="audit-date-current"
              >
                Ir al día actual
              </app-button>
            }
          </form>

          @if (audit(); as a) {
            @if (a.status === 'closed') {
              <p class="mb-3 text-sm text-text-secondary" data-testid="audit-closed-note">
                Cerrado {{ a.closed_by ? 'por ' + a.closed_by : '' }} el {{ formatDateTime(a.closed_at) }} —
                no se pueden cargar ni anular noches de esta fecha sin reabrir el día.
              </p>
            } @else if (a.status === 'reopened') {
              <p class="mb-3 text-sm text-text-secondary" data-testid="audit-reopened-note">
                Reabierto {{ a.reopened_by ? 'por ' + a.reopened_by : '' }} el {{ formatDateTime(a.reopened_at) }}:
                «{{ a.reopen_reason }}».
              </p>
            }
          }

          @if (loadError(); as message) {
            <app-hospitality-load-error
              what="el cierre del día"
              [message]="message"
              (retry)="load(requestedDate())"
            />
          } @else if (loading() && !audit()) {
            <div class="p-4 md:p-6">
              <app-spinner [center]="true" text="Cargando el día…" />
            </div>
          } @else if (rows().length === 0 && search()) {
            <app-empty-state
              icon="search"
              title="Sin resultados"
              description="Ninguna reserva coincide con la búsqueda."
              actionButtonText="Limpiar búsqueda"
              [showActionButton]="true"
              (actionClick)="search.set('')"
            />
          } @else if (rows().length === 0) {
            <app-empty-state
              [icon]="emptyText().icon"
              [title]="emptyText().title"
              [description]="emptyText().description"
              [showActionButton]="false"
            />
          } @else {
            <app-responsive-data-view
              [data]="rows()"
              [columns]="columns()"
              [cardConfig]="cardConfig()"
              [striped]="true"
              [hoverable]="true"
              (rowClick)="openReservation($event)"
              emptyMessage="No hay reservas con ese criterio"
              emptyIcon="search"
              data-testid="audit-rows"
            />
          }
        </div>
      </app-card>

      <app-modal
        [isOpen]="confirmingClose()"
        (isOpenChange)="!$event && confirmingClose.set(false)"
        (cancel)="confirmingClose.set(false)"
        size="sm"
        [title]="'Cerrar el día ' + longDay()"
        subtitle="Cierre del día"
      >
        <div class="flex flex-col gap-3 text-sm">
          <!-- U15 (R-CONF-01) — the figures the close will record -->
          <p class="font-medium text-text-primary" data-testid="audit-close-figures">
            {{ closeFigures() }}
          </p>
          <app-toggle
            label="Marcar como no presentadas las llegadas pendientes"
            [checked]="markNoShows()"
            (changed)="markNoShows.set($event)"
            data-testid="audit-mark-no-shows"
          />
          <p class="text-text-secondary">
            Después no se podrán cargar ni anular noches de esta fecha sin reabrir el día.
          </p>
        </div>
        <div slot="footer" class="flex justify-end gap-2">
          <app-button variant="ghost" (clicked)="confirmingClose.set(false)">Cancelar</app-button>
          <app-button
            variant="primary"
            [loading]="busy()"
            [disabled]="busy()"
            (clicked)="close()"
            data-testid="audit-close"
          >
            {{ closeLabel() }}
          </app-button>
        </div>
      </app-modal>

      <!-- U15 (R-CONF-04) — the reason is asked and validated inside the dialog -->
      <app-modal
        [isOpen]="reopening()"
        (isOpenChange)="!$event && reopening.set(false)"
        (cancel)="reopening.set(false)"
        size="sm"
        [title]="'Reabrir el día ' + longDay()"
        subtitle="Cierre del día"
      >
        <form class="flex flex-col gap-3 text-sm" (ngSubmit)="reopen()" data-testid="audit-reopen-form">
          <p class="text-text-secondary">
            {{ reopenImpact() }}
          </p>
          <app-textarea
            name="reopen_reason"
            label="Motivo de la reapertura"
            [required]="true"
            [rows]="2"
            placeholder="Ej.: faltó cargar un minibar"
            [ngModel]="reopenReason()"
            (ngModelChange)="reopenReason.set($event ?? '')"
            [error]="reopenError()"
            data-testid="audit-reopen-reason"
          />
        </form>
        <div slot="footer" class="flex justify-end gap-2">
          <app-button variant="ghost" (clicked)="reopening.set(false)">Cancelar</app-button>
          <app-button
            variant="primary"
            [loading]="busy()"
            [disabled]="busy()"
            (clicked)="reopen()"
            data-testid="audit-reopen"
          >
            Reabrir día · {{ shortDay() }}
          </app-button>
        </div>
      </app-modal>

      <app-reservation-detail-modal
        [reservationId]="detailId()"
        (closed)="detailId.set(null)"
        (changed)="load(audit()?.business_date)"
      />
    </div>
  `,
})
export class HospitalityNightAuditPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly toastService = inject(ToastService);
  private readonly authFacade = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currency = inject(CurrencyFormatService);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly markNoShows = signal(true);
  readonly confirmingClose = signal(false);
  readonly reopening = signal(false);
  readonly reopenReason = signal('');
  readonly reopenSubmitted = signal(false);
  readonly audit = signal<NightAuditView | null>(null);
  /** R-FB-02 — reason of the last failed load; null = loaded or loading. */
  readonly loadError = signal<string | null>(null);
  readonly canReopen = signal(this.authFacade.hasPermission('store:lodging:night_audit:reopen'));
  /** Reservation opened from a row (R-NAV-07); null keeps the detail closed. */
  readonly detailId = signal<number | null>(null);

  readonly tab = signal<AuditTab>('pending_arrivals');
  readonly search = signal('');
  /** Store's current business day, learnt from the first load without a date. */
  readonly currentDay = signal<string | null>(null);
  /** Day typed in the picker; it loads only on "Aplicar" (RP7). */
  readonly pickedDate = signal('');
  /** Day the last load asked for; "Reintentar" repeats it. */
  readonly requestedDate = signal<string | undefined>(undefined);

  readonly dropdownActions: DropdownAction[] = [
    { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' },
  ];

  readonly summary = computed(() => this.audit()?.summary ?? null);
  readonly statusBadge = computed(() => STATUS_LABELS[this.audit()?.status ?? 'open']);
  readonly pendingCount = computed(() => this.summary()?.pending_arrivals.length ?? 0);
  readonly pendingLabel = computed(() =>
    plural(this.pendingCount(), 'llegada pendiente', 'llegadas pendientes'),
  );
  readonly shortDay = computed(() => {
    const date = this.audit()?.business_date;
    return date ? shortDate(date) : '';
  });
  readonly longDay = computed(() => {
    const date = this.audit()?.business_date;
    return date ? longDate(date) : '';
  });
  readonly closeLabel = computed(() => `Cerrar día · ${this.shortDay()}`);
  readonly canClose = computed(() => {
    const status = this.audit()?.status;
    return !!status && status !== 'closed' && !this.loadError();
  });
  readonly canReopenDay = computed(
    () => this.audit()?.status === 'closed' && this.canReopen() && !this.loadError(),
  );

  /**
   * Nights and amount "Cerrar día" will charge: the API preview, or — when it
   * is missing — the unposted nights already loaded (the discrepancy).
   */
  readonly toCharge = computed(() => {
    const preview = this.audit()?.close_preview;
    if (preview) return { nights: preview.nights, amount: Number(preview.amount) };
    const unposted = (this.summary()?.discrepancies ?? []).filter((d) => d.reason === 'not_posted');
    return {
      nights: unposted.length,
      amount: unposted.reduce((sum, d) => sum + Number(d.rate_amount), 0),
    };
  });

  /** R-CONF-01 — "Se cargarán 4 noches por $1.120.000 y se marcará 1 no presentado. Llegadas pendientes: 0". */
  readonly closeFigures = computed(() => {
    const { nights, amount } = this.toCharge();
    const pending = this.pendingCount();
    const marked = this.markNoShows() ? pending : 0;
    const charge =
      nights > 0
        ? `Se ${nights === 1 ? 'cargará' : 'cargarán'} ${plural(nights, 'noche', 'noches')} por ${this.currency.format(amount, 0)}`
        : 'No hay noches por cargar';
    const noShows =
      marked > 0
        ? `se ${marked === 1 ? 'marcará' : 'marcarán'} ${plural(marked, 'no presentado', 'no presentados')}`
        : 'no se marcará ningún no presentado';
    return `${charge} y ${noShows}. Llegadas pendientes: ${pending - marked}`;
  });

  /** R-CONF-01 — what reopening the day unfreezes. */
  readonly reopenImpact = computed(() => {
    const s = this.summary();
    const recorded = s
      ? ` Se cerró con ${plural(s.nights_posted, 'noche cargada', 'noches cargadas')} por ${this.currency.format(s.room_revenue, 0)}.`
      : '';
    return `Se podrán volver a cargar y anular noches del ${this.longDay()}.${recorded}`;
  });

  readonly reopenError = computed(() =>
    this.reopenSubmitted() && this.reopenReason().trim().length < REOPEN_REASON_MIN
      ? 'Escribe el motivo de la reapertura (mínimo 3 caracteres)'
      : '',
  );

  readonly canApplyDate = computed(() => {
    const picked = this.pickedDate();
    return !!picked && picked !== this.audit()?.business_date && !this.loading();
  });

  readonly nightsLabel = computed(() => {
    const s = this.summary();
    return s ? `${s.nights_posted} / ${s.rooms_occupied}` : '0';
  });
  readonly revenueLabel = computed(() => this.currency.format(this.summary()?.room_revenue ?? 0, 0));

  readonly dayTitle = computed(() => {
    const date = this.audit()?.business_date;
    return date ? `Día ${longDate(date)}` : 'Día de negocio';
  });

  readonly tabs = computed<ScrollableTab[]>(() => {
    const s = this.summary();
    return [
      {
        id: 'pending_arrivals',
        label: `Llegadas pendientes (${s?.pending_arrivals.length ?? 0})`,
        icon: 'log-in',
      },
      { id: 'no_shows', label: `No presentados (${s?.no_shows.length ?? 0})`, icon: 'user-x' },
      {
        id: 'discrepancies',
        label: `Descuadre (${s?.discrepancies.length ?? 0})`,
        icon: 'alert-triangle',
      },
    ];
  });

  readonly emptyText = computed(() => EMPTY_TEXT[this.tab()]);

  readonly rows = computed<AuditRow[]>(() => {
    const s = this.summary();
    if (!s) return [];
    const list: AuditRow[] =
      this.tab() === 'discrepancies'
        ? s.discrepancies.map((d, index) => ({
            id: `${d.reservation_id}-${index}`,
            reservation_id: d.reservation_id,
            reservation_number: d.reservation_number,
            guest_name: d.guest_name ?? '',
            room: d.room,
            amount_label: this.currency.format(d.rate_amount, 0),
            reason: d.reason,
          }))
        : s[this.tab() as 'pending_arrivals' | 'no_shows'].map((r) => ({
            id: String(r.id),
            reservation_id: r.id,
            reservation_number: r.reservation_number,
            guest_name: r.guest_name,
            room: '',
            amount_label: '',
            reason: '',
          }));
    return list.filter((row) =>
      matches(this.search(), row.reservation_number, row.guest_name, row.room),
    );
  });

  readonly columns = computed<TableColumn[]>(() =>
    this.tab() === 'discrepancies'
      ? [
          { key: 'reservation_number', label: 'Reserva' },
          { key: 'guest_name', label: 'Huésped' },
          { key: 'room', label: 'Habitación' },
          { key: 'amount_label', label: 'Tarifa', align: 'right' },
          {
            key: 'reason',
            label: 'Motivo',
            badge: true,
            badgeConfig: REASON_BADGE,
            transform: reasonLabel,
          },
        ]
      : [
          { key: 'reservation_number', label: 'Reserva' },
          { key: 'guest_name', label: 'Huésped' },
        ],
  );

  readonly cardConfig = computed<ItemListCardConfig>(() =>
    this.tab() === 'discrepancies'
      ? {
          titleKey: 'reservation_number',
          subtitleTransform: (row: AuditRow) =>
            [row.guest_name, row.room].filter(Boolean).join(' · '),
          badgeKey: 'reason',
          badgeConfig: REASON_BADGE,
          badgeTransform: reasonLabel,
          footerKey: 'amount_label',
          footerLabel: 'Tarifa',
        }
      : { titleKey: 'reservation_number', subtitleKey: 'guest_name' },
  );

  ngOnInit(): void {
    // Without a date the API answers with the store's current business day.
    this.load();
  }

  load(date?: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.requestedDate.set(date || undefined);
    this.reservationsService
      .nightAudit(date || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (audit) => {
          if (!date) this.currentDay.set(audit.business_date);
          this.show(audit);
        },
        error: (message: unknown) => {
          this.loading.set(false);
          this.audit.set(null);
          this.loadError.set(typeof message === 'string' ? message : 'Inténtalo de nuevo.');
        },
      });
  }

  onTab(id: string): void {
    this.tab.set(id as AuditTab);
  }

  onSearch(term: string | null): void {
    this.search.set((term ?? '').trim());
  }

  /** RP7 — the picked day loads only here, not on every keystroke. */
  applyDate(): void {
    if (!this.canApplyDate()) return;
    this.load(this.pickedDate());
  }

  goToCurrentDay(): void {
    this.load();
  }

  onActionClick(action: string): void {
    if (action === 'refresh') this.load(this.audit()?.business_date);
  }

  openReservation(row: AuditRow): void {
    this.detailId.set(row.reservation_id);
  }

  openClose(): void {
    if (!this.canClose() || this.busy()) return;
    this.confirmingClose.set(true);
  }

  close(): void {
    const audit = this.audit();
    if (!audit || this.busy()) return;
    this.busy.set(true);
    this.reservationsService
      .closeNightAudit(audit.business_date, this.markNoShows())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          this.confirmingClose.set(false);
          this.show(result);
          this.toastService.success(`Día ${shortDate(result.business_date)} cerrado`);
        },
        error: (message: unknown) => this.fail(message, 'No se pudo cerrar el día'),
      });
  }

  openReopen(): void {
    if (!this.canReopenDay() || this.busy()) return;
    this.reopenReason.set('');
    this.reopenSubmitted.set(false);
    this.reopening.set(true);
  }

  /** R-CONF-04 — an invalid reason stays in the dialog with its error under the field. */
  reopen(): void {
    const audit = this.audit();
    if (!audit || this.busy()) return;
    this.reopenSubmitted.set(true);
    if (this.reopenError()) return;
    this.busy.set(true);
    this.reservationsService
      .reopenNightAudit(audit.business_date, this.reopenReason().trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          this.reopening.set(false);
          this.show(result);
          this.toastService.success(`Día ${shortDate(result.business_date)} reabierto`);
        },
        error: (message: unknown) => this.fail(message, 'No se pudo reabrir el día'),
      });
  }

  formatDateTime(value: string | null): string {
    // R-FORM-11 — "28 oct 2026, 8:26 p. m.", never "28/10/2026".
    if (!value) return '';
    const date = new Date(value);
    const time = date.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${time}`;
  }

  private show(audit: NightAuditView): void {
    this.audit.set(audit);
    this.pickedDate.set(audit.business_date);
    this.loading.set(false);
  }

  private fail(message: unknown, fallback: string): void {
    this.busy.set(false);
    this.toastService.error(typeof message === 'string' ? message : fallback);
  }
}
