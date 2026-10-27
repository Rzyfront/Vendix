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
  DialogService,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  ModalComponent,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  ScrollableTab,
  ScrollableTabsComponent,
  StatsComponent,
  TableColumn,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { NightAuditView } from '../../interfaces/night-audit.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

type AuditTab = 'pending_arrivals' | 'no_shows' | 'discrepancies';

interface AuditRow {
  id: string;
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
  colorMap: { not_posted: '#f59e0b', voided: '#ef4444' },
};

const reasonLabel = (value: string): string =>
  value === 'voided' ? 'Noche anulada' : 'Noche sin cargar';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `2026-11-10` → `10 nov 2026`. */
function longDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

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
    title: 'Sin no-shows',
    description: 'Las llegadas que no se presentaron y quedaron como no-show aparecen aquí.',
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
 * no-shows, discrepancy), one card with the sticky search and the options
 * dropdown (business day filter + close/reopen/refresh actions) and the
 * responsive data view. Closing asks for confirmation in a modal.
 */
@Component({
  selector: 'app-hospitality-night-audit-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
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
          title="No-shows"
          [value]="summary()?.no_shows?.length ?? 0"
          [smallText]="(summary()?.pending_arrivals?.length ?? 0) + ' llegadas pendientes'"
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
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [actions]="dropdownActions()"
                [isLoading]="loading() || busy()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="onFilterChange({})"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
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

          @if (loading() && !audit()) {
            <div class="p-4 md:p-6 text-center">
              <div
                class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
              <p class="mt-2 text-text-secondary">Cargando el día...</p>
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
        [title]="'Cerrar el día ' + (audit()?.business_date ?? '')"
        subtitle="Auditoría nocturna"
      >
        <div class="flex flex-col gap-3 text-sm">
          <p class="text-text-secondary">{{ closeMessage() }}</p>
          <app-toggle
            label="Marcar como no-show las llegadas pendientes"
            [checked]="markNoShows()"
            (changed)="markNoShows.set($event)"
            data-testid="audit-mark-no-shows"
          />
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
            Cerrar día
          </app-button>
        </div>
      </app-modal>
    </div>
  `,
})
export class HospitalityNightAuditPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly authFacade = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currency = inject(CurrencyFormatService);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly markNoShows = signal(true);
  readonly confirmingClose = signal(false);
  readonly audit = signal<NightAuditView | null>(null);
  readonly canReopen = signal(this.authFacade.hasPermission('store:lodging:night_audit:reopen'));

  readonly tab = signal<AuditTab>('pending_arrivals');
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({});

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'business_date',
      label: 'Día de negocio',
      type: 'date',
      helpText: 'Sin fecha se muestra el día de negocio actual.',
    },
  ];

  readonly summary = computed(() => this.audit()?.summary ?? null);
  readonly statusBadge = computed(() => STATUS_LABELS[this.audit()?.status ?? 'open']);
  readonly pendingCount = computed(() => this.summary()?.pending_arrivals.length ?? 0);
  readonly closeMessage = computed(
    () =>
      'Se cargan las noches de los huéspedes en casa' +
      (this.markNoShows() && this.pendingCount() > 0
        ? ` y ${this.pendingCount()} llegada(s) pendiente(s) pasan a no-show`
        : '') +
      '. Después no se podrán cargar ni anular noches de esta fecha sin reabrir el día.',
  );
  readonly nightsLabel = computed(() => {
    const s = this.summary();
    return s ? `${s.nights_posted} / ${s.rooms_occupied}` : '0';
  });
  readonly revenueLabel = computed(() => this.currency.format(this.summary()?.room_revenue ?? 0, 0));

  readonly dayTitle = computed(() => {
    const date = this.audit()?.business_date;
    return date ? `Día ${longDate(date)}` : 'Día de negocio';
  });

  /** Close while the day is open or reopened; reopen only with permission. */
  readonly dropdownActions = computed<DropdownAction[]>(() => {
    const status = this.audit()?.status;
    const actions: DropdownAction[] = [];
    if (status && status !== 'closed') {
      actions.push({ label: 'Cerrar día', icon: 'moon', action: 'close', variant: 'primary' });
    } else if (status === 'closed' && this.canReopen()) {
      actions.push({ label: 'Reabrir día', icon: 'unlock', action: 'reopen', variant: 'outline' });
    }
    actions.push({ label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' });
    return actions;
  });

  readonly tabs = computed<ScrollableTab[]>(() => {
    const s = this.summary();
    return [
      {
        id: 'pending_arrivals',
        label: `Llegadas pendientes (${s?.pending_arrivals.length ?? 0})`,
        icon: 'log-in',
      },
      { id: 'no_shows', label: `No-shows (${s?.no_shows.length ?? 0})`, icon: 'user-x' },
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
            reservation_number: d.reservation_number,
            guest_name: '',
            room: d.room,
            amount_label: this.currency.format(d.rate_amount, 0),
            reason: d.reason,
          }))
        : s[this.tab() as 'pending_arrivals' | 'no_shows'].map((r) => ({
            id: String(r.id),
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
          subtitleKey: 'room',
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
    this.reservationsService
      .nightAudit(date || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (audit) => this.show(audit),
        error: (message: unknown) => {
          this.loading.set(false);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo cargar el día');
        },
      });
  }

  onTab(id: string): void {
    this.tab.set(id as AuditTab);
  }

  onSearch(term: string | null): void {
    this.search.set((term ?? '').trim());
  }

  /** The date filter reloads that day; clearing it goes back to the current day. */
  onFilterChange(values: FilterValues): void {
    const date = values['business_date'];
    const picked = typeof date === 'string' && date ? date : '';
    this.filterValues.set(picked ? { business_date: picked } : {});
    this.load(picked || undefined);
  }

  onActionClick(action: string): void {
    if (action === 'close') this.confirmingClose.set(true);
    else if (action === 'reopen') void this.reopen();
    else if (action === 'refresh') this.load(this.audit()?.business_date);
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
          this.toastService.success(`Día ${result.business_date} cerrado`);
        },
        error: (message: unknown) => this.fail(message, 'No se pudo cerrar el día'),
      });
  }

  async reopen(): Promise<void> {
    const audit = this.audit();
    if (!audit) return;
    const reason = (
      await this.dialogService.prompt({
        title: `Reabrir el día ${audit.business_date}`,
        message: 'Escribe el motivo de la reapertura.',
        placeholder: 'Ej.: faltó cargar un minibar',
        confirmText: 'Reabrir',
      })
    )?.trim();
    if (!reason) return;
    if (reason.length < 3) {
      this.toastService.error('Escribe el motivo de la reapertura');
      return;
    }
    this.busy.set(true);
    this.reservationsService
      .reopenNightAudit(audit.business_date, reason)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          this.show(result);
          this.toastService.success(`Día ${result.business_date} reabierto`);
        },
        error: (message: unknown) => this.fail(message, 'No se pudo reabrir el día'),
      });
  }

  formatDateTime(value: string | null): string {
    return value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }

  private show(audit: NightAuditView): void {
    this.audit.set(audit);
    this.loading.set(false);
  }

  private fail(message: unknown, fallback: string): void {
    this.busy.set(false);
    this.toastService.error(typeof message === 'string' ? message : fallback);
  }
}
