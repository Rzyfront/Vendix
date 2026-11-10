import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ProductionSseService } from '../../../restaurant-ops/production/services/production-sse.service';
import { Router } from '@angular/router';
import { Subscription, forkJoin } from 'rxjs';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components';
import { formatStoreDateTime, storeToday } from '../../../../../../shared/utils/date.util';
import { ScheduleDetailModalComponent } from '../../components/schedule-detail-modal/schedule-detail-modal.component';
import {
  AgendaViewMode,
  FulfillmentDay,
  FulfillmentSlot,
  DISPLAY_STATUS_COLORS,
  DISPLAY_STATUS_LABELS,
  DISPLAY_STATUS_ORDER,
  RESCHEDULABLE_STATUSES,
  RESCHEDULABLE_STORED_STATUSES,
  ScheduledOrder,
  ScheduledOrderDisplayStatus,
  customerName,
} from '../../interfaces/scheduled-order.interface';
import { AgendaPreferencesService } from '../../services/agenda-preferences.service';
import { ScheduledOrdersApiService } from '../../services/scheduled-orders-api.service';
import { addDays, dayMonth, fullDate, mondayOf, weekdayShort } from '../../utils/ymd.util';

interface AgendaCell {
  key: string;
  slot: FulfillmentSlot | null;
  orders: ScheduledOrder[];
}

interface AgendaRow {
  key: string;
  label: string;
  cells: AgendaCell[];
}

type StatusFilter = ScheduledOrderDisplayStatus | 'all';

