import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import {
  CardComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  OptionsDropdownComponent,
  DropdownAction,
  StepsLineComponent,
  StepsLineItem,
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../../../shared/components/index';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { StopSettleModalComponent } from '../../components/stop-settle-modal/stop-settle-modal.component';
import { StopReleaseModalComponent } from '../../components/stop-release-modal/stop-release-modal.component';
import { PlanillaCloseModalComponent } from '../../components/planilla-close-modal/planilla-close-modal.component';
import { PlanillaPdfViewerComponent } from '../../components/planilla-pdf-viewer/planilla-pdf-viewer.component';
import { VoidDispatchRouteModalComponent } from '../../components/void-dispatch-route-modal/void-dispatch-route-modal.component';
import { RouteSheetScannerModalComponent } from '../../components/route-sheet-scanner-modal/route-sheet-scanner-modal.component';
import { StopDetailModalComponent } from '../../components/stop-detail-modal/stop-detail-modal.component';
import { DispatchNotesService } from '../../../dispatch-notes/services/dispatch-notes.service';
import { DispatchNote } from '../../../dispatch-notes/interfaces/dispatch-note.interface';
import {
  CloseDispatchRouteDto,
  DispatchDeliveryAddress,
  DispatchRoute,
  DispatchRouteStatus,
  DispatchRouteStop,
  ReleaseStopDto,
  SettleStopDto,
} from '../../interfaces/planilla.interface';

/** Recaudo (collection) status surfaced per stop on the detail page. */
type StopCollectionState = 'prepaid' | 'collected' | 'pending_cod' | 'none';

@Component({
  selector: 'app-planilla-detail-page',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StickyHeaderComponent,
    IconComponent,
    CurrencyPipe,
    OptionsDropdownComponent,
    StepsLineComponent,
    ResponsiveDataViewComponent,
    StopSettleModalComponent,
    StopReleaseModalComponent,
    PlanillaCloseModalComponent,
    PlanillaPdfViewerComponent,
    RouteSheetScannerModalComponent,
    VoidDispatchRouteModalComponent,
    StopDetailModalComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        [title]="headerTitle()"
        [subtitle]="headerSubtitle()"
        icon="truck"
        [showBackButton]="true"
        backRoute="/admin/orders/planillas"
        [badgeText]="route() ? statusLabel(route()!.status) : ''"
        [badgeColor]="headerBadgeColor()"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      ></app-sticky-header>

      <div class="p-3 md:p-4 space-y-4">
        @if (loading()) {
          <div class="text-center py-8 text-text-secondary">Cargando...</div>
        } @else if (route(); as r) {
          <!-- Route status stepper -->
          @if (r.status !== 'voided') {
            <app-card [padding]="false" shadow="sm">
              <div class="px-2 py-1">
                <app-steps-line
                  [steps]="stepperLineItems()"
                  [currentStep]="stepperCurrentIndex()"
                  size="md"
                ></app-steps-line>
              </div>
            </app-card>
          }

          <!-- Bug 6 — Dispatch blocked: stops without delivery address -->
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
                  No se puede despachar: hay remisiones sin dirección de entrega
                </p>
                <p class="mt-0.5 text-amber-700">
                  Agrega una dirección a {{ stopsWithoutAddressLabel() }} antes de despachar la planilla.
                </p>
              </div>
            </div>
          }

          <!-- Summary -->
          <app-card shadow="sm" [responsivePadding]="true">
            <h2
              class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4"
            >
              Resumen del despacho
            </h2>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 items-start">
              <div class="flex flex-col gap-1">
                <span class="text-xs text-text-secondary uppercase tracking-wide">Conductor</span>
                <span class="font-semibold text-gray-900">
                  @if (r.driver_user) {
                    {{ r.driver_user.first_name }} {{ r.driver_user.last_name }}
                  } @else if (r.external_driver_name) {
                    {{ r.external_driver_name }} <span class="text-xs font-normal text-text-secondary">(ext.)</span>
                  } @else {
                    —
                  }
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-text-secondary uppercase tracking-wide">Vehículo</span>
                <span class="font-semibold text-gray-900">{{ r.vehicle?.plate || '—' }}</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-text-secondary uppercase tracking-wide">Total a recaudar</span>
                <span class="text-lg font-black text-gray-900">{{ +r.total_to_collect | currency }}</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-text-secondary uppercase tracking-wide">Recaudado</span>
                <span class="text-lg font-black text-green-600">{{ totalCollectedLive(r) | currency }}</span>
              </div>
            </div>

            @if (pendingCollectionLive(r) > 0) {
              <div
                class="mt-3 pt-3 border-t border-border flex justify-between items-center text-sm"
              >
                <span class="text-text-secondary">A cobrar</span>
                <span class="font-semibold text-amber-700">{{ pendingCollectionLive(r) | currency }}</span>
              </div>
            }

            <div class="mt-3 text-xs text-text-secondary">
              {{ r.planned_date | date: 'dd MMM yyyy, HH:mm' }}
            </div>
          </app-card>

          <!-- Closure analysis (only when route is closed) -->
          @if (r.status === 'closed') {
            <app-card shadow="sm" [responsivePadding]="true" [showHeader]="true">
              <div slot="header" class="flex items-center gap-3">
                <span
                  class="w-10 h-10 rounded-lg bg-green-50 border border-green-200 flex items-center justify-center text-green-600"
                >
                  <app-icon name="check-circle" size="18"></app-icon>
                </span>
                <div class="flex flex-col">
                  <span class="text-sm font-bold text-gray-900">Análisis de cierre</span>
                  <span class="text-xs text-text-secondary">Cuadre final de la ruta</span>
                </div>
              </div>

              <div class="space-y-2">
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">Total por recaudar</span>
                  <span class="font-semibold text-gray-900">{{ +r.total_to_collect | currency }}</span>
                </div>
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">Total recaudado</span>
                  <span class="font-semibold text-green-600">{{ totalCollectedLive(r) | currency }}</span>
                </div>
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">A crédito</span>
                  <span class="font-semibold text-amber-600">{{ +r.total_credit | currency }}</span>
                </div>
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">Retenciones</span>
                  <span class="font-semibold text-gray-900">{{ +r.total_withholdings | currency }}</span>
                </div>

                @if (r.declared_cash != null) {
                  <div class="pt-3 mt-1 border-t border-border space-y-2">
                    <div class="flex justify-between items-center text-sm">
                      <span class="text-text-secondary">Efectivo declarado</span>
                      <span class="font-semibold text-gray-900">{{ +r.declared_cash | currency }}</span>
                    </div>
                    <div class="flex justify-between items-center text-sm">
                      <span class="text-text-secondary">Cambios/devoluciones</span>
                      <span class="font-semibold text-gray-900">{{ +r.total_changes | currency }}</span>
                    </div>
                  </div>
                }
              </div>

              @if (r.cash_variance != null) {
                <div class="mt-4 p-4 rounded-lg flex items-center gap-3" [class]="varianceClass()">
                  <app-icon [name]="varianceIcon()" [size]="22"></app-icon>
                  <div class="flex flex-col">
                    <span class="text-xs uppercase tracking-wide font-semibold opacity-80">
                      Diferencia de caja {{ varianceLabel() }}
                    </span>
                    <span class="text-xl sm:text-2xl font-black leading-tight">
                      {{ +r.cash_variance | currency }}
                    </span>
                  </div>
                </div>
              }
            </app-card>
          }

          <!-- Stops (standard responsive data-display container) -->
          <app-card [padding]="true">
            <!-- Container header: title + secondary (documental/AI) actions dropdown -->
            <div class="flex items-center justify-between gap-2 mb-3">
              <h2 class="text-lg font-semibold">
                Paradas ({{ r.stops?.length || 0 }})
              </h2>

              <app-options-dropdown
                [filters]="[]"
                [actions]="documentalActions()"
                [showActions]="true"
                triggerLabel="Acciones"
                triggerIcon="more-horizontal"
                (actionClick)="onDocumentalAction($event)"
              ></app-options-dropdown>
            </div>

            <app-responsive-data-view
              [data]="stopRows()"
              [columns]="stopColumns"
              [actions]="stopActions"
              [cardConfig]="stopCardConfig"
              actionsDisplay="buttons"
              emptyMessage="Esta planilla no tiene paradas."
              emptyIcon="map-pin"
              (rowClick)="openStopDetail($event)"
            ></app-responsive-data-view>
          </app-card>
        }
      </div>
    </div>

    @if (settleStop()) {
      <app-stop-settle-modal
        [stop]="settleStop()!"
        [grandTotal]="+(settleStop()!.dispatch_note?.grand_total || 0)"
        [isPrepaid]="!!settleStop()!.is_prepaid"
        (close)="settleStop.set(null)"
        (submitted)="onSettle($event)"
      ></app-stop-settle-modal>
    }

    @if (releaseStop()) {
      <app-stop-release-modal
        [stop]="releaseStop()!"
        (close)="releaseStop.set(null)"
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

    @if (showVoidModal() && route()) {
      <app-void-dispatch-route-modal
        [route]="route()!"
        (close)="showVoidModal.set(false)"
        (submitted)="onVoid($event)"
      ></app-void-dispatch-route-modal>
    }

    @if (showPdfViewer() && route()) {
      <app-planilla-pdf-viewer
        [routeId]="route()!.id"
        (close)="showPdfViewer.set(false)"
      ></app-planilla-pdf-viewer>
    }

    @if (showScannerModal() && route()) {
      <app-route-sheet-scanner-modal
        [routeId]="route()!.id"
        [isOpen]="showScannerModal()"
        [route]="route()"
        (closed)="showScannerModal.set(false)"
        (confirmed)="onScanConfirmed()"
      ></app-route-sheet-scanner-modal>
    }

    @if (detailStop()) {
      <app-stop-detail-modal
        [stop]="detailStop()!"
        [note]="detailNote()"
        [loading]="detailLoading()"
        (close)="closeStopDetail()"
        (goToNote)="goToDispatchNote($event)"
      ></app-stop-detail-modal>
    }
  `,
})
export class PlanillaDetailPageComponent {
  private readonly service = inject(PlanillasRutasService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly dispatchNotesService = inject(DispatchNotesService);

  readonly routeId = signal<number>(0);
  readonly route = signal<DispatchRoute | null>(null);
  readonly loading = signal(false);
  readonly actionLoading = signal(false);
  readonly downloadingPdf = signal(false);

  readonly settleStop = signal<DispatchRouteStop | null>(null);
  readonly releaseStop = signal<DispatchRouteStop | null>(null);
  readonly showCloseModal = signal(false);
  readonly showPdfViewer = signal(false);
  readonly showVoidModal = signal(false);
  readonly showScannerModal = signal(false);

  // A1 — Quick-view del detalle de una remisión/parada.
  readonly detailStop = signal<DispatchRouteStop | null>(null);
  readonly detailNote = signal<DispatchNote | null>(null);
  readonly detailLoading = signal(false);

  /** Linear status order for the route mini-stepper (voided is terminal/off-flow). */
  private readonly STEPPER_FLOW: ReadonlyArray<{ status: DispatchRouteStatus; label: string }> = [
    { status: 'draft', label: 'Borrador' },
    { status: 'dispatched', label: 'Despachada' },
    { status: 'in_transit', label: 'En ruta' },
    { status: 'settling', label: 'Cuadrando' },
    { status: 'closed', label: 'Cerrada' },
  ];

  /** Steps for the shared app-steps-line (labels only; symmetric horizontal layout). */
  readonly stepperLineItems = computed<StepsLineItem[]>(() =>
    this.STEPPER_FLOW.map((n) => ({ label: n.label })),
  );

  /** 0-based index of the route's current status within STEPPER_FLOW. */
  readonly stepperCurrentIndex = computed<number>(() => {
    const s = this.route()?.status;
    const i = this.STEPPER_FLOW.findIndex((n) => n.status === s);
    return i < 0 ? 0 : i;
  });

  /** Documental / AI actions surfaced in the Paradas options dropdown. */
  readonly documentalActions = computed<DropdownAction[]>(() => [
    { label: 'Imprimir planilla', icon: 'printer', action: 'print' },
    {
      label: this.downloadingPdf() ? 'Descargando…' : 'Descargar PDF',
      icon: 'download',
      action: 'download',
      disabled: this.downloadingPdf(),
    },
    {
      label: 'Cargar planilla escaneada (IA)',
      icon: 'scan-line',
      action: 'scan',
      disabled: !this.canScanSheet(),
    },
  ]);

  readonly headerTitle = computed(() => this.route()?.route_number ?? 'Planilla');

  readonly headerSubtitle = computed(() => {
    const r = this.route();
    return r?.route_code ? `Ruta ${r.route_code}` : 'Detalle de planilla';
  });

  readonly headerBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    const s = this.route()?.status;
    switch (s) {
      case 'draft':
        return 'gray';
      case 'dispatched':
      case 'in_transit':
        return 'blue';
      case 'settling':
        return 'yellow';
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
        id: 'dispatch',
        label: 'Despachar',
        variant: 'primary',
        icon: 'truck',
        loading: busy,
        disabled: busy || blocked,
        title: blocked
          ? `No se puede despachar: las siguientes remisiones no tienen dirección de entrega: ${this.stopsWithoutAddressLabel()}`
          : undefined,
      });
    }

    if (['dispatched', 'in_transit', 'settling'].includes(r.status)) {
      actions.push({
        id: 'close',
        label: 'Cerrar y cuadrar',
        variant: 'primary',
        icon: 'check-circle',
        loading: busy,
        disabled: busy,
      });
    }

    if (r.status !== 'closed' && r.status !== 'voided') {
      actions.push({
        id: 'void',
        label: 'Anular',
        variant: 'outline-danger',
        icon: 'x-circle',
        disabled: busy,
      });
    }

    // Documental/AI actions (print / download-pdf / scan-sheet) have been moved
    // out of the sticky header into the Paradas container's secondary dropdown,
    // keeping the sticky header focused on direct/immediate route actions.
    return actions;
  });

  /**
   * Whether the scanned-sheet closure shortcut is available. It only makes sense
   * while the route is active (dispatched / in_transit / settling): a
   * closed/draft/voided route has nothing to settle from a scan. Additionally,
   * we require at least one PENDING/IN_PROGRESS stop — otherwise the scan would
   * be a no-op on an already-settled route. Mirrors the original header gating.
   */
  readonly canScanSheet = computed<boolean>(() => {
    const r = this.route();
    if (!r) return false;
    if (this.actionLoading()) return false;
    if (!['dispatched', 'in_transit', 'settling'].includes(r.status)) {
      return false;
    }
    return !!r.stops?.some(
      (s: any) => s.status === 'pending' || s.status === 'in_progress',
    );
  });

  /** Explanatory tooltip surfaced when the scan action is disabled. */
  readonly scanSheetDisabledReason = computed<string | null>(() => {
    if (this.canScanSheet()) return null;
    const r = this.route();
    if (!r || !['dispatched', 'in_transit', 'settling'].includes(r.status)) {
      return 'Solo disponible en planillas despachadas, en ruta o cuadrando.';
    }
    return 'Todas las paradas ya están liquidadas o liberadas.';
  });

  // ---------------------------------------------------------------------------
  // Paradas — responsive data-display (table desktop / cards mobile)
  // ---------------------------------------------------------------------------

  /**
   * Stop status → CSS color (custom badge). Mirrors the semantics of
   * `stopStatusClass` (Tailwind) but as raw colors, because the data-view custom
   * badge resolves colorMap to inline CSS, not Tailwind classes.
   */
  private readonly STOP_STATUS_COLORS: Record<string, string> = {
    pending: '#4b5563', // gray-600
    in_progress: '#2563eb', // blue-600
    delivered: '#16a34a', // green-600
    partial: '#ca8a04', // yellow-600
    rejected: '#dc2626', // red-600
    released: '#9333ea', // purple-600
  };

  /** Collection (recaudo) state → CSS color for the custom badge. */
  private readonly COLLECTION_STATE_COLORS: Record<string, string> = {
    prepaid: '#16a34a', // green-600
    collected: '#059669', // emerald-600
    pending_cod: '#d97706', // amber-600
    none: '#6b7280', // gray-500
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
      label: 'Dirección de entrega',
      priority: 3,
      transform: (_: any, row?: DispatchRouteStop) =>
        row ? this.formatStopAddress(row) : '—',
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: { type: 'custom', size: 'sm', colorMap: this.STOP_STATUS_COLORS },
      transform: (value: any) => this.stopStatusLabel(String(value)),
    },
    {
      key: '_collectionState',
      label: 'Recaudo',
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: this.COLLECTION_STATE_COLORS,
      },
      transform: (value: any) =>
        this.collectionStateLabel(value as StopCollectionState),
    },
    {
      key: 'dispatch_note.grand_total',
      label: 'Total',
      align: 'right',
      priority: 1,
      transform: (_: any, row?: DispatchRouteStop) => {
        const toCollect = row ? this.amountToCollect(row) : 0;
        const total = Number(row?.dispatch_note?.grand_total || 0);
        // Pending COD stops show the amount still to collect; settled/prepaid
        // stops show the document total.
        return this.formatMoney(toCollect > 0 ? toCollect : total);
      },
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
      label: 'Liquidar',
      icon: 'wallet',
      variant: 'primary',
      action: (row: DispatchRouteStop) => this.openSettle(row),
      show: (row: DispatchRouteStop) =>
        !!this.route() && this.canActOnStop(this.route()!.status, row.status),
    },
    {
      label: 'Liberar',
      icon: 'x-circle',
      variant: 'danger',
      action: (row: DispatchRouteStop) => this.openRelease(row),
      show: (row: DispatchRouteStop) =>
        !!this.route() && this.canActOnStop(this.route()!.status, row.status),
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
    badgeConfig: { type: 'custom', size: 'sm', colorMap: this.STOP_STATUS_COLORS },
    badgeTransform: (value: any) => this.stopStatusLabel(String(value)),
    footerKey: 'dispatch_note.grand_total',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (_: any, item?: DispatchRouteStop) => {
      const toCollect = item ? this.amountToCollect(item) : 0;
      const total = Number(item?.dispatch_note?.grand_total || 0);
      return this.formatMoney(toCollect > 0 ? toCollect : total);
    },
    detailKeys: [
      {
        key: 'dispatch_note.customer_address',
        label: 'Dirección',
        icon: 'map-pin',
        transform: (_: any, item?: DispatchRouteStop) =>
          item ? this.formatStopAddress(item) : '—',
      },
      {
        key: '_collectionState',
        label: 'Recaudo',
        icon: 'banknote',
        transform: (value: any) =>
          this.collectionStateLabel(value as StopCollectionState),
        // Surface the "orden pendiente de pago" signal as a warning info icon
        // next to the recaudo value (replaces the old standalone chip), so a
        // COD stop backed by an unpaid sales order is still flagged.
        infoIconTransform: (_: any, item?: any) =>
          item?._pendingOrder ? 'alert-circle' : undefined,
        infoIconVariantTransform: (_: any, item?: any) =>
          item?._pendingOrder ? 'warning' : undefined,
      },
      {
        key: 'collected_amount',
        label: 'Recaudado',
        icon: 'banknote',
        transform: (value: any) =>
          Number(value) > 0 ? this.formatMoney(Number(value)) : '—',
      },
      {
        key: 'withholding_amount',
        label: 'Retención',
        icon: 'percent',
        transform: (value: any) =>
          Number(value) > 0 ? this.formatMoney(Number(value)) : '—',
      },
      {
        key: 'credit_amount',
        label: 'A crédito',
        icon: 'credit-card',
        transform: (value: any) =>
          Number(value) > 0 ? this.formatMoney(Number(value)) : '—',
      },
      {
        key: 'change_amount',
        label: 'Cambio',
        icon: 'coins',
        transform: (value: any) =>
          Number(value) > 0 ? this.formatMoney(Number(value)) : '—',
      },
    ],
  };

  /**
   * Stops enriched with derived display-only fields used by the data-view custom
   * badges (which resolve colors off a flat key, not a method). The original
   * stop fields are preserved so row actions still receive a full
   * `DispatchRouteStop`.
   */
  readonly stopRows = computed<
    (DispatchRouteStop & {
      _collectionState: StopCollectionState;
      _pendingOrder: boolean;
    })[]
  >(() => {
    const stops = this.route()?.stops ?? [];
    return stops.map((stop) => ({
      ...stop,
      _collectionState: this.collectionState(stop),
      _pendingOrder: this.showPendingOrderChip(stop),
    }));
  });

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

  ngOnInit() {
    // The router is configured WITHOUT withComponentInputBinding(), so route
    // params are read from ActivatedRoute (repo convention — see
    // dispatch-note-detail-page / order-details-page). Reading the param in
    // ngOnInit (not in an effect) avoids NG0950 (required input never bound)
    // and NG0100 (signal writes during the first change-detection pass).
    const id = Number(this.activatedRoute.snapshot.paramMap.get('id'));
    if (id > 0) {
      this.routeId.set(id);
      this.load();
    }
  }

  /**
   * Returns the live collected total for the route. Prefers the backend-provided
   * `reconciliation.total_collected` (which is recomputed server-side on every
   * settle/release) and falls back to the persisted `total_collected` column.
   * This is what powers the header chip so the operator sees real money coming
   * in during the route.
   */
  totalCollectedLive(route: DispatchRoute): number {
    const rec = (route as any).reconciliation;
    if (rec && typeof rec.total_collected === 'number') {
      return Number(rec.total_collected);
    }
    return Number(route.total_collected || 0);
  }

  /**
   * Returns the projected pending collection for OPEN routes. For closed/voided
   * routes the value is 0. Uses the reconciliation projection so the operator
   * knows how much is still pending.
   */
  pendingCollectionLive(route: DispatchRoute): number {
    if (route.status === 'closed' || route.status === 'voided') return 0;
    const rec = (route as any).reconciliation;
    if (rec && typeof rec.pending_collection === 'number') {
      return Number(rec.pending_collection);
    }
    return 0;
  }

  onHeaderAction(actionId: string): void {
    // Sticky header only carries direct/immediate route actions now; the
    // documental/AI actions (print / download-pdf / scan-sheet) are triggered
    // from the Paradas container dropdown.
    switch (actionId) {
      case 'dispatch':
        this.dispatch();
        break;
      case 'close':
        this.openClose();
        break;
      case 'void':
        this.openVoid();
        break;
    }
  }

  load() {
    this.loading.set(true);
    this.service
      .getOne(this.routeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.route.set(r);
          this.loading.set(false);
        },
        error: (e) => {
          this.loading.set(false);
          this.toast.error(e.message);
        },
      });
  }

  dispatch() {
    // Frontend gate (mirrors the backend DISPATCH_ROUTE_STOP_NO_ADDRESS block):
    // refuse to call the endpoint when a deliverable stop has no address, and
    // tell the operator exactly which remisiones are missing one.
    const missing = this.stopsWithoutAddress();
    if (missing.length > 0) {
      this.toast.error(
        `No se puede despachar: las siguientes remisiones no tienen dirección de entrega: ${this.stopsWithoutAddressLabel()}`,
      );
      return;
    }
    this.actionLoading.set(true);
    this.service
      .dispatch(this.routeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.actionLoading.set(false);
          this.route.set(r);
          this.toast.success('Planilla despachada');
        },
        error: (e) => {
          this.actionLoading.set(false);
          // The service maps API errors to `Error(message)` and the backend
          // ships a Spanish, remisión-listing message for
          // DISPATCH_ROUTE_STOP_NO_ADDRESS, so surfacing `e.message` already
          // gives a clear, actionable toast.
          this.toast.error(e?.message || 'Error al despachar la planilla');
        },
      });
  }

  openSettle(stop: DispatchRouteStop) {
    this.settleStop.set(stop);
  }

  openRelease(stop: DispatchRouteStop) {
    this.releaseStop.set(stop);
  }

  /**
   * A1 — Open the quick-view modal for a stop and fetch the full dispatch note
   * (which carries the delivery address; the stop's nested summary does not).
   * The modal renders the summary immediately and fills in the address once
   * the fetch resolves; a failed fetch keeps the modal open with the summary.
   */
  openStopDetail(stop: DispatchRouteStop) {
    this.detailStop.set(stop);
    this.detailNote.set(null);
    const id = stop.dispatch_note_id;
    if (!id) return;
    this.detailLoading.set(true);
    this.dispatchNotesService
      .getDispatchNote(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (note) => {
          this.detailNote.set(note);
          this.detailLoading.set(false);
        },
        error: () => {
          this.detailLoading.set(false);
        },
      });
  }

  closeStopDetail() {
    this.detailStop.set(null);
    this.detailNote.set(null);
    this.detailLoading.set(false);
  }

  goToDispatchNote(id: number) {
    this.closeStopDetail();
    this.router.navigate(['/admin/orders/dispatch-notes', id]);
  }

  openClose() {
    this.showCloseModal.set(true);
  }

  openVoid() {
    this.showVoidModal.set(true);
  }

  print() {
    this.showPdfViewer.set(true);
  }

  /** Download the route-sheet PDF as a file (blob → anchor download). */
  downloadPdf() {
    const r = this.route();
    if (!r || this.downloadingPdf()) return;
    this.downloadingPdf.set(true);
    this.service
      .downloadPdf(r.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.downloadingPdf.set(false);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `planilla-${r.route_number || r.id}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        },
        error: (e) => {
          this.downloadingPdf.set(false);
          this.toast.error(e.message);
        },
      });
  }

  /** Open the 3-step route-sheet scanner modal. */
  openScanner() {
    this.showScannerModal.set(true);
  }

  /** After a scan-confirm settlement, refresh the route to reflect new stops. */
  onScanConfirmed() {
    this.showScannerModal.set(false);
    this.load();
  }

  /** Routes the documental/AI options-dropdown actions to their handlers. */
  onDocumentalAction(action: string): void {
    switch (action) {
      case 'print':
        this.print();
        break;
      case 'download':
        this.downloadPdf();
        break;
      case 'scan':
        this.openScanner();
        break;
    }
  }

  back() {
    this.router.navigate(['/admin/orders/planillas']);
  }

  onSettle(event: SettleStopDto) {
    const stop = this.settleStop();
    if (!stop) return;
    this.actionLoading.set(true);
    this.service
      .settleStop(this.routeId(), stop.id, event)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.settleStop.set(null);
          this.toast.success('Parada liquidada');
          this.load();
        },
        error: (e) => {
          this.actionLoading.set(false);
          this.toast.error(e?.error?.message || e?.message || 'Error al liquidar la parada');
        },
      });
  }

  onRelease(event: ReleaseStopDto) {
    const stop = this.releaseStop();
    if (!stop) return;
    this.actionLoading.set(true);
    this.service
      .releaseStop(this.routeId(), stop.id, event)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.releaseStop.set(null);
          this.toast.success('Parada liberada');
          this.load();
        },
        error: (e) => {
          this.actionLoading.set(false);
          this.toast.error(e?.error?.message || e?.message || 'Error al liberar la parada');
        },
      });
  }

  onClose(event: CloseDispatchRouteDto) {
    this.actionLoading.set(true);
    this.service
      .close(this.routeId(), event)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.actionLoading.set(false);
          this.showCloseModal.set(false);
          this.route.set(r);
          this.toast.success('Planilla cerrada');
          this.load();
        },
        error: (e) => {
          this.actionLoading.set(false);
          this.toast.error(e?.error?.message || e?.message || 'Error al cerrar la planilla');
        },
      });
  }

  /**
   * Handles the void modal submit. The backend auto-releases any stops that are
   * still in non-terminal states (pending/in_progress) so the linked dispatch
   * notes can be reassigned to another planilla. Settled stops stay as-is
   * because their cash/AR movements have already hit the ledger.
   */
  onVoid(event: { reason: string; notes?: string }) {
    this.actionLoading.set(true);
    this.service
      .void(this.routeId(), event)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.actionLoading.set(false);
          this.showVoidModal.set(false);
          this.route.set(r);
          this.toast.success(`Planilla ${r.route_number} anulada`);
        },
        error: (e) => {
          this.actionLoading.set(false);
          this.toast.error(e?.error?.message || e?.message || 'Error al anular la planilla');
        },
      });
  }

  statusLabel(s: string): string {
    const map: Record<string, string> = {
      draft: 'Borrador',
      dispatched: 'Despachada',
      in_transit: 'En ruta',
      settling: 'Cuadrando',
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

  stopStatusClass(s: string): string {
    const map: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-700',
      in_progress: 'bg-blue-100 text-blue-700',
      delivered: 'bg-green-100 text-green-800',
      partial: 'bg-yellow-100 text-yellow-800',
      rejected: 'bg-red-100 text-red-800',
      released: 'bg-purple-100 text-purple-800',
    };
    return map[s] || 'bg-gray-100';
  }

  stopClass(stop: DispatchRouteStop): string {
    if (stop.status === 'delivered' || stop.status === 'partial') return 'border-l-4 border-l-green-500';
    if (stop.status === 'released' || stop.status === 'rejected') return 'border-l-4 border-l-red-500 opacity-70';
    return '';
  }

  /** A stop is settled (has a final result captured). */
  private isSettled(stop: DispatchRouteStop): boolean {
    return stop.result != null || stop.status === 'delivered' || stop.status === 'partial';
  }

  /** Recaudo status for the per-stop badge. */
  collectionState(stop: DispatchRouteStop): StopCollectionState {
    if (stop.is_prepaid) return 'prepaid';
    if (this.isSettled(stop) && Number(stop.collected_amount) > 0) return 'collected';
    if (this.needsCollection(stop)) return 'pending_cod';
    return 'none';
  }

  /** Human-readable label for the recaudo badge. */
  collectionStateLabel(state: StopCollectionState): string {
    const map: Record<StopCollectionState, string> = {
      prepaid: 'PREPAGADO',
      collected: 'RECAUDADO',
      pending_cod: 'PENDIENTE COD',
      none: '—',
    };
    return map[state] ?? '—';
  }

  /** Currency formatter for data-view transforms (accepts string/number). */
  formatMoney(value: any): string {
    const num = typeof value === 'string' ? parseFloat(value) : value || 0;
    return this.currencyService.format(Number(num) || 0);
  }

  // ---------------------------------------------------------------------------
  // Delivery address (Bug 3 + Bug 6)
  // ---------------------------------------------------------------------------

  /**
   * Resolves the delivery-address JSON for a stop: the note's `customer_address`
   * snapshot first, then the linked order's `shipping_address_snapshot`
   * fallback (legacy remisiones). Returns null when neither is present.
   */
  private resolveStopAddress(stop: DispatchRouteStop): DispatchDeliveryAddress | null {
    const note = stop.dispatch_note;
    return note?.customer_address ?? note?.order?.shipping_address_snapshot ?? null;
  }

  /**
   * A delivery address counts as present when its JSON blob carries a non-empty
   * `address_line1` (tolerating the legacy `line1`/`address` aliases). Mirrors
   * the backend `route-flow.service.jsonAddressHasLine` so the frontend gate and
   * the backend `DISPATCH_ROUTE_STOP_NO_ADDRESS` block stay in sync.
   */
  stopHasAddress(stop: DispatchRouteStop): boolean {
    const a = this.resolveStopAddress(stop);
    if (!a) return false;
    const line1 = a.address_line1 ?? a.line1 ?? a.address;
    return typeof line1 === 'string' && line1.trim().length > 0;
  }

  /**
   * Formats the resolved stop address into a single human-readable line:
   * `address_line1, city, state_province` (empty parts omitted). Falls back to
   * "—" when there is no usable address.
   */
  formatStopAddress(stop: DispatchRouteStop): string {
    const a = this.resolveStopAddress(stop);
    if (!a) return '—';
    const parts = [
      a.address_line1 ?? a.line1 ?? a.address,
      a.city,
      a.state_province,
    ]
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0);
    return parts.length > 0 ? parts.join(', ') : '—';
  }

  /**
   * Stops (in the order they appear) that have NO usable delivery address. The
   * backend rejects the dispatch with `DISPATCH_ROUTE_STOP_NO_ADDRESS` when this
   * list is non-empty, so the UI mirrors the rule: it disables the "Despachar"
   * button and surfaces which remisiones are missing an address. Released /
   * rejected stops are excluded — they won't be delivered, so they can't block.
   */
  readonly stopsWithoutAddress = computed<DispatchRouteStop[]>(() => {
    const stops = this.route()?.stops ?? [];
    return stops.filter(
      (s) =>
        s.status !== 'released' &&
        s.status !== 'rejected' &&
        !this.stopHasAddress(s),
    );
  });

  /** Comma-joined remisión numbers of the stops missing a delivery address. */
  readonly stopsWithoutAddressLabel = computed<string>(() =>
    this.stopsWithoutAddress()
      .map((s) => s.dispatch_note?.dispatch_number || `#${s.dispatch_note_id}`)
      .join(', '),
  );

  /**
   * Whether the route can be dispatched from the UI. Only blocks while the route
   * is still in `draft` (the only state with a "Despachar" action) and at least
   * one deliverable stop lacks an address — matching the backend gate.
   */
  readonly canDispatch = computed<boolean>(() => {
    const r = this.route();
    if (!r || r.status !== 'draft') return true;
    return this.stopsWithoutAddress().length === 0;
  });

  /**
   * Whether the stop still requires cash collection. Prefers a backend-provided
   * `needs_collection` flag if present; otherwise derives it: not prepaid and
   * not yet settled.
   */
  private needsCollection(stop: DispatchRouteStop): boolean {
    if (stop.needs_collection != null) return stop.needs_collection;
    return !stop.is_prepaid && !this.isSettled(stop) && stop.status !== 'released' && stop.status !== 'rejected';
  }

  /** Amount still to collect for a pending COD stop. */
  amountToCollect(stop: DispatchRouteStop): number {
    if (!this.needsCollection(stop)) return 0;
    return Number(stop.dispatch_note?.grand_total || 0);
  }

  /** Show the "Orden pendiente de pago" chip for COD stops backed by a sales order. */
  showPendingOrderChip(stop: DispatchRouteStop): boolean {
    const order = stop.dispatch_note?.sales_order;
    const hasOrder = !!order || stop.dispatch_note?.sales_order_id != null;
    return hasOrder && !stop.is_prepaid && this.needsCollection(stop);
  }

  /** Stop is in an active route and not yet finalized → can be settled/released. */
  canActOnStop(routeStatus: string, stopStatus: string): boolean {
    return (
      ['dispatched', 'in_transit', 'settling'].includes(routeStatus) &&
      !['delivered', 'released', 'rejected', 'partial'].includes(stopStatus)
    );
  }
}
