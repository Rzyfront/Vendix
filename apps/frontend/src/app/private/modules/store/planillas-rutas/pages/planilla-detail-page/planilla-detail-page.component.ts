import {
  Component,
  DestroyRef,
  EffectRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import {
  CardComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
} from '../../../../../../shared/components/index';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { StopSettleModalComponent } from '../../components/stop-settle-modal/stop-settle-modal.component';
import { StopReleaseModalComponent } from '../../components/stop-release-modal/stop-release-modal.component';
import { PlanillaCloseModalComponent } from '../../components/planilla-close-modal/planilla-close-modal.component';
import { PlanillaPdfViewerComponent } from '../../components/planilla-pdf-viewer/planilla-pdf-viewer.component';
import { VoidDispatchRouteModalComponent } from '../../components/void-dispatch-route-modal/void-dispatch-route-modal.component';
import { RouteSheetScannerModalComponent } from '../../components/route-sheet-scanner-modal/route-sheet-scanner-modal.component';
import {
  CloseDispatchRouteDto,
  DispatchRoute,
  DispatchRouteStatus,
  DispatchRouteStop,
  ReleaseStopDto,
  SettleStopDto,
} from '../../interfaces/planilla.interface';

/** Recaudo (collection) status surfaced per stop on the detail page. */
type StopCollectionState = 'prepaid' | 'collected' | 'pending_cod' | 'none';

/** One node in the route status mini-stepper. */
interface RouteStepperNode {
  status: DispatchRouteStatus;
  label: string;
  icon: string;
  state: 'done' | 'current' | 'upcoming';
}

@Component({
  selector: 'app-planilla-detail-page',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StickyHeaderComponent,
    IconComponent,
    CurrencyPipe,
    StopSettleModalComponent,
    StopReleaseModalComponent,
    PlanillaCloseModalComponent,
    PlanillaPdfViewerComponent,
    RouteSheetScannerModalComponent,
    VoidDispatchRouteModalComponent,
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
            <app-card [padding]="true">
              <div class="flex items-center justify-between gap-1 overflow-x-auto">
                @for (node of stepperNodes(); track node.status; let last = $last) {
                  <div class="flex items-center gap-1 flex-shrink-0">
                    <div class="flex flex-col items-center gap-1 min-w-[64px]">
                      <div
                        class="flex h-9 w-9 items-center justify-center rounded-full border-2"
                        [class]="stepperNodeClass(node.state)"
                      >
                        <app-icon [name]="node.icon" [size]="16"></app-icon>
                      </div>
                      <span
                        class="text-[10px] text-center leading-tight"
                        [class.font-semibold]="node.state === 'current'"
                        [class.text-text-secondary]="node.state === 'upcoming'"
                      >
                        {{ node.label }}
                      </span>
                    </div>
                    @if (!last) {
                      <div
                        class="h-0.5 w-6 md:w-10 rounded-full"
                        [class.bg-primary-600]="node.state === 'done'"
                        [class.bg-border]="node.state !== 'done'"
                      ></div>
                    }
                  </div>
                }
              </div>
            </app-card>
          }

          <!-- Summary -->
          <app-card [padding]="true">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <div class="text-xs text-text-secondary">Conductor</div>
                <div class="font-medium">
                  @if (r.driver_user) {
                    {{ r.driver_user.first_name }} {{ r.driver_user.last_name }}
                  } @else if (r.external_driver_name) {
                    {{ r.external_driver_name }} <span class="text-xs">(ext.)</span>
                  } @else {
                    —
                  }
                </div>
              </div>
              <div>
                <div class="text-xs text-text-secondary">Vehículo</div>
                <div class="font-medium">{{ r.vehicle?.plate || '—' }}</div>
              </div>
              <div>
                <div class="text-xs text-text-secondary">Total a recaudar</div>
                <div class="font-bold text-lg">
                  {{ +r.total_to_collect | currency }}
                </div>
              </div>
              <div>
                <div class="text-xs text-text-secondary">Recaudado</div>
                <div class="font-bold text-lg text-green-600">
                  {{ totalCollectedLive(r) | currency }}
                </div>
                @if (pendingCollectionLive(r) > 0) {
                  <div class="text-xs text-amber-700">
                    A cobrar: {{ pendingCollectionLive(r) | currency }}
                  </div>
                }
              </div>
            </div>

            <div class="text-xs text-text-secondary mt-3">
              {{ r.planned_date | date: 'dd MMM yyyy, HH:mm' }}
            </div>
          </app-card>

          <!-- Closure analysis (only when route is closed) -->
          @if (r.status === 'closed') {
            <app-card [padding]="true">
              <div class="flex items-center gap-2 mb-3">
                <app-icon name="check-circle" [size]="18" class="text-green-600"></app-icon>
                <h2 class="text-lg font-semibold">Análisis de cierre</h2>
              </div>

              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <div class="text-xs text-text-secondary">Total por recaudar</div>
                  <div class="font-bold">{{ +r.total_to_collect | currency }}</div>
                </div>
                <div>
                  <div class="text-xs text-text-secondary">Total recaudado</div>
                  <div class="font-bold text-green-600">
                    {{ totalCollectedLive(r) | currency }}
                  </div>
                </div>
                <div>
                  <div class="text-xs text-text-secondary">A crédito</div>
                  <div class="font-bold text-yellow-600">{{ +r.total_credit | currency }}</div>
                </div>
                <div>
                  <div class="text-xs text-text-secondary">Retenciones</div>
                  <div class="font-bold">{{ +r.total_withholdings | currency }}</div>
                </div>
              </div>

              @if (r.declared_cash != null) {
                <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div class="text-xs text-text-secondary">Efectivo declarado</div>
                    <div class="font-bold">{{ +r.declared_cash | currency }}</div>
                  </div>
                  <div>
                    <div class="text-xs text-text-secondary">Cambios/devoluciones</div>
                    <div class="font-bold">{{ +r.total_changes | currency }}</div>
                  </div>
                </div>
              }

              @if (r.cash_variance != null) {
                <div class="mt-3 p-3 rounded-md flex items-center gap-2" [class]="varianceClass()">
                  <app-icon [name]="varianceIcon()" [size]="18"></app-icon>
                  <div>
                    <strong>Diferencia de caja:</strong>
                    {{ +r.cash_variance | currency }}
                    <span class="font-semibold">{{ varianceLabel() }}</span>
                  </div>
                </div>
              }
            </app-card>
          }

          <!-- Stops -->
          <app-card [padding]="true">
            <h2 class="text-lg font-semibold mb-3">
              Paradas ({{ r.stops?.length || 0 }})
            </h2>
            <div class="space-y-2">
              @for (stop of r.stops; track stop.id) {
                <div
                  class="rounded-lg border border-border bg-card p-3"
                  [class]="stopClass(stop)"
                >
                  <div class="flex justify-between items-start gap-2 flex-wrap">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-xs font-mono bg-muted px-2 py-0.5 rounded">#{{ stop.stop_sequence }}</span>
                        <span class="font-mono text-sm">{{ stop.dispatch_note?.dispatch_number }}</span>
                        <!-- Collection status badge -->
                        @switch (collectionState(stop)) {
                          @case ('prepaid') {
                            <span class="inline-flex items-center gap-1 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                              <app-icon name="check-circle" [size]="12"></app-icon>
                              PREPAGADO
                            </span>
                          }
                          @case ('collected') {
                            <span class="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                              <app-icon name="banknote" [size]="12"></app-icon>
                              RECAUDADO
                            </span>
                          }
                          @case ('pending_cod') {
                            <span class="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                              <app-icon name="wallet" [size]="12"></app-icon>
                              PENDIENTE COD
                            </span>
                          }
                        }
                        <!-- Pending-payment order chip -->
                        @if (showPendingOrderChip(stop)) {
                          <span class="inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full">
                            <app-icon name="credit-card" [size]="12"></app-icon>
                            Orden pendiente de pago
                          </span>
                        }
                      </div>
                      <div class="text-sm text-text-secondary mt-1">
                        {{ stop.dispatch_note?.customer_name || '(Cliente)' }}
                      </div>
                      <div class="text-sm font-semibold mt-1">
                        {{ +(stop.dispatch_note?.grand_total || 0) | currency }}
                      </div>
                      <!-- "A cobrar" amount when collection is pending -->
                      @if (amountToCollect(stop); as toCollect) {
                        @if (toCollect > 0) {
                          <div class="text-sm mt-1">
                            <span class="text-text-secondary">A cobrar:</span>
                            <strong class="text-amber-700">{{ toCollect | currency }}</strong>
                          </div>
                        }
                      }
                    </div>
                    <span class="text-xs px-2 py-1 rounded-full" [class]="stopStatusClass(stop.status)">
                      {{ stopStatusLabel(stop.status) }}
                    </span>
                  </div>

                  @if (+stop.collected_amount || +stop.withholding_amount || +stop.credit_amount) {
                    <div class="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      @if (+stop.collected_amount > 0) {
                        <div>
                          <span class="text-text-secondary">Recaudado:</span>
                          <strong class="text-green-600">
                            {{ +stop.collected_amount | currency }}
                          </strong>
                        </div>
                      }
                      @if (+stop.withholding_amount > 0) {
                        <div>
                          <span class="text-text-secondary">Retención:</span>
                          <strong>{{ +stop.withholding_amount | currency }}</strong>
                        </div>
                      }
                      @if (+stop.credit_amount > 0) {
                        <div>
                          <span class="text-text-secondary">A crédito:</span>
                          <strong class="text-yellow-600">
                            {{ +stop.credit_amount | currency }}
                          </strong>
                        </div>
                      }
                      @if (+stop.change_amount > 0) {
                        <div>
                          <span class="text-text-secondary">Cambio:</span>
                          <strong>{{ +stop.change_amount | currency }}</strong>
                        </div>
                      }
                    </div>
                  }

                  <!-- Actions per stop (only in active routes) -->
                  @if (canActOnStop(r.status, stop.status)) {
                    <div class="mt-3 flex gap-2 flex-wrap">
                      <button
                        type="button"
                        (click)="openSettle(stop)"
                        class="rounded-md bg-primary-600 text-white px-3 py-1.5 text-xs font-medium"
                      >Liquidar</button>
                      <button
                        type="button"
                        (click)="openRelease(stop)"
                        class="rounded-md border border-border bg-surface px-3 py-1.5 text-xs"
                      >Liberar</button>
                    </div>
                  }
                </div>
              }
            </div>
          </app-card>
        }
      </div>
    </div>

    @if (settleStop()) {
      <app-stop-settle-modal
        [stop]="settleStop()!"
        [grandTotal]="+(settleStop()!.dispatch_note?.grand_total || 0)"
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
  `,
})
export class PlanillaDetailPageComponent {
  /** Route param `id`, bound via withComponentInputBinding (zoneless signal input). */
  readonly id = input.required<string>();

  private readonly service = inject(PlanillasRutasService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

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

  /** Linear status order for the route mini-stepper (voided is terminal/off-flow). */
  private readonly STEPPER_FLOW: ReadonlyArray<{ status: DispatchRouteStatus; label: string; icon: string }> = [
    { status: 'draft', label: 'Borrador', icon: 'package' },
    { status: 'dispatched', label: 'Despachada', icon: 'truck' },
    { status: 'in_transit', label: 'En ruta', icon: 'send' },
    { status: 'settling', label: 'Cuadrando', icon: 'wallet' },
    { status: 'closed', label: 'Cerrada', icon: 'check-circle' },
  ];

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
      actions.push({
        id: 'dispatch',
        label: 'Despachar',
        variant: 'primary',
        icon: 'truck',
        loading: busy,
        disabled: busy,
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

    actions.push({
      id: 'print',
      label: 'Imprimir PDF',
      variant: 'outline',
      icon: 'printer',
      disabled: busy,
    });

    actions.push({
      id: 'download-pdf',
      label: 'Descargar planilla (PDF)',
      variant: 'outline',
      icon: 'download',
      loading: this.downloadingPdf(),
      disabled: busy || this.downloadingPdf(),
    });

    // The scanned-sheet closure shortcut only makes sense while the route is
    // active (dispatched / in_transit / settling): a closed/draft/voided route
    // has nothing to settle from a scan. Additionally, we require at least
    // one PENDING/IN_PROGRESS stop to be settled from the scan — otherwise
    // the modal would open for an already-settled route.
    if (['dispatched', 'in_transit', 'settling'].includes(r.status)) {
      const hasOpenStop = r.stops?.some(
        (s: any) => s.status === 'pending' || s.status === 'in_progress',
      );
      actions.push({
        id: 'scan-sheet',
        label: 'Cargar planilla escaneada',
        variant: 'outline',
        icon: 'scan-line',
        // Disabled when the route is empty (no stops at all) or fully settled
        // (no pending/in_progress stops) — the scan would be a no-op.
        disabled: busy || !hasOpenStop,
        title: !hasOpenStop
          ? 'Todas las paradas ya están liquidadas o liberadas.'
          : undefined,
      });
    }

    return actions;
  });

  readonly stepperNodes = computed<RouteStepperNode[]>(() => {
    const status = this.route()?.status;
    if (!status) return [];
    const currentIndex = this.STEPPER_FLOW.findIndex((n) => n.status === status);
    return this.STEPPER_FLOW.map((node, index) => {
      let state: RouteStepperNode['state'] = 'upcoming';
      if (currentIndex >= 0) {
        if (index < currentIndex) state = 'done';
        else if (index === currentIndex) state = 'current';
      }
      return { ...node, state };
    });
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

  private routeIdEffect: EffectRef;

  constructor() {
    // Bridge the route-param signal input into the numeric routeId signal.
    effect(() => {
      const parsed = parseInt(this.id(), 10);
      if (!isNaN(parsed)) this.routeId.set(parsed);
    });
    this.routeIdEffect = effect(() => {
      const id = this.routeId();
      if (id > 0) this.load();
    });
  }

  ngOnDestroy() {
    this.routeIdEffect?.destroy();
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
      case 'print':
        this.print();
        break;
      case 'download-pdf':
        this.downloadPdf();
        break;
      case 'scan-sheet':
        this.openScanner();
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
          this.toast.error(e.message);
        },
      });
  }

  openSettle(stop: DispatchRouteStop) {
    this.settleStop.set(stop);
  }

  openRelease(stop: DispatchRouteStop) {
    this.releaseStop.set(stop);
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

  stepperNodeClass(state: RouteStepperNode['state']): string {
    switch (state) {
      case 'done':
        return 'bg-primary-600 border-primary-600 text-white';
      case 'current':
        return 'border-primary-600 text-primary-600 bg-primary-50';
      default:
        return 'border-border text-text-secondary bg-surface';
    }
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
