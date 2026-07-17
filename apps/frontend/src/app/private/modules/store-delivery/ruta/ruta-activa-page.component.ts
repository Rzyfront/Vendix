import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  StepsLineComponent,
  StepsLineItem,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
} from '../../../../shared/components/index';
import { CurrencyPipe, CurrencyFormatService } from '../../../../shared/pipes/currency';
import { ToastService } from '../../../../shared/components/toast/toast.service';

// Sub-componentes admin REUSADOS TAL CUAL (planillas de despacho). El lado
// carrier de "Mi Ruta" comparte exactamente la misma forma de ruta/parada, así
// que compone los modales/vistas existentes en lugar de reskinnear la página.
import { StopSettleModalComponent } from '../../store/planillas-rutas/components/stop-settle-modal/stop-settle-modal.component';
import { StopReleaseModalComponent } from '../../store/planillas-rutas/components/stop-release-modal/stop-release-modal.component';
import { PlanillaCloseModalComponent } from '../../store/planillas-rutas/components/planilla-close-modal/planilla-close-modal.component';
import { StopDetailModalComponent } from '../../store/planillas-rutas/components/stop-detail-modal/stop-detail-modal.component';

import { ActiveRouteStore } from '../state/active-route.store';
import { RepartosService } from '../services/repartos.service';
import type {
  CloseDispatchRouteDto,
  DispatchRouteStatus,
  DispatchRouteStop,
  ReleaseStopDto,
  SettleStopDto,
} from '../interfaces/repartos.interface';
// `DispatchDeliveryAddress` no se re-exporta desde `repartos.interface`; se
// importa como tipo directamente desde la interfaz de planillas (misma fuente
// que usa `repartos.interface` internamente) para portar el gate de dirección.
import type { DispatchDeliveryAddress } from '../../store/planillas-rutas/interfaces/planilla.interface';

/**
 * Fase F4 — "Mi Ruta activa" (`/repartos/ruta`).
 *
 * Página donde el repartidor (rol `carrier`, app_type STORE_DELIVERY) ejecuta su
 * recorrido: inicia (dispatch), entrega/cobra cada parada (settle → delivered |
 * rejected), libera las no entregadas (release) y cierra cuadrando el efectivo
 * (close). Lee la ruta activa del singleton `ActiveRouteStore` y muta el estado
 * vía `RepartosService` (namespace `/store/carrier/*`), NO `PlanillasRutasService`.
 *
 * Compone los sub-componentes admin de planillas TAL CUAL (settle / release /
 * close / detail modals + ResponsiveDataView + StickyHeader + StepsLine); es un
 * SUBSET de acciones carrier (sin void / scanner IA / PDF).
 *
 * Zoneless-safe: todo el estado observado por la plantilla vive en signals del
 * store o locales; los derivados son `computed`.
 */