@Component({
  selector: 'app-scheduled-orders-agenda-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CardComponent,
    IconComponent,
    SpinnerComponent,
    StatsComponent,
    StickyHeaderComponent,
    ScheduleDetailModalComponent,
  ],
  styles: [
    `
      :host {
        display: block;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
      }
      .toolbar-group {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .date-label {
        font-weight: 600;
        color: var(--color-text-primary);
        text-transform: capitalize;
      }
      .mode-btn {
        padding: 0.375rem 0.75rem;
        font-size: var(--fs-sm, 0.875rem);
        border: 1px solid var(--color-border);
        background: var(--color-surface);
        color: var(--color-text-secondary, var(--color-text-muted));
        cursor: pointer;
      }
      .mode-btn:first-child {
        border-radius: var(--radius-md, 10px) 0 0 var(--radius-md, 10px);
      }
      .mode-btn:last-child {
        border-radius: 0 var(--radius-md, 10px) var(--radius-md, 10px) 0;
      }
      .mode-btn.active {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: var(--color-text-on-primary, #fff);
      }
      .status-select {
        padding: 0.375rem 0.625rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md, 10px);
        background: var(--color-surface);
        color: var(--color-text-primary);
        font-size: var(--fs-sm, 0.875rem);
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-bottom: 0.75rem;
        font-size: var(--fs-xs, 0.75rem);
        color: var(--color-text-muted);
      }
      .legend-dot {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-right: 4px;
        background: var(--st);
      }
      .grid-wrap {
        overflow-x: auto;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg, 14px);
        background: var(--color-surface);
      }
      .agenda-grid {
        display: grid;
        grid-template-columns: 56px repeat(var(--cols), minmax(150px, 1fr));
        min-width: min-content;
      }
      .head {
        position: sticky;
        top: 0;
        z-index: 1;
        padding: 0.5rem;
        text-align: center;
        background: var(--color-background);
        border-bottom: 1px solid var(--color-border);
        border-left: 1px solid var(--color-border);
        font-size: var(--fs-sm, 0.875rem);
        color: var(--color-text-primary);
        text-transform: capitalize;
      }
      .head.today {
        color: var(--color-primary);
        font-weight: 700;
      }
      .head small {
        display: block;
        color: var(--color-text-muted);
        font-size: var(--fs-xs, 0.75rem);
      }
      .time-label {
        padding: 0.5rem 0.25rem;
        text-align: center;
        font-size: var(--fs-xs, 0.75rem);
        color: var(--color-text-muted);
        border-bottom: 1px solid var(--color-border);
      }
      .cell {
        min-height: 72px;
        padding: 0.25rem;
        border-left: 1px solid var(--color-border);
        border-bottom: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .cell.closed {
        background: color-mix(in srgb, var(--color-text-muted) 8%, transparent);
      }
      .cell.drop-target {
        outline: 2px dashed var(--color-primary);
        outline-offset: -2px;
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
      }
      .capacity {
        align-self: flex-end;
        font-size: var(--fs-xs, 0.75rem);
        font-weight: 600;
        padding: 0 6px;
        border-radius: 999px;
        color: var(--color-text-muted);
        background: color-mix(in srgb, var(--color-text-muted) 12%, transparent);
      }
      .capacity.full {
        color: var(--color-error, #dc2626);
        background: color-mix(in srgb, var(--color-error, #dc2626) 14%, transparent);
      }
      .card {
        text-align: left;
        padding: 0.25rem 0.5rem;
        border-radius: var(--radius-sm, 8px);
        border-left: 4px solid var(--st);
        background: color-mix(in srgb, var(--st) 14%, var(--color-surface));
        color: var(--color-text-primary);
        font-size: var(--fs-xs, 0.75rem);
        cursor: pointer;
        line-height: 1.3;
      }
      .card.draggable {
        cursor: grab;
      }
      .card.dragging {
        opacity: 0.4;
      }
      .card.cancelled {
        text-decoration: line-through;
        opacity: 0.7;
      }
      .card .num {
        font-weight: 700;
      }
      .card .sub {
        color: var(--color-text-muted);
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .empty {
        padding: 2rem 1rem;
        text-align: center;
        color: var(--color-text-muted);
      }
      .unplaced {
        margin-top: 1rem;
      }
    `,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Agenda de pedidos"
        subtitle="Pedidos programados por franja de entrega"
        icon="calendar-days"
        variant="glass"
        [actions]="headerActions"
        (actionClicked)="onHeaderAction($event)"
      />

      <div
        class="stats-container sticky top-[52px] z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Pedidos"
          [value]="allSchedules().length"
          smallText="En el período"
          iconName="calendar-days"
          iconBgColor="bg-slate-100"
          iconColor="text-slate-600"
          [loading]="loading() && allSchedules().length === 0"
        />
        <app-stats
          title="En producción"
          [value]="countByStatus('in_production')"
          smallText="Se están preparando"
          iconName="flame"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [loading]="loading() && allSchedules().length === 0"
        />
        <app-stats
          title="Listos"
          [value]="countByStatus('ready')"
          smallText="Esperan entrega"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
          [loading]="loading() && allSchedules().length === 0"
        />
        <app-stats
          title="Entregados"
          [value]="countByStatus('delivered')"
          smallText="Ya salieron"
          iconName="package"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
          [loading]="loading() && allSchedules().length === 0"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
      <div class="p-2 md:p-4">
      <div class="toolbar">
        <div class="toolbar-group">
          <app-button variant="ghost" size="sm" (clicked)="goToday()">Hoy</app-button>
          <app-button variant="ghost" size="sm" ariaLabel="Anterior" (clicked)="navigate(-1)">
            <app-icon slot="icon" name="chevron-left" [size]="16"></app-icon>
          </app-button>
          <app-button variant="ghost" size="sm" ariaLabel="Siguiente" (clicked)="navigate(1)">
            <app-icon slot="icon" name="chevron-right" [size]="16"></app-icon>
          </app-button>
          <span class="date-label">{{ rangeLabel() }}</span>
        </div>

        <div class="toolbar-group">
          <select
            class="status-select"
            aria-label="Filtrar por estado"
            (change)="onStatusChange($any($event.target).value)"
          >
            <option value="all" [selected]="statusFilter() === 'all'">Todos los estados</option>
            @for (s of statuses; track s) {
              <option [value]="s" [selected]="statusFilter() === s">{{ labelOf(s) }}</option>
            }
          </select>
          @if (!isMobile()) {
            <div role="group" aria-label="Vista">
              <button
                type="button"
                class="mode-btn"
                [class.active]="view() === 'week'"
                (click)="setView('week')"
              >
                Semana
              </button>
              <button
                type="button"
                class="mode-btn"
                [class.active]="view() === 'day'"
                (click)="setView('day')"
              >
                Día
              </button>
            </div>
          }
        </div>
      </div>

      <div class="legend">
        @for (s of statuses; track s) {
          <span><span class="legend-dot" [style.--st]="colorOf(s)"></span>{{ labelOf(s) }}</span>
        }
      </div>

      @if (errorMessage(); as msg) {
        <div class="empty" role="alert">
          <p>{{ msg }}</p>
          <app-button variant="outline" size="sm" (clicked)="refresh()">Reintentar</app-button>
        </div>
      } @else if (refreshFailed()) {
        <div class="empty" role="alert">
          <p>No se pudo actualizar la agenda. Lo que ves puede estar desactualizado.</p>
          <app-button variant="outline" size="sm" (clicked)="refresh()">Reintentar</app-button>
        </div>
      }

      @if (loading() && rows().length === 0) {
        <div class="flex justify-center py-10"><app-spinner /></div>
      } @else if (!errorMessage()) {
        @if (rows().length === 0) {
          <div class="empty">No hay franjas de entrega configuradas para este período.</div>
        } @else {
          <div class="grid-wrap">
            <div class="agenda-grid" [style.--cols]="days().length">
              <div class="head"></div>
              @for (day of days(); track day.date) {
                <div class="head" [class.today]="day.date === today()">
                  {{ weekday(day.date) }} {{ dayMonthOf(day.date) }}
                  @if (day.blocked_reason) {
                    <small>Cerrado{{ day.exception_reason ? ': ' + day.exception_reason : '' }}</small>
                  }
                </div>
              }

              @for (row of rows(); track row.key) {
                <div class="time-label">{{ row.label }}</div>
                @for (cell of row.cells; track cell.key) {
                  <div
                    class="cell"
                    [class.closed]="!cell.slot"
                    [class.drop-target]="dragOverKey() === cell.key"
                    (dragover)="onDragOver($event, cell)"
                    (dragleave)="onDragLeave(cell)"
                    (drop)="onDrop($event, cell)"
                  >
                    @if (cell.slot; as slot) {
                      <span
                        class="capacity"
                        [class.full]="slot.taken >= slot.capacity"
                        [attr.title]="'Cupo ocupado / capacidad'"
                      >
                        {{ slot.taken }}/{{ slot.capacity }}
                      </span>
                    }
                    @for (o of cell.orders; track o.id) {
                      <div
                        class="card"
                        role="button"
                        tabindex="0"
                        [class.draggable]="canDrag(o)"
                        [class.dragging]="draggingId() === o.id"
                        [class.cancelled]="o.display_status === 'cancelled'"
                        [style.--st]="colorOf(o.display_status)"
                        [attr.draggable]="canDrag(o) ? 'true' : null"
                        (dragstart)="onDragStart($event, o)"
                        (dragend)="onDragEnd()"
                        (click)="openDetail(o)"
                        (keydown.enter)="openDetail(o)"
                      >
                        <span class="num">{{ o.order.order_number }}</span>
                        <span class="sub">{{ customer(o) }}</span>
                        <span class="sub">{{ labelOf(o.display_status) }}</span>
                      </div>
                    }
                  </div>
                }
              }
            </div>
          </div>
        }

        @if (unplaced().length > 0) {
          <div class="unplaced">
            <div class="font-semibold text-sm mb-1" style="color: var(--color-text-primary)">
              Pedidos fuera de las franjas actuales
            </div>
            <div class="flex flex-wrap gap-2">
              @for (o of unplaced(); track o.id) {
                <div
                  class="card"
                  role="button"
                  tabindex="0"
                  [style.--st]="colorOf(o.display_status)"
                  (click)="openDetail(o)"
                  (keydown.enter)="openDetail(o)"
                >
                  <span class="num">{{ o.order.order_number }}</span>
                  <span class="sub">{{ timeOf(o.scheduled_start) }} · {{ customer(o) }}</span>
                </div>
              }
            </div>
          </div>
        }
      }
      </div>
      </app-card>
    </div>

    <app-schedule-detail-modal
      [(isOpen)]="detailOpen"
      [scheduleId]="selectedId()"
    />
  `,
})
export class AgendaPageComponent {
  private readonly api = inject(ScheduledOrdersApiService);
  private readonly prefs = inject(AgendaPreferencesService);
  private readonly auth = inject(AuthFacade);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sse = inject(ProductionSseService);

  readonly statuses = DISPLAY_STATUS_ORDER;
  readonly headerActions = [
    {
      id: 'production',
      label: 'Lista de producción',
      icon: 'chef-hat',
      variant: 'outline' as const,
    },
  ];

  // --- estado ---------------------------------------------------------
  readonly view = signal<AgendaViewMode>(this.prefs.preference().view);
  readonly statusFilter = signal<StatusFilter>(this.prefs.preference().status);
  readonly anchor = signal<string>(storeToday(this.settings.timezone()));
  readonly isMobile = signal(false);

  readonly availability = signal<FulfillmentDay[]>([]);
  /** Every order in the period. The status filter narrows it on the client, so the stats always cover the whole period. */
  readonly allSchedules = signal<ScheduledOrder[]>([]);
  /** Orders shown in the grid, narrowed by the status filter. */
  readonly schedules = computed(() => {
    const status = this.statusFilter();
    const all = this.allSchedules();
    return status === 'all' ? all : all.filter((o) => o.display_status === status);
  });
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  /** A silent (live) reload failed: the list already on screen is kept, with a retry notice. */
  readonly refreshFailed = signal(false);

  readonly draggingId = signal<number | null>(null);
  readonly dragOverKey = signal<string | null>(null);

  readonly selectedId = signal<number | null>(null);
  readonly detailOpen = signal(false);

  private loadSub: Subscription | null = null;
  /** True while the load in flight is a user-driven (non-silent) one. */
  private loadInFlightVisible = false;
  /** A live (SSE) refresh arrived during a visible load; runs once it ends (S17). */
  private refreshPending = false;

  // --- derivados --------------------------------------------------------
  readonly today = computed(() => storeToday(this.settings.timezone()));
  /** En pantallas pequeñas la semana degrada a día. */
  readonly effectiveView = computed<AgendaViewMode>(() => (this.isMobile() ? 'day' : this.view()));

  readonly range = computed(() => {
    const a = this.anchor();
    if (this.effectiveView() === 'week') {
      const from = mondayOf(a);
      return { from, to: addDays(from, 6) };
    }
    return { from: a, to: a };
  });

  readonly rangeLabel = computed(() => {
    const { from, to } = this.range();
    return from === to ? fullDate(from) : `${dayMonth(from)} – ${dayMonth(to)}`;
  });

  readonly canReschedule = computed(() => this.auth.hasPermission('store:scheduled_orders:reschedule'));

  readonly days = computed(() => [...this.availability()].sort((a, b) => a.date.localeCompare(b.date)));

  readonly rows = computed<AgendaRow[]>(() => {
    const days = this.days();
    const schedules = this.schedules();
    const rowKeys = new Map<string, string>();
    for (const day of days) {
      for (const slot of day.slots) {
        rowKeys.set(`${slot.local_start}-${slot.local_end}`, `${slot.local_start} – ${slot.local_end}`);
      }
    }
    return [...rowKeys.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, label]) => ({
        key,
        label: label.split(' – ')[0],
        cells: days.map((day): AgendaCell => {
          const slot = day.slots.find((s) => `${s.local_start}-${s.local_end}` === key) ?? null;
          const orders = slot
            ? schedules.filter((o) => {
                const t = new Date(o.scheduled_start).getTime();
                return t >= new Date(slot.start).getTime() && t < new Date(slot.end).getTime();
              })
            : [];
          return { key: `${day.date}|${key}`, slot, orders };
        }),
      }));
  });

  readonly unplaced = computed(() => {
    const placed = new Set<number>();
    for (const row of this.rows()) {
      for (const cell of row.cells) cell.orders.forEach((o) => placed.add(o.id));
    }
    return this.schedules().filter((o) => !placed.has(o.id));
  });

  constructor() {
    const mql = window.matchMedia('(max-width: 767px)');
    this.isMobile.set(mql.matches);
    const onChange = (e: MediaQueryListEvent) => this.isMobile.set(e.matches);
    mql.addEventListener('change', onChange);
    this.destroyRef.onDestroy(() => {
      mql.removeEventListener('change', onChange);
      this.loadSub?.unsubscribe();
    });

    effect(() => {
      const { from, to } = this.range();
      untracked(() => this.load(from, to));
    });

    // Production state changed elsewhere: refresh the agenda silently.
    // Without production read permission the stream would answer 403: do not open it.
    if (this.sse.canStream()) {
      this.sse.listen(this.destroyRef, () => this.refresh(true));
    }
  }

  // --- carga ------------------------------------------------------------
  /** `silent`: background refresh (live updates); a failure keeps the agenda already on screen. */
  refresh(silent = false): void {
    const { from, to } = this.range();
    this.load(from, to, silent);
  }

  private load(from: string, to: string, silent = false): void {
    // A background refresh never cancels a user-driven load already in flight
    // (e.g. a week change): that load brings the newest data for the new range.
    if (silent && this.loadInFlightVisible && this.loadSub && !this.loadSub.closed) {
      // Do not lose it: re-run once the visible load finishes (S17).
      this.refreshPending = true;
      return;
    }
    this.loadSub?.unsubscribe();
    if (!silent) this.refreshPending = false;
    this.loadInFlightVisible = !silent;
    this.loading.set(true);
    if (!silent) {
      this.errorMessage.set(null);
      this.refreshFailed.set(false);
    }
    this.loadSub = forkJoin({
      availability: this.api.getAvailability(from, to),
      agenda: this.api.getAgenda(from, to),
    }).subscribe({
      next: ({ availability, agenda }) => {
        this.availability.set(availability);
        this.allSchedules.set(agenda);
        this.errorMessage.set(null);
        this.refreshFailed.set(false);
        this.loading.set(false);
        this.loadInFlightVisible = false;
        this.flushPendingRefresh();
      },
      error: (err) => {
        this.loading.set(false);
        this.loadInFlightVisible = false;
        this.flushPendingRefresh();
        // A failed background refresh never clears what is on screen.
        if (silent) {
          this.refreshFailed.set(true);
          return;
        }
        this.availability.set([]);
        this.allSchedules.set([]);
        this.errorMessage.set(extractApiErrorMessage(err));
      },
    });
  }

  /** Runs the one silent refresh that arrived during a visible load, with the current range. */
  private flushPendingRefresh(): void {
    if (!this.refreshPending) return;
    this.refreshPending = false;
    this.refresh(true);
  }

  // --- navegación y preferencias ---------------------------------------
  navigate(direction: -1 | 1): void {
    const step = this.effectiveView() === 'week' ? 7 : 1;
    this.anchor.set(addDays(this.anchor(), direction * step));
  }

  goToday(): void {
    this.anchor.set(this.today());
  }

  setView(view: AgendaViewMode): void {
    this.view.set(view);
    this.persist();
  }

  onStatusChange(value: string): void {
    this.statusFilter.set(value === 'all' ? 'all' : (value as ScheduledOrderDisplayStatus));
    this.persist();
  }

  private persist(): void {
    this.prefs.save({ view: this.view(), status: this.statusFilter() });
  }

  onHeaderAction(id: string): void {
    if (id === 'production') void this.router.navigate(['/admin/scheduled-orders/day']);
  }

  countByStatus(status: ScheduledOrderDisplayStatus): number {
    return this.allSchedules().filter((o) => o.display_status === status).length;
  }

  // --- detalle -----------------------------------------------------------
  openDetail(o: ScheduledOrder): void {
    this.selectedId.set(o.id);
    this.detailOpen.set(true);
  }

  // --- arrastrar y soltar (reprogramar) --------------------------------
  canDrag(o: ScheduledOrder): boolean {
    return (
      this.canReschedule() &&
      !this.isMobile() &&
      RESCHEDULABLE_STATUSES.includes(o.display_status) &&
      RESCHEDULABLE_STORED_STATUSES.includes(o.status)
    );
  }

  onDragStart(ev: DragEvent, o: ScheduledOrder): void {
    if (!this.canDrag(o)) {
      ev.preventDefault();
      return;
    }
    ev.dataTransfer?.setData('text/plain', String(o.id));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    this.draggingId.set(o.id);
  }

  onDragEnd(): void {
    this.draggingId.set(null);
    this.dragOverKey.set(null);
  }

  onDragOver(ev: DragEvent, cell: AgendaCell): void {
    if (this.draggingId() === null || !cell.slot) return;
    ev.preventDefault();
    if (this.dragOverKey() !== cell.key) this.dragOverKey.set(cell.key);
  }

  onDragLeave(cell: AgendaCell): void {
    if (this.dragOverKey() === cell.key) this.dragOverKey.set(null);
  }

  onDrop(ev: DragEvent, cell: AgendaCell): void {
    ev.preventDefault();
    const id = this.draggingId();
    const slot = cell.slot;
    this.onDragEnd();
    if (id === null || !slot) return;
    const previous = this.allSchedules();
    const order = previous.find((o) => o.id === id);
    if (!order || cell.orders.some((o) => o.id === id)) return;

    // Mueve la tarjeta de inmediato; si el servidor rechaza, vuelve a su lugar.
    this.allSchedules.set(
      previous.map((o) => (o.id === id ? { ...o, scheduled_start: slot.start, scheduled_end: slot.end } : o)),
    );
    this.api
      .reschedule(id, slot.start, slot.end)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Pedido reprogramado');
          this.refresh();
        },
        error: (err) => {
          this.allSchedules.set(previous);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }

  // --- helpers de plantilla ---------------------------------------------
  labelOf(s: ScheduledOrderDisplayStatus): string {
    return DISPLAY_STATUS_LABELS[s];
  }
  colorOf(s: ScheduledOrderDisplayStatus): string {
    return DISPLAY_STATUS_COLORS[s];
  }
  customer(o: ScheduledOrder): string {
    return customerName(o.order.users, o.order.customer_alias);
  }
  weekday(ymd: string): string {
    return weekdayShort(ymd);
  }
  dayMonthOf(ymd: string): string {
    return dayMonth(ymd);
  }
  timeOf(iso: string): string {
    return formatStoreDateTime(iso, this.settings.timezone(), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
}
