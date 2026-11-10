import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { formatStockWarningSummary } from '../../../../../../../core/utils/stock-shortage.util';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  EmptyStateComponent,
  IconComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components';
import { formatStoreDateTime, storeToday } from '../../../../../../../shared/utils/date.util';
import { ManufacturingOrdersService } from '../../../../manufacturing/services';
import { addDays, fullDate } from '../../../../scheduled-orders/utils/ymd.util';
import {
  ProductionDayCard,
  ProductionDayCardStatus,
  ProductionDayOrder,
  ProductionDayResponse,
  ProductionOrder,
  ProductionSaleMoveResult,
  isProductionRunning,
} from '../../interfaces';
import {
  ProductionApiScope,
  ProductionOrdersService,
  ProductionSseService,
} from '../../services';
import { ProductionOrderDetailModalComponent } from '../production-order-detail/production-order-detail-modal.component';
import {
  ProductionTimerView,
  buildTimerView,
  formatEstimate,
} from './production-timer.util';

/** One hour block of the vertical timeline. */
interface HourGroup {
  key: string;
  label: string;
  cards: ProductionDayCard[];
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_TIME_KEY = 'no-time';

/**
 * Producción activa (QUI-1002 / T15): the day's timeline with one card per
 * sale (or manual order) and a stopwatch per in-progress order. Shared by
 * Operaciones → Producción, Pedidos programados and Planta; each route passes
 * its bases as route data (`detailBase`, `listBase`, `manageInline`).
 * The selected day lives in the `?date=` query param (read through the Router).
 */
@Component({
  selector: 'app-production-active',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    EmptyStateComponent,
    ProductionOrderDetailModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Producción activa"
        subtitle="Inicia, cronometra y finaliza la producción del día"
        icon="flame"
        variant="glass"
        [actions]="headerActions"
        (actionClicked)="onHeaderAction($event)"
      />

      <div
        class="stats-container sticky top-[52px] z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="En espera"
          [value]="summary().waiting"
          smallText="Pendientes de iniciar"
          iconName="clock"
          iconBgColor="bg-slate-100"
          iconColor="text-slate-600"
          [loading]="loading() && !data()"
        />
        <app-stats
          title="En producción"
          [value]="summary().in_progress"
          smallText="En marcha ahora"
          iconName="flame"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [loading]="loading() && !data()"
        />
        <app-stats
          title="Finalizadas"
          [value]="summary().completed"
          smallText="Listas del día"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
          [loading]="loading() && !data()"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <!-- Day filter -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4"
          >
            <h2
              class="text-[13px] font-bold capitalize text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              {{ dateLabel() }}
            </h2>
            <div class="flex flex-wrap items-center gap-2">
              <app-button
                variant="outline"
                size="sm"
                ariaLabel="Día anterior"
                (clicked)="goToDay(-1)"
              >
                <app-icon slot="icon" name="chevron-left" [size]="16"></app-icon>
              </app-button>
              <app-button
                variant="outline"
                size="sm"
                [disabled]="isToday()"
                (clicked)="goToToday()"
              >
                Hoy
              </app-button>
              <app-button
                variant="outline"
                size="sm"
                ariaLabel="Día siguiente"
                (clicked)="goToDay(1)"
              >
                <app-icon slot="icon" name="chevron-right" [size]="16"></app-icon>
              </app-button>
              <input
                type="date"
                class="h-9 min-w-0 flex-1 rounded-[10px] border border-border bg-surface px-2.5 text-sm text-text-primary md:flex-none"
                aria-label="Fecha de producción"
                [value]="date()"
                (change)="onDateInput($event)"
              />
            </div>
          </div>
        </div>

        @if (loading() && !data()) {
          <div class="flex justify-center p-8"><app-spinner /></div>
        } @else if (errorMessage(); as msg) {
          <app-empty-state
            icon="alert-circle"
            title="No se pudo cargar la producción"
            [description]="msg"
            [showActionButton]="false"
            [showRefreshButton]="true"
            (refreshClick)="reload()"
          />
        } @else if (groups().length === 0) {
          <app-empty-state
            icon="flame"
            title="No hay producción para este día"
            description="Cuando haya pedidos u órdenes de producción para esta fecha, aparecerán aquí."
            [showActionButton]="false"
            [showRefreshButton]="true"
            (refreshClick)="reload()"
          />
        } @else {
          <div class="flex flex-col gap-5 px-2 pb-4 pt-3 md:p-6">
            @for (group of groups(); track group.key) {
              <section class="flex gap-3">
                <div
                  class="w-12 shrink-0 pt-1 text-right text-xs font-bold text-text-secondary md:w-16 md:text-sm"
                >
                  {{ group.label }}
                </div>
                <ol class="flex min-w-0 flex-1 flex-col gap-3 border-l-2 border-border pl-3 md:pl-4">
                  @for (card of group.cards; track card.key) {
                    <li class="relative min-w-0 scroll-mt-40" [attr.data-card-key]="card.key">
                      <span
                        class="absolute -left-[19px] top-4 h-2.5 w-2.5 rounded-full border-2 border-surface md:-left-[23px]"
                        [class.bg-slate-400]="card.status === 'waiting'"
                        [class.bg-amber-500]="card.status === 'in_progress'"
                        [class.bg-green-500]="card.status === 'completed'"
                      ></span>
                      <article
                        class="rounded-xl border bg-surface p-3 shadow-sm"
                        [class.border-primary]="card.status === 'in_progress'"
                        [class.border-border]="card.status !== 'in_progress'"
                      >
                        <header class="flex flex-wrap items-start justify-between gap-2">
                          <div class="min-w-0">
                            <div class="truncate text-sm font-semibold text-text-primary">
                              {{ cardTitle(card) }}
                            </div>
                            <div class="truncate text-xs text-text-secondary">
                              @if (card.customer_name) {
                                {{ card.customer_name }} ·
                              }
                              {{ cardTimeLabel(card) }}
                            </div>
                          </div>
                          <div class="flex flex-wrap items-center gap-1.5">
                            @if (card.carried_over) {
                              <app-badge variant="warning" size="xs">
                                Viene de un día anterior
                              </app-badge>
                            }
                            <app-badge [variant]="cardBadgeVariant(card.status)" size="xs">
                              {{ cardStatusLabel(card.status) }}
                            </app-badge>
                          </div>
                        </header>

                        @if (manageInline && card.kind === 'sale' && card.production_orders.length > 1) {
                          <div class="mt-2 flex flex-wrap items-center gap-1.5">
                            @if (hasStatus(card, 'draft')) {
                              <app-button
                                variant="primary"
                                size="sm"
                                [disabled]="busyKey() !== null"
                                [loading]="busyKey() === saleKey(card)"
                                (clicked)="startCard(card)"
                              >
                                <app-icon slot="icon" name="play" [size]="14"></app-icon>
                                Iniciar el pedido
                              </app-button>
                            }
                            @if (hasStatus(card, 'in_progress')) {
                              <app-button
                                variant="primary"
                                size="sm"
                                [disabled]="busyKey() !== null"
                                [loading]="busyKey() === saleKey(card)"
                                (clicked)="completeCard(card)"
                              >
                                <app-icon slot="icon" name="check-circle" [size]="14"></app-icon>
                                Finalizar el pedido
                              </app-button>
                            }
                          </div>
                        }

                        <ul class="mt-2 flex flex-col divide-y divide-border">
                          @for (po of card.production_orders; track po.id) {
                            <li class="flex flex-col gap-2 py-2">
                              <div class="flex flex-wrap items-start justify-between gap-2">
                                <div class="flex min-w-0 items-start gap-2">
                                  <button
                                    type="button"
                                    class="min-w-0 text-left"
                                    (click)="openDetail(po)"
                                  >
                                    <span class="block truncate text-sm font-medium text-text-primary">
                                      {{ qty(po.planned_qty) }} × {{ orderTitle(po) }}
                                    </span>
                                    <span class="block truncate text-xs text-text-secondary">
                                      {{ po.order_number }}
                                    </span>
                                  </button>
                                  <app-badge [variant]="orderBadgeVariant(po.status)" size="xs">
                                    {{ orderStatusLabel(po.status) }}
                                  </app-badge>
                                </div>

                                @if (isRunning(po.status)) {
                                  @if (timerOf(po); as t) {
                                    <div class="text-right" aria-live="off">
                                      <div
                                        class="font-mono text-xl font-bold tabular-nums leading-none"
                                        [class.text-error]="t.mode === 'exceeded'"
                                        [class.text-text-primary]="t.mode !== 'exceeded'"
                                      >
                                        {{ t.text }}
                                      </div>
                                      <div
                                        class="mt-1 text-[11px] font-medium"
                                        [class.text-error]="t.mode === 'exceeded'"
                                        [class.text-text-secondary]="t.mode !== 'exceeded'"
                                      >
                                        {{ t.caption }}
                                      </div>
                                    </div>
                                  } @else {
                                    <span class="text-xs text-text-secondary">Sin hora de inicio</span>
                                  }
                                }
                              </div>

                              <div class="flex flex-wrap items-center gap-1.5">
                                <span class="text-xs text-text-secondary">
                                  @if (po.effective_estimated_minutes !== null) {
                                    Tiempo estimado: {{ estimateLabel(po.effective_estimated_minutes) }}
                                  } @else {
                                    Sin tiempo estimado
                                  }
                                </span>
                                @if (manageInline && po.status !== 'completed') {
                                  <button
                                    type="button"
                                    class="inline-flex h-8 items-center gap-1 rounded-[10px] px-2 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                                    [disabled]="busyKey() !== null"
                                    (click)="editEstimate(po)"
                                  >
                                    <app-icon name="edit-2" [size]="14"></app-icon>
                                    Cambiar tiempo
                                  </button>
                                }
                                <a
                                  [routerLink]="[detailBase, po.id]"
                                  class="inline-flex h-8 items-center gap-1 rounded-[10px] px-2 text-xs font-medium text-primary hover:bg-primary/10"
                                >
                                  <app-icon name="arrow-right" [size]="14"></app-icon>
                                  Ver orden
                                </a>
                                <span class="flex-1"></span>
                                @if (manageInline && po.status === 'draft') {
                                  <app-button
                                    variant="primary"
                                    size="sm"
                                    [disabled]="busyKey() !== null"
                                    [loading]="busyKey() === orderKey(po)"
                                    (clicked)="startOrder(po)"
                                  >
                                    <app-icon slot="icon" name="play" [size]="14"></app-icon>
                                    Iniciar
                                  </app-button>
                                }
                                @if (!manageInline && po.status === 'released') {
                                  <app-button
                                    variant="primary"
                                    size="sm"
                                    [disabled]="busyKey() !== null"
                                    [loading]="busyKey() === orderKey(po)"
                                    (clicked)="startReleased(po)"
                                  >
                                    <app-icon slot="icon" name="play" [size]="14"></app-icon>
                                    Iniciar
                                  </app-button>
                                }
                                @if (isRunning(po.status)) {
                                  <app-button
                                    variant="primary"
                                    size="sm"
                                    [disabled]="busyKey() !== null"
                                    [loading]="busyKey() === orderKey(po)"
                                    (clicked)="completeOrder(po)"
                                  >
                                    <app-icon slot="icon" name="check-circle" [size]="14"></app-icon>
                                    Finalizar
                                  </app-button>
                                }
                              </div>
                            </li>
                          }
                        </ul>
                      </article>
                    </li>
                  }
                </ol>
              </section>
            }
          </div>
        }
      </app-card>
    </div>

    @if (manageInline) {
      <app-production-order-detail-modal
        [(isOpen)]="detailOpen"
        [orderId]="detailId()"
        (changed)="reload()"
      />
    }
  `,
})
export class ProductionActiveComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(ProductionOrdersService);
  private readonly manufacturing = inject(ManufacturingOrdersService);
  private readonly sse = inject(ProductionSseService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Route data (same contract as the day list):
   * - `detailBase`: base path of the order detail (`<detailBase>/<id>`).
   * - `listBase`: path of the Lista de producción; without it the header
   *   action is hidden.
   * - `manageInline` (default true): restaurant start / finish / estimate and
   *   the detail modal. Planta sets it to false: only a `released` order starts
   *   here (manufacturing endpoint); the rest is managed from its detail page.
   */
  private readonly routeData = this.route.snapshot.data;
  readonly detailBase: string =
    (this.routeData['detailBase'] as string | undefined) ??
    '/admin/restaurant-ops/production/orders';
  readonly listBase: string | null =
    (this.routeData['listBase'] as string | undefined) ?? null;
  readonly manageInline: boolean = this.routeData['manageInline'] !== false;
  /** Planta routes read through the manufacturing API (its own industry guard). */
  readonly apiScope: ProductionApiScope =
    this.routeData['apiScope'] === 'manufacturing' ? 'manufacturing' : 'restaurant';

  readonly headerActions: StickyHeaderActionButton[] = this.listBase
    ? [
        {
          id: 'list',
          label: 'Lista de producción',
          icon: 'clipboard-list',
          variant: 'outline',
        },
      ]
    : [];

  // --- day selection (?date=), always through the Router -----------------
  private readonly queryDate = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('date'))),
    { initialValue: this.route.snapshot.queryParamMap.get('date') },
  );
  readonly today = computed(() => storeToday(this.settings.timezone()));
  readonly date = computed(() => {
    const q = this.queryDate();
    return q && YMD_RE.test(q) ? q : this.today();
  });
  readonly isToday = computed(() => this.date() === this.today());
  readonly dateLabel = computed(() => fullDate(this.date()));

  // --- data ----------------------------------------------------------------
  readonly data = signal<ProductionDayResponse | null>(null);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  /** Key of the action in flight: `o-<orderId>` or `s-<saleOrderId>`. */
  readonly busyKey = signal<string | null>(null);

  readonly detailId = signal<number | null>(null);
  readonly detailOpen = signal(false);

  readonly summary = computed(
    () => this.data()?.summary ?? { waiting: 0, in_progress: 0, completed: 0 },
  );
  private readonly tz = computed(() => this.data()?.timezone ?? this.settings.timezone());

  readonly groups = computed<HourGroup[]>(() => {
    const cards = this.data()?.cards ?? [];
    const byHour = new Map<string, HourGroup>();
    for (const card of cards) {
      const hour = this.hourOf(card.due_at);
      const key = hour ?? NO_TIME_KEY;
      let group = byHour.get(key);
      if (!group) {
        group = { key, label: hour ? `${hour}:00` : 'Sin hora', cards: [] };
        byHour.set(key, group);
      }
      group.cards.push(card);
    }
    return [...byHour.values()];
  });

  // --- shared 1 s ticker (only while something is in progress) -------------
  readonly now = signal(Date.now());
  private readonly hasRunning = computed(() => this.summary().in_progress > 0);

  private loadSub: Subscription | null = null;
  /** Day for which the "scroll to the oldest in progress" already ran. */
  private scrolledDate: string | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.loadSub?.unsubscribe());

    effect(() => {
      const date = this.date();
      untracked(() => this.load(date, true));
    });

    effect((onCleanup) => {
      if (!this.hasRunning()) return;
      this.now.set(Date.now());
      const id = setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(id));
    });

    // Another screen (or device) started / finished / edited an order.
    this.sse.listen(this.destroyRef, () => this.reload(), undefined, this.apiScope);
  }

  // --- loading ---------------------------------------------------------------
  reload(): void {
    this.load(this.date(), false);
  }

  private load(date: string, resetView: boolean): void {
    this.loadSub?.unsubscribe();
    if (resetView) this.data.set(null);
    this.loading.set(true);
    this.errorMessage.set(null);
    this.loadSub = this.service.getDay(date, this.apiScope).subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
        this.scrollToOldestRunning(date, res);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        // A background refresh (live event, polling tick, after an action) that
        // fails keeps the board on screen: the next event or tick retries.
        if (!resetView && this.data()) return;
        this.errorMessage.set(
          typeof err === 'string' ? err : 'Error al cargar la producción activa',
        );
      },
    });
  }

  /** Centers the timeline on the oldest in-progress order, once per day shown. */
  private scrollToOldestRunning(date: string, res: ProductionDayResponse): void {
    if (this.scrolledDate === date) return;
    this.scrolledDate = date;
    let oldest: { key: string; at: number } | null = null;
    for (const card of res.cards) {
      for (const po of card.production_orders) {
        if (!isProductionRunning(po.status)) continue;
        const at = po.started_at ? new Date(po.started_at).getTime() : Number.MAX_SAFE_INTEGER;
        if (!oldest || at < oldest.at) oldest = { key: card.key, at };
      }
    }
    if (!oldest) return;
    const key = oldest.key;
    afterNextRender(
      () => {
        const el = this.host.nativeElement.querySelector<HTMLElement>(
          `[data-card-key="${key}"]`,
        );
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
      { injector: this.injector },
    );
  }

  // --- navigation --------------------------------------------------------------
  private setDate(ymd: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { date: ymd },
      queryParamsHandling: 'merge',
    });
  }

  goToDay(delta: -1 | 1): void {
    this.setDate(addDays(this.date(), delta));
  }

  goToToday(): void {
    this.setDate(this.today());
  }

  onDateInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value && YMD_RE.test(value)) this.setDate(value);
  }

  onHeaderAction(id: string): void {
    if (id === 'list' && this.listBase) {
      void this.router.navigate([this.listBase], { queryParams: { date: this.date() } });
    }
  }

  openDetail(po: ProductionDayOrder): void {
    if (!this.manageInline) {
      void this.router.navigate([this.detailBase, po.id]);
      return;
    }
    this.detailId.set(po.id);
    this.detailOpen.set(true);
  }

  // --- actions ---------------------------------------------------------------------
  async startOrder(po: ProductionDayOrder): Promise<void> {
    if (this.busyKey() !== null) return;
    const ok = await this.dialog.confirm({
      title: 'Iniciar producción',
      message: `¿Iniciar la producción de "${this.orderTitle(po)}"?`,
      confirmText: 'Iniciar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    this.run(this.orderKey(po), this.service.start(po.id), 'Producción iniciada', 'Error al iniciar la producción');
  }

  /** Planta: a `released` manufacturing order starts with the manufacturing endpoint. */
  async startReleased(po: ProductionDayOrder): Promise<void> {
    if (this.busyKey() !== null) return;
    const ok = await this.dialog.confirm({
      title: 'Iniciar producción',
      message: `¿Iniciar la producción de "${this.orderTitle(po)}"?`,
      confirmText: 'Iniciar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    this.run(this.orderKey(po), this.manufacturing.start(po.id), 'Producción iniciada', 'Error al iniciar la producción');
  }

  async completeOrder(po: ProductionDayOrder): Promise<void> {
    if (this.busyKey() !== null) return;
    if (!this.manageInline || po.source !== 'order') {
      // Planta finishes with lot and quantity on its detail page; restaurant
      // manual orders count whole batches in the shared detail modal.
      this.openDetail(po);
      return;
    }
    const ok = await this.dialog.confirm({
      title: `Finalizar producción de ${this.orderTitle(po)}`,
      message: `Se registrará lo producido (${this.qty(po.planned_qty)}) y quedará reservado para el pedido.`,
      confirmText: 'Finalizar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    this.run(
      this.orderKey(po),
      this.service.complete(po.id, { produced_qty: Number(po.planned_qty) }),
      'Producción finalizada',
      'Error al finalizar la producción',
    );
  }

  async startCard(card: ProductionDayCard): Promise<void> {
    if (this.busyKey() !== null || card.order_id == null) return;
    const ok = await this.dialog.confirm({
      title: 'Iniciar el pedido',
      message: `¿Iniciar la producción de todos los productos del ${this.cardTitle(card).toLowerCase()}?`,
      confirmText: 'Iniciar todo',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    this.runSale(this.saleKey(card), this.service.startSale(card.order_id), 'iniciada');
  }

  async completeCard(card: ProductionDayCard): Promise<void> {
    if (this.busyKey() !== null || card.order_id == null) return;
    const ok = await this.dialog.confirm({
      title: 'Finalizar el pedido',
      message: `Se registrará lo producido de todos los productos en curso del ${this.cardTitle(card).toLowerCase()} y quedará reservado para el pedido.`,
      confirmText: 'Finalizar todo',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    this.runSale(this.saleKey(card), this.service.completeSale(card.order_id), 'finalizada');
  }

  async editEstimate(po: ProductionDayOrder): Promise<void> {
    if (this.busyKey() !== null) return;
    const value = await this.dialog.prompt({
      title: `Tiempo estimado de ${this.orderTitle(po)}`,
      message:
        'Minutos que debería tardar esta orden. Déjalo vacío para usar el tiempo de preparación del producto.',
      placeholder: 'Minutos',
      defaultValue: po.estimated_minutes != null ? String(po.estimated_minutes) : '',
      confirmText: 'Guardar',
      cancelText: 'Cancelar',
      inputType: 'number',
    });
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    let minutes: number | null = null;
    if (text !== '') {
      minutes = Number(text);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) {
        this.toast.error('El tiempo estimado debe ser un número entero de minutos, entre 0 y 10080 (7 días)');
        return;
      }
    }
    this.busyKey.set(this.orderKey(po));
    this.service.updateEstimatedMinutes(po.id, minutes).subscribe({
      next: () => {
        this.busyKey.set(null);
        this.toast.success('Tiempo estimado actualizado');
        this.reload();
      },
      error: (err: unknown) => {
        this.busyKey.set(null);
        this.toast.error(typeof err === 'string' ? err : 'Error al guardar el tiempo estimado');
      },
    });
  }

  private run(
    key: string,
    call: Observable<ProductionOrder | { id?: number }>,
    okMessage: string,
    errorMessage: string,
  ): void {
    this.busyKey.set(key);
    call.subscribe({
      next: (done) => {
        this.busyKey.set(null);
        this.toast.success(okMessage);
        const warnings = (done as ProductionOrder | null)?.stock_warnings;
        if (warnings?.length) this.toast.warning(formatStockWarningSummary(warnings));
        this.reload();
      },
      error: (err: unknown) => {
        this.busyKey.set(null);
        this.toast.error(typeof err === 'string' ? err : errorMessage);
        this.reload();
      },
    });
  }

  private runSale(
    key: string,
    call: Observable<ProductionSaleMoveResult>,
    verb: 'iniciada' | 'finalizada',
  ): void {
    this.busyKey.set(key);
    call.subscribe({
      next: (res) => {
        this.busyKey.set(null);
        if (res.moved.length > 0) {
          this.toast.success(
            res.moved.length === 1
              ? `1 orden de producción ${verb}`
              : `${res.moved.length} órdenes de producción ${verb}s`,
          );
        }
        if (res.failed.length > 0) {
          this.toast.error(res.failed.map((f) => f.message).join(' · '));
        }
        this.reload();
      },
      error: (err: unknown) => {
        this.busyKey.set(null);
        this.toast.error(typeof err === 'string' ? err : 'Error al mover las órdenes del pedido');
        this.reload();
      },
    });
  }

  // --- template helpers -----------------------------------------------------------------
  orderKey(po: ProductionDayOrder): string {
    return `o-${po.id}`;
  }

  saleKey(card: ProductionDayCard): string {
    return `s-${card.order_id}`;
  }

  hasStatus(card: ProductionDayCard, status: string): boolean {
    return card.production_orders.some((po) => po.status === status);
  }

  /** S19: "Producto · Variante". */
  orderTitle(po: ProductionDayOrder): string {
    return ProductionOrdersService.displayName(po.product_name, po.variant_name);
  }

  /** S16: a partially finished order keeps its timer and its "Finalizar" button. */
  isRunning(status: string): boolean {
    return isProductionRunning(status);
  }

  /** Reads the shared ticker, so the template refreshes every second. */
  timerOf(po: ProductionDayOrder): ProductionTimerView | null {
    return buildTimerView(po.started_at, po.effective_estimated_minutes, this.now());
  }

  estimateLabel(minutes: number): string {
    return formatEstimate(minutes);
  }

  cardTitle(card: ProductionDayCard): string {
    return card.kind === 'sale'
      ? `Pedido ${card.sale_order_number ?? ''}`.trim()
      : 'Orden de producción manual';
  }

  cardTimeLabel(card: ProductionDayCard): string {
    if (!card.due_at) return 'Sin hora';
    const time = formatStoreDateTime(card.due_at, this.tz(), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return card.kind === 'sale' ? `Entrega ${time}` : `Planificada ${time}`;
  }

  cardStatusLabel(status: ProductionDayCardStatus): string {
    switch (status) {
      case 'in_progress':
        return 'En producción';
      case 'completed':
        return 'Finalizada';
      default:
        return 'En espera';
    }
  }

  cardBadgeVariant(status: ProductionDayCardStatus): 'neutral' | 'primary' | 'success' {
    switch (status) {
      case 'in_progress':
        return 'primary';
      case 'completed':
        return 'success';
      default:
        return 'neutral';
    }
  }

  orderStatusLabel(status: string): string {
    return ProductionOrdersService.statusLabelSafe(status);
  }

  orderBadgeVariant(status: string): 'neutral' | 'primary' | 'success' | 'error' {
    return ProductionOrdersService.statusBadgeVariant(status);
  }

  qty(value: number | string): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(n);
  }

  /** Two-digit hour of an ISO instant in the store timezone, or null. */
  private hourOf(iso: string | null): string | null {
    if (!iso) return null;
    const h = formatStoreDateTime(iso, this.tz(), { hour: '2-digit', hour12: false });
    if (!h) return null;
    return h === '24' ? '00' : h.padStart(2, '0');
  }
}