@Component({
  selector: 'app-ruta-activa-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    CurrencyPipe,
    StickyHeaderComponent,
    StepsLineComponent,
    ResponsiveDataViewComponent,
    StopSettleModalComponent,
    StopReleaseModalComponent,
    PlanillaCloseModalComponent,
    StopDetailModalComponent,
  ],
  template: `
    <div class="w-full min-h-screen">
      <app-sticky-header
        title="Mi Ruta"
        [subtitle]="headerSubtitle()"
        icon="truck"
        [badgeText]="route() ? statusLabel(route()!.status) : ''"
        [badgeColor]="headerBadgeColor()"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      ></app-sticky-header>

      <div class="p-3 md:p-4 space-y-4">
        @if (loading() && !route()) {
          <div class="py-12 text-center text-sm text-text-secondary">
            Cargando tu ruta…
          </div>
        } @else if (route(); as r) {
          <!-- Estado terminal: ruta anulada por el admin -->
          @if (r.status === 'voided') {
            <app-card shadow="sm" [responsivePadding]="true">
              <div class="flex items-start gap-3">
                <span
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 border border-red-200 text-red-600"
                >
                  <app-icon name="x-circle" [size]="20"></app-icon>
                </span>
                <div class="min-w-0">
                  <p class="text-sm font-bold text-gray-900">Ruta anulada</p>
                  <p class="mt-0.5 text-sm text-text-secondary">
                    Esta ruta fue anulada por la tienda. No hay acciones
                    disponibles.
                    @if (r.void_reason) {
                      <span class="block mt-1">Motivo: {{ r.void_reason }}</span>
                    }
                  </p>
                </div>
              </div>
            </app-card>
          } @else {
            <!-- Stepper de estado de la ruta -->
            <app-card [padding]="false" shadow="sm">
              <div class="px-2 py-2">
                <app-steps-line
                  [steps]="stepperItems()"
                  [currentStep]="stepperCurrentIndex()"
                  size="md"
                ></app-steps-line>
              </div>
            </app-card>

            <!-- GATE de despacho: paradas sin dirección de entrega -->
            @if (r.status === 'draft' && stopsWithoutAddress().length > 0) {
              <div
                class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="18"
                  class="text-amber-600 mt-0.5 shrink-0"
                ></app-icon>
                <div class="min-w-0 text-sm text-amber-800">
                  <p class="font-semibold">
                    No puedes iniciar: hay paradas sin dirección de entrega
                  </p>
                  <p class="mt-0.5 text-amber-700">
                    Falta dirección en {{ stopsWithoutAddressLabel() }}. Pide a la
                    tienda que la complete antes de iniciar el recorrido.
                  </p>
                </div>
              </div>
            }

            <!-- Resumen del recorrido -->
            <app-card shadow="sm" [responsivePadding]="true">
              <div class="grid grid-cols-2 md:grid-cols-4 gap-4 items-start">
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-text-secondary uppercase tracking-wide"
                    >Paradas</span
                  >
                  <span class="text-lg font-black text-gray-900">
                    {{ stops().length }}
                  </span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-text-secondary uppercase tracking-wide"
                    >Pendientes</span
                  >
                  <span class="text-lg font-black text-amber-600">
                    {{ pendingCount() }}
                  </span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-text-secondary uppercase tracking-wide"
                    >Total a recaudar</span
                  >
                  <span class="text-lg font-black text-gray-900">
                    {{ +r.total_to_collect | currency }}
                  </span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-text-secondary uppercase tracking-wide"
                    >Recaudado</span
                  >
                  <span class="text-lg font-black text-green-600">
                    {{ +r.total_collected | currency }}
                  </span>
                </div>
              </div>

              @if (payoutEstimated() != null) {
                <div
                  class="mt-3 pt-3 border-t border-border flex justify-between items-center text-sm"
                >
                  <span class="text-text-secondary">Tu pago estimado</span>
                  <span class="font-semibold text-gray-900">
                    {{ payoutEstimated()! | currency }}
                  </span>
                </div>
              }
            </app-card>

            <!-- Análisis de cierre (ruta cerrada, read-only) -->
            @if (r.status === 'closed') {
              <app-card shadow="sm" [responsivePadding]="true" [showHeader]="true">
                <div slot="header" class="flex items-center gap-3">
                  <span
                    class="w-10 h-10 rounded-lg bg-green-50 border border-green-200 flex items-center justify-center text-green-600"
                  >
                    <app-icon name="check-circle" size="18"></app-icon>
                  </span>
                  <div class="flex flex-col">
                    <span class="text-sm font-bold text-gray-900"
                      >Ruta cerrada</span
                    >
                    <span class="text-xs text-text-secondary"
                      >Cuadre final del recorrido</span
                    >
                  </div>
                </div>

                <div class="space-y-2">
                  <div class="flex justify-between items-center text-sm">
                    <span class="text-text-secondary">Total recaudado</span>
                    <span class="font-semibold text-green-600">{{
                      +r.total_collected | currency
                    }}</span>
                  </div>
                  <div class="flex justify-between items-center text-sm">
                    <span class="text-text-secondary">A crédito</span>
                    <span class="font-semibold text-amber-600">{{
                      +r.total_credit | currency
                    }}</span>
                  </div>
                  <div class="flex justify-between items-center text-sm">
                    <span class="text-text-secondary">Retenciones</span>
                    <span class="font-semibold text-gray-900">{{
                      +r.total_withholdings | currency
                    }}</span>
                  </div>
                  @if (r.declared_cash != null) {
                    <div class="flex justify-between items-center text-sm">
                      <span class="text-text-secondary">Efectivo declarado</span>
                      <span class="font-semibold text-gray-900">{{
                        +r.declared_cash | currency
                      }}</span>
                    </div>
                  }
                </div>

                @if (r.cash_variance != null) {
                  <div
                    class="mt-4 p-4 rounded-lg flex items-center gap-3"
                    [class]="varianceClass()"
                  >
                    <app-icon [name]="varianceIcon()" [size]="22"></app-icon>
                    <div class="flex flex-col">
                      <span
                        class="text-xs uppercase tracking-wide font-semibold opacity-80"
                      >
                        Diferencia de caja {{ varianceLabel() }}
                      </span>
                      <span class="text-xl sm:text-2xl font-black leading-tight">
                        {{ +r.cash_variance | currency }}
                      </span>
                    </div>
                  </div>
                }

                @if (payoutEarned() != null) {
                  <div
                    class="mt-3 p-4 rounded-lg bg-primary-50 border border-primary-200 flex items-center gap-3"
                  >
                    <app-icon name="wallet" [size]="22" class="text-primary-600"></app-icon>
                    <div class="flex flex-col">
                      <span
                        class="text-xs uppercase tracking-wide font-semibold text-primary-700 opacity-80"
                      >
                        Tu pago por esta ruta
                      </span>
                      <span class="text-xl sm:text-2xl font-black leading-tight text-primary-700">
                        {{ payoutEarned()! | currency }}
                      </span>
                    </div>
                  </div>
                }
              </app-card>
            }

            <!-- Paradas -->
            <app-card [padding]="true">
              <div class="flex items-center justify-between gap-2 mb-3">
                <h2 class="text-lg font-semibold">
                  Paradas ({{ stops().length }})
                </h2>
                @if (stops().length > 0) {
                  <app-button
                    variant="outline"
                    size="sm"
                    routerLink="/repartos/mapa"
                  >
                    <app-icon slot="icon" name="map-pin" [size]="16"></app-icon>
                    Ver mapa
                  </app-button>
                }
              </div>

              <app-responsive-data-view
                [data]="stopRows()"
                [columns]="stopColumns"
                [actions]="stopActions"
                [cardConfig]="stopCardConfig"
                actionsDisplay="buttons"
                emptyMessage="Tu ruta no tiene paradas."
                emptyIcon="map-pin"
                (rowClick)="openStopDetail($event)"
              ></app-responsive-data-view>
            </app-card>
          }
        } @else {
          <!-- Sin ruta activa -->
          <app-empty-state
            icon="truck"
            title="No tienes una ruta activa"
            description="Toma pedidos disponibles para armar tu ruta y empezar a repartir."
            actionButtonText="Ir a pedidos disponibles"
            actionButtonIcon="package"
            [showActionButton]="true"
            (actionClick)="goToPool()"
          ></app-empty-state>
        }
      </div>
    </div>

    <!-- Modales (compuestos TAL CUAL desde el lado admin) -->
    @if (settleStopSig(); as s) {
      <app-stop-settle-modal
        [stop]="s"
        [grandTotal]="+(s.dispatch_note?.grand_total || 0)"
        [isPrepaid]="!!s.is_prepaid"
        (close)="settleStopSig.set(null)"
        (submitted)="onSettle($event)"
      ></app-stop-settle-modal>
    }

    @if (releaseStopSig(); as s) {
      <app-stop-release-modal
        [stop]="s"
        (close)="releaseStopSig.set(null)"
        (submitted)="onRelease($event)"
      ></app-stop-release-modal>
    }

    @if (showCloseModal() && route()) {
      <app-planilla-close-modal
        [route]="route()!"
        (close)="showCloseModal.set(false)"
        (submitted)="onClose($event)"
      ></app-planilla-close-modal>
    }

    @if (detailStop(); as s) {
      <app-stop-detail-modal
        [stop]="s"
        (close)="detailStop.set(null)"
        (goToNote)="detailStop.set(null)"
      ></app-stop-detail-modal>
    }
  `,
})
export class RutaActivaPageComponent {
  private readonly store = inject(ActiveRouteStore);
  private readonly repartosService = inject(RepartosService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Estado leído del store (single source of truth) ────────────────────────
  readonly route = this.store.activeRoute;
  readonly stops = this.store.stops;
  readonly payout = this.store.payout;
  readonly loading = this.store.loading;

  // ── Estado local de la página ──────────────────────────────────────────────
  readonly actionLoading = signal(false);
  readonly settleStopSig = signal<DispatchRouteStop | null>(null);
  readonly releaseStopSig = signal<DispatchRouteStop | null>(null);
  readonly showCloseModal = signal(false);
  readonly detailStop = signal<DispatchRouteStop | null>(null);

  ngOnInit(): void {
    // Resolución perezosa idempotente: si el shell ya cargó la ruta esto es un
    // no-op; si el carrier abrió `/repartos/ruta` directo, carga aquí.
    this.store.resolve();
  }

  // ── Derivados de cabecera ───────────────────────────────────────────────────

  readonly headerSubtitle = computed(() => {
    const r = this.route();
    if (!r) return 'Tu recorrido de reparto';
    return r.route_number ? `Ruta ${r.route_number}` : 'Tu recorrido de reparto';
  });

  readonly headerBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    switch (this.route()?.status) {
      case 'draft':
        return 'gray';
      case 'dispatched':
      case 'in_transit':
        return 'blue';
      case 'closed':
        return 'green';
      case 'voided':
        return 'red';
      default:
        return 'gray';
    }
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const r = this.route();
    if (!r) return [];
    const busy = this.actionLoading();
    const actions: StickyHeaderActionButton[] = [];

    if (r.status === 'draft') {
      const blocked = !this.canDispatch();
      actions.push({
        id: 'start',
        label: 'Iniciar recorrido',
        variant: 'primary',
        icon: 'truck',
        loading: busy,
        disabled: busy || blocked,
        title: blocked
          ? `Faltan direcciones de entrega en: ${this.stopsWithoutAddressLabel()}`
          : undefined,
      });
    }

    if (r.status === 'dispatched' || r.status === 'in_transit') {
      actions.push({
        id: 'close',
        label: 'Cerrar y cuadrar',
        variant: 'primary',
        icon: 'check-circle',
        loading: busy,
        disabled: busy,
      });
    }

    return actions;
  });

  onHeaderAction(actionId: string): void {
    if (actionId === 'start') this.startRoute();
    if (actionId === 'close') this.showCloseModal.set(true);
  }

  // ── Stepper de estado ───────────────────────────────────────────────────────

  private readonly STEPPER_FLOW: ReadonlyArray<{
    status: DispatchRouteStatus;
    label: string;
  }> = [
    { status: 'draft', label: 'Por iniciar' },
    { status: 'dispatched', label: 'Despachada' },
    { status: 'in_transit', label: 'En ruta' },
    { status: 'closed', label: 'Cerrada' },
  ];

  readonly stepperItems = computed<StepsLineItem[]>(() =>
    this.STEPPER_FLOW.map((s) => ({ label: s.label })),
  );

  readonly stepperCurrentIndex = computed<number>(() => {
    const s = this.route()?.status;
    const i = this.STEPPER_FLOW.findIndex((n) => n.status === s);
    return i < 0 ? 0 : i;
  });

  // ── Resumen ──────────────────────────────────────────────────────────────────

  readonly pendingCount = computed<number>(
    () =>
      this.stops().filter(
        (s) => s.status === 'pending' || s.status === 'in_progress',
      ).length,
  );

  /** Pago estimado del carrier (durante la ruta) — numérico o null. */
  readonly payoutEstimated = computed<number | null>(() => {
    const raw = this.payout()?.estimated;
    return raw != null ? Number(raw) || 0 : null;
  });

  /** Pago ganado del carrier (tras cerrar) — numérico o null. */
  readonly payoutEarned = computed<number | null>(() => {
    const raw = this.payout()?.earned;
    return raw != null ? Number(raw) || 0 : null;
  });

  // ── Varianza de caja (panel de cierre) ──────────────────────────────────────

  readonly varianceClass = computed(() => {
    const v = Number(this.route()?.cash_variance || 0);
    if (v === 0) return 'bg-green-50 text-green-800 border border-green-200';
    if (v > 0) return 'bg-blue-50 text-blue-800 border border-blue-200';
    return 'bg-red-50 text-red-800 border border-red-200';
  });

  readonly varianceIcon = computed<string>(() => {
    const v = Number(this.route()?.cash_variance || 0);
    if (v === 0) return 'check-circle';
    if (v > 0) return 'arrow-up-circle';
    return 'alert-circle';
  });

  readonly varianceLabel = computed<string>(() => {
    const v = Number(this.route()?.cash_variance || 0);
    if (v === 0) return '(CUADRA)';
    if (v > 0) return '(SOBRA)';
    return '(FALTA)';
  });

  // ── Paradas: data-display (tabla desktop / tarjetas móvil) ──────────────────

  /** Estado de la parada → color hex del badge custom (7-char inline). */
  private readonly STOP_STATUS_COLORS: Record<string, string> = {
    pending: '#4b5563',
    in_progress: '#2563eb',
    delivered: '#16a34a',
    partial: '#ca8a04',
    rejected: '#dc2626',
    released: '#9333ea',
  };

  readonly stopColumns: TableColumn[] = [
    {
      key: 'stop_sequence',
      label: '#',
      width: '48px',
      align: 'center',
      priority: 1,
      transform: (value: any) => `#${value ?? ''}`,
    },
    {
      key: 'dispatch_note.dispatch_number',
      label: 'Remisión',
      priority: 1,
      transform: (_: any, row?: DispatchRouteStop) =>
        row?.dispatch_note?.dispatch_number || '—',
    },
    {
      key: 'dispatch_note.customer_name',
      label: 'Cliente',
      priority: 2,
      transform: (_: any, row?: DispatchRouteStop) =>
        row?.dispatch_note?.customer_name || '(Cliente)',
    },
    {
      key: 'dispatch_note.customer_address',
      label: 'Dirección',
      priority: 3,
      transform: (_: any, row?: DispatchRouteStop) =>
        row ? this.formatStopAddress(row) : '—',
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: this.STOP_STATUS_COLORS,
      },
      transform: (value: any) => this.stopStatusLabel(String(value)),
    },
    {
      key: 'dispatch_note.grand_total',
      label: 'Total',
      align: 'right',
      priority: 1,
      transform: (_: any, row?: DispatchRouteStop) =>
        this.formatMoney(row?.dispatch_note?.grand_total),
    },
  ];

  readonly stopActions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'info',
      action: (row: DispatchRouteStop) => this.openStopDetail(row),
    },
    {
      label: 'Entregar/Cobrar',
      icon: 'wallet',
      variant: 'primary',
      action: (row: DispatchRouteStop) => this.settleStopSig.set(row),
      show: (row: DispatchRouteStop) => this.canActOnStop(row),
    },
    {
      label: 'No entregada',
      icon: 'x-circle',
      variant: 'danger',
      action: (row: DispatchRouteStop) => this.releaseStopSig.set(row),
      show: (row: DispatchRouteStop) => this.canActOnStop(row),
    },
  ];

  readonly stopCardConfig: ItemListCardConfig = {
    titleKey: 'dispatch_note.dispatch_number',
    titleTransform: (item: DispatchRouteStop) =>
      `#${item.stop_sequence} · ${item.dispatch_note?.dispatch_number || '—'}`,
    subtitleTransform: (item: DispatchRouteStop) =>
      item.dispatch_note?.customer_name || '(Cliente)',
    avatarFallbackIcon: 'map-pin',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: this.STOP_STATUS_COLORS,
    },
    badgeTransform: (value: any) => this.stopStatusLabel(String(value)),
    footerKey: 'dispatch_note.grand_total',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (_: any, item?: DispatchRouteStop) =>
      this.formatMoney(item?.dispatch_note?.grand_total),
    detailKeys: [
      {
        key: 'dispatch_note.customer_address',
        label: 'Dirección',
        icon: 'map-pin',
        transform: (_: any, item?: DispatchRouteStop) =>
          item ? this.formatStopAddress(item) : '—',
      },
      {
        key: 'collected_amount',
        label: 'Recaudado',
        icon: 'banknote',
        transform: (value: any) =>
          Number(value) > 0 ? this.formatMoney(value) : '—',
      },
    ],
  };

  /** Paradas del store, expuestas como filas del data-view. */
  readonly stopRows = computed<DispatchRouteStop[]>(() => this.stops());

  // ── Acciones de ruta ──────────────────────────────────────────────────────

  /** `draft` → inicia el recorrido (dispatch). Gateado por dirección de parada. */
  startRoute(): void {
    const missing = this.stopsWithoutAddress();
    if (missing.length > 0) {
      this.toast.error(
        `No puedes iniciar: faltan direcciones de entrega en ${this.stopsWithoutAddressLabel()}`,
      );
      return;
    }
    this.actionLoading.set(true);
    this.repartosService
      .dispatchRoute()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.store.refresh();
          this.toast.success('Recorrido iniciado');
          // Al iniciar ruta, salta al mapa para que el conductor vea por dónde ir
          // (el mapa es la vista útil ahora; el trazo por calles lo trae route-map-view).
          this.router.navigate(['/repartos/mapa']);
        },
        error: (e) => {
          this.actionLoading.set(false);
          this.toast.error(e?.message || 'No se pudo iniciar el recorrido');
        },
      });
  }

  onSettle(dto: SettleStopDto): void {
    const stop = this.settleStopSig();
    if (!stop) return;
    this.actionLoading.set(true);
    this.repartosService
      .settleStop(stop.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.settleStopSig.set(null);
          this.store.refresh();
          this.toast.success('Parada liquidada');
        },
        error: (e) => {
          this.actionLoading.set(false);
          this.toast.error(e?.message || 'No se pudo liquidar la parada');
        },
      });
  }

  onRelease(dto: ReleaseStopDto): void {
    const stop = this.releaseStopSig();
    if (!stop) return;
    this.actionLoading.set(true);
    this.repartosService
      .releaseStop(stop.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.releaseStopSig.set(null);
          this.store.refresh();
          this.toast.success('Parada liberada');
        },
        error: (e) => {
          this.actionLoading.set(false);
          this.toast.error(e?.message || 'No se pudo liberar la parada');
        },
      });
  }

  onClose(dto: CloseDispatchRouteDto): void {
    this.actionLoading.set(true);
    this.repartosService
      .closeRoute(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.actionLoading.set(false);
          this.showCloseModal.set(false);
          // El endpoint devuelve la ruta cerrada + payout ganado, pero no las
          // paradas; una ruta cerrada ya no es "activa", así que un refresh
          // devolvería null. Se aplica el resultado directo al store para que
          // el panel de cierre read-only lo renderice (variance vive en la ruta).
          this.store.set({
            route: result.route,
            stops: this.stops(),
            payout: result.payout,
          });
          this.toast.success('Ruta cerrada y cuadrada');
        },
        error: (e) => {
          this.actionLoading.set(false);
          this.toast.error(e?.message || 'No se pudo cerrar la ruta');
        },
      });
  }

  openStopDetail(stop: DispatchRouteStop): void {
    this.detailStop.set(stop);
  }

  goToPool(): void {
    this.router.navigate(['/repartos/pool']);
  }

  // ── Reglas de estado de parada ──────────────────────────────────────────────

  /** Parada accionable: ruta en curso y parada no finalizada. */
  canActOnStop(stop: DispatchRouteStop): boolean {
    const rs = this.route()?.status;
    return (
      (rs === 'dispatched' || rs === 'in_transit') &&
      !['delivered', 'released', 'rejected', 'partial'].includes(stop.status)
    );
  }

  // ── Dirección de entrega (GATE de despacho) ─────────────────────────────────

  private resolveStopAddress(
    stop: DispatchRouteStop,
  ): DispatchDeliveryAddress | null {
    const note = stop.dispatch_note;
    return note?.customer_address ?? note?.order?.shipping_address_snapshot ?? null;
  }

  /** Mirror del gate backend `DISPATCH_ROUTE_STOP_NO_ADDRESS` (line1 presente). */
  private stopHasAddress(stop: DispatchRouteStop): boolean {
    const a = this.resolveStopAddress(stop);
    if (!a) return false;
    const line1 = a.address_line1 ?? a.line1 ?? a.address;
    return typeof line1 === 'string' && line1.trim().length > 0;
  }

  formatStopAddress(stop: DispatchRouteStop): string {
    const a = this.resolveStopAddress(stop);
    if (!a) return '—';
    const parts = [a.address_line1 ?? a.line1 ?? a.address, a.city, a.state_province]
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0);
    return parts.length > 0 ? parts.join(', ') : '—';
  }

  /** Paradas deliverables sin dirección (bloquean el inicio del recorrido). */
  readonly stopsWithoutAddress = computed<DispatchRouteStop[]>(() =>
    this.stops().filter(
      (s) =>
        s.status !== 'released' &&
        s.status !== 'rejected' &&
        !this.stopHasAddress(s),
    ),
  );

  readonly stopsWithoutAddressLabel = computed<string>(() =>
    this.stopsWithoutAddress()
      .map((s) => s.dispatch_note?.dispatch_number || `#${s.dispatch_note_id}`)
      .join(', '),
  );

  /** True si la ruta se puede iniciar (draft sin paradas sin dirección). */
  readonly canDispatch = computed<boolean>(() => {
    const r = this.route();
    if (!r || r.status !== 'draft') return true;
    return this.stopsWithoutAddress().length === 0;
  });

  // ── Helpers de presentación ──────────────────────────────────────────────────

  statusLabel(s: string): string {
    const map: Record<string, string> = {
      draft: 'Por iniciar',
      dispatched: 'Despachada',
      in_transit: 'En ruta',
      closed: 'Cerrada',
      voided: 'Anulada',
    };
    return map[s] || s;
  }

  stopStatusLabel(s: string): string {
    const map: Record<string, string> = {
      pending: 'Pendiente',
      in_progress: 'En curso',
      delivered: 'Entregada',
      partial: 'Parcial',
      rejected: 'Rechazada',
      released: 'Liberada',
    };
    return map[s] || s;
  }

  /** Formatea dinero (Decimal string o number) con el servicio de moneda. */
  formatMoney(value: unknown): string {
    const num = typeof value === 'string' ? parseFloat(value) : Number(value);
    return this.currencyService.format(Number(num) || 0);
  }
}
