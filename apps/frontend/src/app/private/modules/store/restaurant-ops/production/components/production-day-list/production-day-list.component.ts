import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
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
import { addDays, fullDate } from '../../../../scheduled-orders/utils/ymd.util';
import {
  ProductionDayCard,
  ProductionDayCardStatus,
  ProductionDayOrder,
  ProductionOrder,
  PLANTA_ORDER_DETAIL_BASE,
  finishesInPlanta,
  isProductionRunning,
} from '../../interfaces';
import {
  ProductionApiScope,
  ProductionOrdersService,
  ProductionSseService,
} from '../../services';
import { ProductionDayPager } from '../../utils/production-day-pager';
import { ProductionOrderDetailModalComponent } from '../production-order-detail/production-order-detail-modal.component';

/** One hour block of the vertical timeline. */
interface HourGroup {
  key: string;
  label: string;
  cards: ProductionDayCard[];
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_TIME_KEY = 'no-time';

/**
 * Lista de producción (QUI-996 / T14): the production of one day as a vertical
 * timeline by delivery hour, one card per sale or manual order. Shared by
 * Pedidos programados, Operaciones → Producción and Planta; each route passes
 * `activeBase` (Producción activa) and `detailBase` (`<detailBase>/<id>`) as
 * route data. The selected day lives in the `?date=` query param.
 */
@Component({
  selector: 'app-production-day-list',
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
        title="Lista de producción"
        subtitle="Lo que hay que producir en el día, ordenado por hora de entrega"
        icon="clipboard-list"
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
            title="No se pudo cargar la lista"
            [description]="msg"
            [showActionButton]="false"
            [showRefreshButton]="true"
            (refreshClick)="reload()"
          />
        } @else if (groups().length === 0) {
          <app-empty-state
            icon="clipboard-list"
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
                    <li class="relative min-w-0">
                      <span
                        class="absolute -left-[19px] top-4 h-2.5 w-2.5 rounded-full border-2 border-surface md:-left-[23px]"
                        [class.bg-slate-400]="card.status === 'waiting'"
                        [class.bg-amber-500]="card.status === 'in_progress'"
                        [class.bg-green-500]="card.status === 'completed'"
                      ></span>
                      <article
                        class="rounded-xl border border-border bg-surface p-3 shadow-sm"
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

                        <ul class="mt-2 flex flex-col divide-y divide-border">
                          @for (po of card.production_orders; track po.id) {
                            <li class="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
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

                              <div class="flex flex-wrap items-center gap-1.5">
                                <a
                                  [routerLink]="[detailBase, po.id]"
                                  class="inline-flex h-8 items-center gap-1 rounded-[10px] px-2 text-xs font-medium text-primary hover:bg-primary/10"
                                >
                                  <app-icon name="arrow-right" [size]="14"></app-icon>
                                  Ver orden
                                </a>
                                @if (manageInline && po.status === 'draft') {
                                  <app-button
                                    variant="primary"
                                    size="sm"
                                    [disabled]="processingId() !== null"
                                    [loading]="processingId() === po.id"
                                    (clicked)="startOrder(po)"
                                  >
                                    <app-icon slot="icon" name="play" [size]="14"></app-icon>
                                    Iniciar
                                  </app-button>
                                }
                                @if (manageInline && isRunning(po.status)) {
                                  <app-button
                                    variant="primary"
                                    size="sm"
                                    [disabled]="processingId() !== null"
                                    [loading]="processingId() === po.id"
                                    (clicked)="completeOrder(po)"
                                  >
                                    <app-icon slot="icon" name="check-circle" [size]="14"></app-icon>
                                    Finalizar
                                  </app-button>
                                }
                                @if (manageInline && (po.status === 'draft' || po.status === 'in_progress')) {
                                  <app-button
                                    variant="outline-danger"
                                    size="sm"
                                    [disabled]="processingId() !== null"
                                    (clicked)="cancelOrder(po)"
                                  >
                                    Cancelar
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

            @if (data()?.next_cursor) {
              <div #moreSentinel class="flex min-h-10 items-center justify-center py-2">
                @if (loadingMore()) {
                  <app-spinner />
                } @else if (moreFailed()) {
                  <app-button variant="outline" size="sm" (clicked)="loadMore()">
                    Cargar más
                  </app-button>
                }
              </div>
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
export class ProductionDayListComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(ProductionOrdersService);
  private readonly sse = inject(ProductionSseService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Route data:
   * - `detailBase`: base path of the order detail (`<detailBase>/<id>`).
   * - `activeBase`: base path of Producción activa; without it the header
   *   action is hidden.
   * - `manageInline` (default true): start / finish / cancel from the list and
   *   open the restaurant detail modal. Planta sets it to false: its orders go
   *   through the release step, so they are managed from their own detail page.
   * - `consolidatedPath`: printable list of consolidated ingredients.
   */
  private readonly routeData = this.route.snapshot.data;
  readonly detailBase: string =
    (this.routeData['detailBase'] as string | undefined) ??
    '/admin/restaurant-ops/production/orders';
  readonly activeBase: string | null =
    (this.routeData['activeBase'] as string | undefined) ?? null;
  readonly manageInline: boolean = this.routeData['manageInline'] !== false;
  /** Planta routes read through the manufacturing API (its own industry guard). */
  readonly apiScope: ProductionApiScope =
    this.routeData['apiScope'] === 'manufacturing' ? 'manufacturing' : 'restaurant';
  readonly consolidatedPath: string | null =
    (this.routeData['consolidatedPath'] as string | undefined) ?? null;

  readonly headerActions: StickyHeaderActionButton[] = [
    ...(this.consolidatedPath
      ? [
          {
            id: 'consolidated',
            label: 'Insumos consolidados',
            icon: 'clipboard-list',
            variant: 'outline' as const,
          },
        ]
      : []),
    ...(this.activeBase
      ? [
          {
            id: 'active',
            label: 'Iniciar producción del día',
            icon: 'play',
            variant: 'primary' as const,
          },
        ]
      : []),
  ];

  // --- day selection (?date=) ------------------------------------------
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

  // --- data -------------------------------------------------------------
  // S20: scroll infinito. El pager pide `limit=100` y sigue `next_cursor`.
  private readonly pager = new ProductionDayPager(
    (date, cursor, limit) => this.service.getDay(date, this.apiScope, { limit, cursor }),
    'Error al cargar la lista de producción',
  );
  readonly data = this.pager.data;
  readonly loading = this.pager.loading;
  readonly loadingMore = this.pager.loadingMore;
  readonly moreFailed = this.pager.moreFailed;
  readonly errorMessage = this.pager.errorMessage;
  private readonly moreSentinel = viewChild<ElementRef<HTMLElement>>('moreSentinel');
  /** Id of the production order whose action is in flight. */
  readonly processingId = signal<number | null>(null);

  readonly detailId = signal<number | null>(null);
  readonly detailOpen = signal(false);

  readonly summary = computed(
    () => this.data()?.summary ?? { waiting: 0, in_progress: 0, completed: 0 },
  );
  private readonly tz = computed(() => this.data()?.timezone ?? this.settings.timezone());

  /** Cards grouped by the hour of `due_at`, in the order the server sent them. */
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

  constructor() {
    this.destroyRef.onDestroy(() => this.pager.cancel());
    effect(() => {
      const date = this.date();
      untracked(() => this.load(date, true));
    });
    // Another screen (or device) moved an order: reload silently. Without read
    // permission on this scope the stream would answer 403: do not open it.
    if (this.sse.canStream(this.apiScope)) {
      this.sse.listen(this.destroyRef, () => this.reload(), undefined, this.apiScope);
    }
    // Pide la página siguiente cuando el centinela del final entra en pantalla.
    // Lee `data()` para observar de nuevo tras cada página: si el centinela sigue
    // visible (página corta), el observador vuelve a avisar.
    effect((onCleanup) => {
      const sentinel = this.moreSentinel()?.nativeElement;
      this.data();
      if (!sentinel || typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) this.loadMore();
        },
        { rootMargin: '200px' },
      );
      observer.observe(sentinel);
      onCleanup(() => observer.disconnect());
    });
  }

  // --- loading ----------------------------------------------------------
  reload(): void {
    this.load(this.date(), false);
  }

  private load(date: string, resetView: boolean): void {
    this.pager.load(date, resetView);
  }

  loadMore(): void {
    this.pager.loadMore();
  }

  // --- navigation -------------------------------------------------------
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
    const target = id === 'active' ? this.activeBase : id === 'consolidated' ? this.consolidatedPath : null;
    if (target) {
      void this.router.navigate([target], { queryParams: { date: this.date() } });
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

  // --- actions (existing service methods) -------------------------------
  async startOrder(po: ProductionDayOrder): Promise<void> {
    if (this.processingId() !== null) return;
    const ok = await this.dialog.confirm({
      title: 'Iniciar producción',
      message: `¿Iniciar la producción de "${this.orderTitle(po)}"?`,
      confirmText: 'Iniciar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    this.run(po, this.service.start(po.id), 'Producción iniciada', 'Error al iniciar la producción');
  }

  async completeOrder(po: ProductionDayOrder): Promise<void> {
    if (this.processingId() !== null) return;
    if (finishesInPlanta(po.status)) {
      void this.router.navigate([PLANTA_ORDER_DETAIL_BASE, po.id]);
      return;
    }
    if (po.source !== 'order') {
      // Manual orders count whole batches of the recipe; that prompt lives in
      // the shared detail, so the action opens it instead of guessing.
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
      po,
      this.service.complete(po.id, { produced_qty: Number(po.planned_qty) }),
      'Producción finalizada',
      'Error al finalizar la producción',
    );
  }

  async cancelOrder(po: ProductionDayOrder): Promise<void> {
    if (this.processingId() !== null) return;
    const ok = await this.dialog.confirm({
      title: 'Cancelar producción',
      message: `¿Cancelar la producción de "${this.orderTitle(po)}"? Esta acción no se puede deshacer.`,
      confirmText: 'Cancelar producción',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    this.run(po, this.service.cancel(po.id), 'Producción cancelada', 'Error al cancelar la producción');
  }

  private run(
    po: ProductionDayOrder,
    call: Observable<ProductionOrder>,
    okMessage: string,
    errorMessage: string,
  ): void {
    this.processingId.set(po.id);
    call.subscribe({
      next: (done) => {
        this.processingId.set(null);
        this.toast.success(okMessage);
        if (done?.stock_warnings?.length) {
          this.toast.warning(formatStockWarningSummary(done.stock_warnings));
        }
        this.reload();
      },
      error: (err: unknown) => {
        this.processingId.set(null);
        this.toast.error(typeof err === 'string' ? err : errorMessage);
        this.reload();
      },
    });
  }

  // --- template helpers ---------------------------------------------------
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

  /** S19: "Producto · Variante". */
  orderTitle(po: ProductionDayOrder): string {
    return ProductionOrdersService.displayName(po.product_name, po.variant_name);
  }

  /** S16: a partially finished order is still running. */
  isRunning(status: string): boolean {
    return isProductionRunning(status);
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
