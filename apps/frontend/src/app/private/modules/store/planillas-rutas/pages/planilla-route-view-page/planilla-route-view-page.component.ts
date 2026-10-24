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
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { RouteTrackingService, RouteTrackingWatch } from '../../services/route-tracking.service';
import { RoutePositionPublisherService } from '../../services/route-position-publisher.service';
import { RouteOptimizerService, GeoStop } from '../../services/route-optimizer.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import {
  MapViewComponent,
  MapMarker,
  LatLng,
} from '../../../../../../shared/components/map-view/map-view.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { DispatchNotesService } from '../../../dispatch-notes/services/dispatch-notes.service';
import { DispatchNote } from '../../../dispatch-notes/interfaces/dispatch-note.interface';
import { StopSettleModalComponent } from '../../components/stop-settle-modal/stop-settle-modal.component';
import { StopReleaseModalComponent } from '../../components/stop-release-modal/stop-release-modal.component';
import { StopDetailModalComponent } from '../../components/stop-detail-modal/stop-detail-modal.component';
import {
  DispatchDeliveryAddress,
  DispatchRoute,
  DispatchRouteStop,
  MapStop,
  MapStopsResponse,
  ReleaseStopDto,
  SettleStopDto,
} from '../../interfaces/planilla.interface';
import {
  RoutePosition,
  RouteTrackingSnapshot,
} from '../../interfaces/route-tracking.interface';

const NEXT_COLOR = '#7c3aed';
const SELECTED_COLOR = '#0284c7';
const LIVE_THRESHOLD_S = 90;

const STOP_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pendiente', cls: 'bg-gray-100 text-gray-700' },
  in_progress: { label: 'En curso', cls: 'bg-blue-100 text-blue-700' },
  delivered: { label: 'Entregada', cls: 'bg-green-100 text-green-700' },
  partial: { label: 'Parcial', cls: 'bg-yellow-100 text-yellow-800' },
  rejected: { label: 'Rechazada', cls: 'bg-red-100 text-red-700' },
  released: { label: 'Liberada', cls: 'bg-purple-100 text-purple-700' },
};

const ROUTE_STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  dispatched: 'Despachada',
  in_transit: 'En tránsito',
  closed: 'Cerrada',
  voided: 'Anulada',
};

/**
 * Full "recorrido" view of a dispatch route: map + stop list (+ fullscreen),
 * live tracking of the responsible (spectators never use geolocation).
 */
@Component({
  selector: 'app-planilla-route-view-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    IconComponent,
    ButtonComponent,
    MapViewComponent,
    CurrencyPipe,
    StopSettleModalComponent,
    StopReleaseModalComponent,
    StopDetailModalComponent,
  ],
  host: {
    class: 'block',
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    <!-- Reusable stop list (desktop column and fullscreen floating panel) -->
    <ng-template #stopsList>
      <div class="flex min-h-0 flex-1 flex-col gap-3">
        <div class="grid shrink-0 grid-cols-3 gap-2 text-center">
          <div class="rounded-lg border border-border bg-surface px-2 py-1.5">
            <p class="text-[10px] uppercase tracking-wide text-text-secondary">Entregadas</p>
            <p class="text-sm font-semibold text-text-primary">{{ deliveredCount() }}/{{ rows().length }}</p>
          </div>
          <div class="rounded-lg border border-border bg-surface px-2 py-1.5">
            <p class="text-[10px] uppercase tracking-wide text-text-secondary">Por cobrar</p>
            <p class="truncate text-sm font-semibold text-text-primary">{{ toCollectTotal() | currency }}</p>
          </div>
          <div class="rounded-lg border border-border bg-surface px-2 py-1.5">
            <p class="text-[10px] uppercase tracking-wide text-text-secondary">Recaudado</p>
            <p class="truncate text-sm font-semibold text-text-primary">{{ collectedTotal() | currency }}</p>
          </div>
        </div>

        @if (canReorder()) {
          <div class="shrink-0">
            @if (confirmingOptimal()) {
              <div class="space-y-2 rounded-lg border border-border bg-surface p-2 text-xs text-text-secondary">
                <p>¿Aplicar el orden óptimo a {{ optimizedPending().length }} paradas pendientes? Esto reordenará las paradas.</p>
                <div class="flex justify-end gap-2">
                  <app-button variant="outline" size="sm" [disabled]="reordering()" (clicked)="confirmingOptimal.set(false)">Cancelar</app-button>
                  <app-button variant="primary" size="sm" [loading]="reordering()" (clicked)="applyOptimalOrder()">Confirmar orden</app-button>
                </div>
              </div>
            } @else {
              <app-button
                variant="outline"
                size="sm"
                [disabled]="optimizedPending().length < 2 || reordering()"
                (clicked)="confirmingOptimal.set(true)"
              >
                <app-icon slot="icon" name="navigation" [size]="16"></app-icon>
                Aplicar orden óptimo
              </app-button>
            }
          </div>
        }

        <ul class="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          @for (row of rows(); track row.stop.id; let i = $index; let first = $first; let last = $last) {
            <li
              class="cursor-pointer rounded-xl border bg-surface p-3 transition-colors"
              [class.border-primary-500]="selectedStopId() === row.stop.id"
              [class.ring-1]="selectedStopId() === row.stop.id"
              [class.ring-primary-500]="selectedStopId() === row.stop.id"
              [class.border-border]="selectedStopId() !== row.stop.id"
              (click)="selectStop(row.stop.id)"
            >
              <div class="flex items-start gap-3">
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white"
                >{{ row.stop.stop_sequence }}</span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="truncate text-sm font-semibold text-text-primary">{{ row.customer }}</span>
                    <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase" [class]="row.badge.cls">{{ row.badge.label }}</span>
                    @if (row.isNext) {
                      <span class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white" [style.background]="nextColor">Próxima</span>
                    }
                  </div>
                  <p class="mt-0.5 truncate text-xs text-text-secondary">{{ row.address }}</p>
                  @if (row.toCollect > 0) {
                    <p class="mt-0.5 text-xs font-medium text-text-primary">Por cobrar: {{ row.toCollect | currency }}</p>
                  } @else if (row.total > 0) {
                    <p class="mt-0.5 text-xs text-text-secondary">Total: {{ row.total | currency }}</p>
                  }
                </div>
                @if (canReorder()) {
                  <div class="flex shrink-0 flex-col">
                    <button type="button" class="rounded p-0.5 text-text-secondary hover:bg-gray-100 disabled:opacity-30" [disabled]="first || reordering()" (click)="$event.stopPropagation(); move(i, -1)" aria-label="Subir parada">
                      <app-icon name="arrow-up" [size]="14"></app-icon>
                    </button>
                    <button type="button" class="rounded p-0.5 text-text-secondary hover:bg-gray-100 disabled:opacity-30" [disabled]="last || reordering()" (click)="$event.stopPropagation(); move(i, 1)" aria-label="Bajar parada">
                      <app-icon name="arrow-down" [size]="14"></app-icon>
                    </button>
                  </div>
                }
              </div>
              <div class="mt-2 flex flex-wrap justify-end gap-1.5">
                <button type="button" class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-primary hover:bg-gray-50" (click)="$event.stopPropagation(); openDetail(row.stop)">
                  <app-icon name="eye" [size]="12"></app-icon> Ver detalle
                </button>
                @if (row.canAct) {
                  @if (row.stop.status === 'pending') {
                    <button type="button" class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-primary hover:bg-gray-50 disabled:opacity-50" [disabled]="actionLoading()" (click)="$event.stopPropagation(); startStop(row.stop)">
                      <app-icon name="play" [size]="12"></app-icon> Iniciar
                    </button>
                  }
                  <button type="button" class="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2 py-1 text-xs font-medium text-white hover:bg-primary-700" (click)="$event.stopPropagation(); settleStop.set(row.stop)">
                    <app-icon name="wallet" [size]="12"></app-icon> Liquidar
                  </button>
                  <button type="button" class="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50" (click)="$event.stopPropagation(); releaseStop.set(row.stop)">
                    <app-icon name="x-circle" [size]="12"></app-icon> Liberar
                  </button>
                }
              </div>
            </li>
          } @empty {
            <li class="py-6 text-center text-sm text-text-secondary">Esta ruta no tiene paradas.</li>
          }
        </ul>
      </div>
    </ng-template>

    @if (loading()) {
      <div class="flex items-center justify-center gap-2 py-12 text-text-secondary">
        <app-icon name="loader-2" [size]="18" [spin]="true"></app-icon>
        <span class="text-sm">Cargando recorrido…</span>
      </div>
    } @else if (error()) {
      <div class="m-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <app-icon name="alert-triangle" [size]="18" class="mt-0.5 shrink-0 text-red-600"></app-icon>
        <div>
          <p class="font-semibold">No se pudo cargar la ruta</p>
          <p class="mt-0.5">{{ error() }}</p>
          <button type="button" class="mt-2 text-xs font-semibold underline" (click)="backToDetail()">Volver al detalle</button>
        </div>
      </div>
    } @else if (route(); as r) {
      <div class="flex flex-col gap-3 p-3 md:p-4 lg:h-[calc(100dvh-6rem)]">
        <!-- Header -->
        <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" class="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary hover:bg-gray-50" (click)="backToDetail()">
            <app-icon name="arrow-left" [size]="16"></app-icon>
            <span>Detalle</span>
          </button>
          <h1 class="text-base font-bold text-text-primary">Ruta {{ r.route_number }}</h1>
          <span class="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700">{{ routeStatusLabel() }}</span>
          <span class="text-sm text-text-secondary">Encargado: <span class="font-medium text-text-primary">{{ responsibleLabel() }}</span></span>

          <span
            class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
            [class]="chip().cls"
          >
            <app-icon [name]="chip().icon" [size]="12"></app-icon>
            {{ chip().text }}
          </span>

          <div class="ml-auto flex flex-wrap items-center gap-2">
            @if (r.status === 'draft') {
              <div class="flex flex-col items-end">
                <app-button variant="primary" size="sm" [loading]="actionLoading()" [disabled]="!canDispatchNow()" (clicked)="dispatch()">
                  <app-icon slot="icon" name="send" [size]="16"></app-icon>
                  Despachar
                </app-button>
                @if (dispatchBlockedText(); as txt) {
                  <span class="mt-1 text-xs text-text-secondary">{{ txt }}</span>
                }
              </div>
            }
            <app-button variant="outline" size="sm" (clicked)="enterFullscreen()">
              <app-icon slot="icon" name="maximize" [size]="16"></app-icon>
              Pantalla completa
            </app-button>
          </div>
        </div>

        @if (isResponsible() && inProgress() && (publisher.state() === 'denied' || publisher.state() === 'unavailable')) {
          <div class="flex shrink-0 items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            <app-icon name="alert-triangle" [size]="18" class="mt-0.5 shrink-0 text-amber-600"></app-icon>
            <p>
              @if (publisher.state() === 'denied') {
                Activa el permiso de ubicación del navegador para que tu equipo vea tu recorrido.
              } @else {
                Este dispositivo o navegador no permite obtener tu ubicación (requiere HTTPS y GPS). Tu equipo no verá tu recorrido.
              }
            </p>
          </div>
        }

        <!-- Map + stops -->
        <div class="grid min-h-0 gap-4 lg:flex-1 lg:grid-cols-12">
          <div
            [class]="fullscreen() ? 'fixed inset-0 z-[60] bg-surface' : 'relative h-[45vh] min-h-0 overflow-hidden rounded-xl border border-border lg:col-span-8 lg:h-full'"
          >
            <div class="h-full min-h-0">
              <app-map-view
                class="block h-full"
                [markers]="markers()"
                [route]="routeLine()"
                [completedRoute]="completedLine()"
                [origin]="origin()"
                [userLocation]="userLocation()"
                [fill]="true"
                [readonly]="true"
                (markerClick)="onMarkerClick($event)"
              ></app-map-view>
            </div>

            @if (fullscreen()) {
              <button type="button" class="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-2 text-sm font-medium text-text-primary shadow-lg" (click)="exitFullscreen()" aria-label="Salir de pantalla completa">
                <app-icon name="minimize" [size]="16"></app-icon> Salir
              </button>

              @if (panelCollapsed()) {
                <button type="button" class="absolute inset-x-3 bottom-3 z-10 flex items-center justify-between gap-2 rounded-2xl bg-surface px-4 py-3 text-left shadow-xl lg:inset-x-auto lg:bottom-auto lg:right-4 lg:top-4 lg:w-[360px]" (click)="panelCollapsed.set(false)">
                  <span class="min-w-0 truncate text-sm font-semibold text-text-primary">
                    {{ rows().length }} paradas
                    @if (nextRow(); as n) {
                      <span class="font-normal text-text-secondary"> · próxima: {{ n.customer }}</span>
                    }
                  </span>
                  <app-icon name="chevron-up" [size]="18"></app-icon>
                </button>
              } @else {
                <div class="absolute inset-x-0 bottom-0 z-10 flex max-h-[55vh] flex-col gap-2 rounded-t-2xl bg-surface p-3 shadow-2xl lg:inset-x-auto lg:bottom-4 lg:right-16 lg:top-4 lg:max-h-none lg:w-[360px] lg:rounded-2xl">
                  <button type="button" class="flex shrink-0 items-center justify-between text-sm font-semibold text-text-primary" (click)="panelCollapsed.set(true)" aria-label="Colapsar paradas">
                    <span>Paradas ({{ rows().length }})</span>
                    <app-icon name="chevron-down" [size]="18"></app-icon>
                  </button>
                  <ng-container [ngTemplateOutlet]="stopsList"></ng-container>
                </div>
              }
            }
          </div>

          @if (!fullscreen()) {
            <div class="flex min-h-0 flex-col lg:col-span-4 lg:overflow-hidden">
              <ng-container [ngTemplateOutlet]="stopsList"></ng-container>
            </div>
          }
        </div>
      </div>
    }

    @if (settleStop(); as s) {
      <app-stop-settle-modal
        [stop]="s"
        [grandTotal]="+(s.dispatch_note?.grand_total || 0)"
        [isPrepaid]="!!s.is_prepaid"
        (close)="settleStop.set(null)"
        (submitted)="onSettle($event)"
      ></app-stop-settle-modal>
    }
    @if (releaseStop(); as s) {
      <app-stop-release-modal
        [stop]="s"
        (close)="releaseStop.set(null)"
        (submitted)="onRelease($event)"
      ></app-stop-release-modal>
    }
    @if (detailStop(); as s) {
      <app-stop-detail-modal
        [stop]="s"
        [note]="detailNote()"
        [loading]="detailLoading()"
        (close)="closeDetail()"
        (goToNote)="goToNote($event)"
        (refresh)="reloadAll()"
      ></app-stop-detail-modal>
    }
  `,
})
export class PlanillaRouteViewPageComponent {
  private readonly service = inject(PlanillasRutasService);
  private readonly trackingService = inject(RouteTrackingService);
  private readonly optimizer = inject(RouteOptimizerService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authFacade = inject(AuthFacade);
  private readonly dispatchNotes = inject(DispatchNotesService);
  readonly publisher = inject(RoutePositionPublisherService);

  readonly nextColor = NEXT_COLOR;

  readonly routeId = signal(0);
  readonly route = signal<DispatchRoute | null>(null);
  readonly mapData = signal<MapStopsResponse | null>(null);
  readonly tracking = signal<RouteTrackingSnapshot | null>(null);
  readonly livePosition = signal<RoutePosition | null>(null);
  readonly trail = signal<RoutePosition[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly actionLoading = signal(false);
  readonly reordering = signal(false);
  readonly confirmingOptimal = signal(false);
  readonly selectedStopId = signal<number | null>(null);
  readonly fullscreen = signal(false);
  readonly panelCollapsed = signal(false);
  /** Bumped to hand map-view a fresh markers array (forces map.resize()). */
  private readonly resizeTick = signal(0);
  /** Clock refreshed every 5 s for the "hace Xs" label. */
  private readonly now = signal(Date.now());

  readonly settleStop = signal<DispatchRouteStop | null>(null);
  readonly releaseStop = signal<DispatchRouteStop | null>(null);
  readonly detailStop = signal<DispatchRouteStop | null>(null);
  readonly detailNote = signal<DispatchNote | null>(null);
  readonly detailLoading = signal(false);

  private watchHandle: RouteTrackingWatch | null = null;

  // ---------------------------------------------------------------- derived

  private readonly currentUserId = this.authFacade.userId;

  readonly routeStatusLabel = computed(
    () => ROUTE_STATUS_LABEL[this.route()?.status ?? ''] ?? '',
  );

  readonly inProgress = computed(() => {
    const s = this.route()?.status;
    return s === 'dispatched' || s === 'in_transit';
  });

  /** D1: responsible user = driver_user_id when the primary driver is not external. */
  readonly responsibleUserId = computed<number | null>(() => {
    const r = this.route();
    if (!r || r.is_primary_driver_external || r.driver_user_id == null) return null;
    return r.driver_user_id;
  });

  readonly isResponsible = computed(() => {
    const id = this.responsibleUserId();
    return id != null && id === this.currentUserId();
  });

  readonly responsibleName = computed<string>(() => {
    const t = this.tracking()?.responsible?.name;
    if (t) return t;
    const u = this.route()?.driver_user;
    const name = [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim();
    return name || 'Usuario';
  });

  readonly responsibleLabel = computed<string>(() => {
    const r = this.route();
    if (!r) return '';
    if (this.responsibleUserId() != null) return this.responsibleName();
    const ext = r.external_driver_name?.trim();
    return ext ? `Externo: ${ext}` : 'Sin encargado';
  });

  readonly trackingEnabled = computed(() => this.responsibleUserId() != null);

  readonly chip = computed<{ text: string; cls: string; icon: any }>(() => {
    const neutral = 'border-border bg-surface text-text-secondary';
    if (!this.trackingEnabled()) {
      return { text: 'Sin rastreo (encargado externo)', cls: neutral, icon: 'x-circle' };
    }
    if (this.isResponsible() && this.inProgress()) {
      switch (this.publisher.state()) {
        case 'active':
          return { text: 'Compartiendo tu ubicación', cls: 'border-green-200 bg-green-50 text-green-700', icon: 'radio' };
        case 'requesting':
          return { text: 'Solicitando ubicación…', cls: neutral, icon: 'loader-2' };
        case 'paused':
          return { text: 'Rastreo en pausa', cls: 'border-amber-200 bg-amber-50 text-amber-700', icon: 'alert-triangle' };
        case 'denied':
          return { text: 'Ubicación bloqueada', cls: 'border-red-200 bg-red-50 text-red-700', icon: 'alert-triangle' };
        case 'unavailable':
          return { text: 'Ubicación no disponible', cls: 'border-red-200 bg-red-50 text-red-700', icon: 'alert-triangle' };
        default:
          break;
      }
    }
    const status = this.route()?.status;
    if (status === 'draft') return { text: 'El rastreo inicia al despachar', cls: neutral, icon: 'radio' };
    const pos = this.livePosition();
    if (pos) {
      const ageS = Math.max(0, Math.round((this.now() - new Date(pos.recorded_at).getTime()) / 1000));
      const ago = this.formatAge(ageS);
      if (this.inProgress() && ageS <= LIVE_THRESHOLD_S) {
        return { text: `En vivo · hace ${ago}`, cls: 'border-green-200 bg-green-50 text-green-700', icon: 'radio' };
      }
      return { text: `Última señal · hace ${ago}`, cls: neutral, icon: 'radio' };
    }
    return { text: 'Esperando ubicación del encargado', cls: neutral, icon: 'loader-2' };
  });

  readonly canDispatchNow = computed(() => this.dispatchBlockedText() === null);

  readonly dispatchBlockedText = computed<string | null>(() => {
    const id = this.responsibleUserId();
    if (id != null && id !== this.currentUserId()) {
      return `Solo ${this.responsibleName()} puede despachar esta ruta`;
    }
    return null;
  });

  readonly canReorder = computed(() => {
    const s = this.route()?.status;
    return s === 'draft' || s === 'dispatched';
  });

  private readonly sortedStops = computed<DispatchRouteStop[]>(() =>
    [...(this.route()?.stops ?? [])].sort((a, b) => a.stop_sequence - b.stop_sequence),
  );

  private readonly nextStopId = computed<number | null>(() => {
    if (!this.inProgress()) return null;
    const n = this.sortedStops().find((s) => s.status === 'pending' || s.status === 'in_progress');
    return n?.id ?? null;
  });

  readonly rows = computed(() => {
    const nextId = this.nextStopId();
    const canActRoute = this.inProgress();
    return this.sortedStops().map((stop) => {
      const terminal = ['delivered', 'released', 'rejected', 'partial'].includes(stop.status);
      const toCollect = this.amountToCollect(stop);
      return {
        stop,
        customer: stop.dispatch_note?.customer_name || '(Cliente)',
        address: this.formatAddress(stop),
        badge: STOP_BADGE[stop.status] ?? STOP_BADGE['pending'],
        total: Number(stop.dispatch_note?.grand_total || 0),
        toCollect,
        isNext: stop.id === nextId,
        canAct: canActRoute && !terminal,
      };
    });
  });

  readonly nextRow = computed(() => this.rows().find((r) => r.isNext) ?? null);

  readonly deliveredCount = computed(
    () => this.rows().filter((r) => r.stop.status === 'delivered' || r.stop.status === 'partial').length,
  );
  readonly toCollectTotal = computed(() => this.rows().reduce((a, r) => a + r.toCollect, 0));
  readonly collectedTotal = computed(() => Number(this.route()?.total_collected ?? 0));

  // -------------------------------------------------------------------- map

  readonly origin = computed<LatLng | null>(() => {
    const o = this.mapData()?.origin;
    return o ? { lat: o.lat, lng: o.lng } : null;
  });

  /** Position shown as the live dot: own GPS for the responsible, else tracked. */
  readonly userLocation = computed<LatLng | null>(() => {
    if (!this.trackingEnabled() || !this.inProgress()) return null;
    if (this.isResponsible()) {
      const own = this.publisher.lastLocal();
      if (own) return own;
    }
    const p = this.livePosition();
    return p ? { lat: p.lat, lng: p.lng } : null;
  });

  private readonly pendingGeo = computed<(GeoStop & { stop: MapStop })[]>(() =>
    (this.mapData()?.stops ?? []).map((s) => ({
      stopId: s.stopId,
      sequence: s.sequence,
      lat: s.lat,
      lng: s.lng,
      stop: s,
    })),
  );

  private readonly optimized = computed(() => {
    const start = this.userLocation() ?? this.origin();
    return this.optimizer.optimize(start, this.pendingGeo()).orderedStops as (GeoStop & {
      stop: MapStop;
    })[];
  });

  /** Located pending stops in optimized order (for "Aplicar orden óptimo"). */
  readonly optimizedPending = computed(() => this.optimized());

  readonly routeLine = computed<LatLng[]>(() => {
    const pts: LatLng[] = [];
    const start = this.userLocation() ?? this.origin();
    if (start) pts.push(start);
    for (const s of this.optimized()) pts.push({ lat: s.lat, lng: s.lng });
    return pts.length >= 2 ? pts : [];
  });

  readonly completedLine = computed<LatLng[]>(() => {
    const t = this.trail();
    if (t.length >= 2) return t.map((p) => ({ lat: p.lat, lng: p.lng }));
    return (this.mapData()?.delivered ?? []).map((s) => ({ lat: s.lat, lng: s.lng }));
  });

  /** Markers + the stop id each one represents (same order). */
  private readonly markerModel = computed(() => {
    this.resizeTick();
    const selected = this.selectedStopId();
    const nextId = this.nextStopId();
    const out: { marker: MapMarker; stopId: number }[] = [];
    for (const s of this.mapData()?.stops ?? []) {
      const color =
        s.stopId === selected ? SELECTED_COLOR : s.stopId === nextId ? NEXT_COLOR : undefined;
      out.push({
        stopId: s.stopId,
        marker: { lat: s.lat, lng: s.lng, label: String(s.sequence), color, state: s.status },
      });
    }
    for (const s of this.mapData()?.delivered ?? []) {
      out.push({
        stopId: s.stopId,
        marker: {
          lat: s.lat,
          lng: s.lng,
          label: '✓',
          color: s.stopId === selected ? SELECTED_COLOR : undefined,
          state: 'delivered',
        },
      });
    }
    return out;
  });

  readonly markers = computed<MapMarker[]>(() => this.markerModel().map((m) => m.marker));

  constructor() {
    const id = Number(this.activatedRoute.snapshot.paramMap.get('id'));
    this.routeId.set(id);

    const timer = setInterval(() => this.now.set(Date.now()), 5000);
    this.destroyRef.onDestroy(() => {
      clearInterval(timer);
      this.watchHandle?.close();
      this.watchHandle = null;
      // The publisher is NOT stopped here on purpose: the responsible keeps
      // sharing position while the route is in progress even if they leave
      // this page (it stops on 403/409 or when the route stops being active).
    });

    // Only the responsible, on an in-progress route, publishes position.
    effect(() => {
      const loaded = !!this.route();
      const run = this.isResponsible() && this.inProgress();
      untracked(() => {
        if (run) this.publisher.start(this.routeId());
        else if (loaded && this.publisher.currentRouteId === this.routeId()) {
          this.publisher.stop();
        }
      });
    });

    this.reloadAll(true);
  }

  // ------------------------------------------------------------------- load

  reloadAll(initial = false): void {
    if (initial) this.loading.set(true);
    this.service
      .getOne(this.routeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.route.set(r);
          this.loading.set(false);
          this.loadMap();
          if (initial) this.loadTracking(true);
        },
        error: (e: Error) => {
          this.loading.set(false);
          this.error.set(e?.message || 'Error al cargar la ruta');
        },
      });
  }

  private loadMap(): void {
    this.service
      .getMapStops(this.routeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (m) => this.mapData.set(m),
        error: () => this.mapData.set({ origin: null, stops: [], delivered: [], unlocated: [] }),
      });
  }

  private loadTracking(openChannel = false): void {
    this.trackingService
      .getTracking(this.routeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (t) => {
          this.applySnapshot(t);
          if (openChannel && t.tracking_enabled) this.openChannel();
        },
        error: () => {
          /* tracking is optional: the route view works without it */
        },
      });
  }

  private applySnapshot(t: RouteTrackingSnapshot): void {
    this.tracking.set(t);
    this.trail.set(t.trail ?? []);
    this.livePosition.set(t.last_position ?? null);
  }

  private openChannel(): void {
    if (this.watchHandle) return;
    // The responsible's own device already knows its position; it still listens
    // so the trail stays in sync, but never reads geolocation as a spectator.
    this.watchHandle = this.trackingService.watch(this.routeId(), {
      onPosition: (p) => {
        this.livePosition.set(p);
        this.trail.update((t) => [...t, p].slice(-500));
      },
      onSnapshot: (s) => this.applySnapshot(s),
    });
  }

  // ---------------------------------------------------------------- actions

  backToDetail(): void {
    this.router.navigate(['/admin/orders/planillas', this.routeId()]);
  }

  dispatch(): void {
    if (!this.canDispatchNow()) return;
    this.actionLoading.set(true);
    this.service
      .dispatch(this.routeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.actionLoading.set(false);
          this.route.set(r);
          this.toast.success('Ruta despachada');
          if (this.isResponsible()) this.publisher.start(this.routeId());
          this.loadMap();
          this.loadTracking(true);
        },
        error: (e: Error) => {
          this.actionLoading.set(false);
          this.toast.error(e?.message || 'Error al despachar la ruta');
        },
      });
  }

  startStop(stop: DispatchRouteStop): void {
    this.actionLoading.set(true);
    this.service
      .startStop(this.routeId(), stop.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.reloadAll();
        },
        error: (e: Error) => {
          this.actionLoading.set(false);
          this.toast.error(e?.message || 'Error al iniciar la parada');
        },
      });
  }

  onSettle(dto: SettleStopDto): void {
    const stop = this.settleStop();
    if (!stop) return;
    this.actionLoading.set(true);
    this.service
      .settleStop(this.routeId(), stop.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.settleStop.set(null);
          this.toast.success('Parada liquidada');
          this.reloadAll();
        },
        error: (e: Error) => {
          this.actionLoading.set(false);
          this.toast.error(e?.message || 'Error al liquidar la parada');
        },
      });
  }

  onRelease(dto: ReleaseStopDto): void {
    const stop = this.releaseStop();
    if (!stop) return;
    this.actionLoading.set(true);
    this.service
      .releaseStop(this.routeId(), stop.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.releaseStop.set(null);
          this.toast.success('Parada liberada');
          this.reloadAll();
        },
        error: (e: Error) => {
          this.actionLoading.set(false);
          this.toast.error(e?.message || 'Error al liberar la parada');
        },
      });
  }

  openDetail(stop: DispatchRouteStop): void {
    this.detailStop.set(stop);
    this.detailNote.set(null);
    if (!stop.dispatch_note_id) return;
    this.detailLoading.set(true);
    this.dispatchNotes
      .getDispatchNote(stop.dispatch_note_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (n) => {
          this.detailNote.set(n);
          this.detailLoading.set(false);
        },
        error: () => this.detailLoading.set(false),
      });
  }

  closeDetail(): void {
    this.detailStop.set(null);
    this.detailNote.set(null);
    this.detailLoading.set(false);
  }

  goToNote(id: number): void {
    this.closeDetail();
    this.router.navigate(['/admin/orders/dispatch-notes', id]);
  }

  // ---------------------------------------------------------------- reorder

  /** Swap with the neighbour and persist the FULL renumbered sequence. */
  move(index: number, delta: -1 | 1): void {
    const list = [...this.sortedStops()];
    const j = index + delta;
    if (j < 0 || j >= list.length || this.reordering()) return;
    [list[index], list[j]] = [list[j], list[index]];
    this.persistOrder(list.map((s, i) => ({ stopId: s.id, sequence: i + 1 })), false);
  }

  applyOptimalOrder(): void {
    const optimal = this.optimizedPending();
    if (optimal.length < 2 || this.reordering()) return;
    const ids = new Set(optimal.map((o) => o.stopId));
    const queue = optimal.map((o) => o.stopId);
    // Keep every other stop in its slot; only slots held by located pending
    // stops are refilled in optimal order (no sequence collisions).
    const full = this.sortedStops().map((s) => (ids.has(s.id) ? queue.shift()! : s.id));
    this.persistOrder(full.map((stopId, i) => ({ stopId, sequence: i + 1 })), true);
  }

  private persistOrder(order: { stopId: number; sequence: number }[], fromOptimal: boolean): void {
    this.reordering.set(true);
    this.service
      .reorderStops(this.routeId(), order)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.reordering.set(false);
          this.confirmingOptimal.set(false);
          this.toast.success(fromOptimal ? 'Orden óptimo aplicado' : 'Orden de paradas actualizado');
          this.reloadAll();
        },
        error: (e: Error) => {
          this.reordering.set(false);
          this.toast.error(e?.message?.trim() || 'La ruta no admite reordenamiento en su estado actual');
        },
      });
  }

  // -------------------------------------------------------------- selection

  selectStop(id: number): void {
    this.selectedStopId.set(this.selectedStopId() === id ? null : id);
  }

  onMarkerClick(m: MapMarker): void {
    const hit =
      this.markerModel().find((x) => x.marker === m) ??
      this.markerModel().find(
        (x) => x.marker.lat === m.lat && x.marker.lng === m.lng && x.marker.label === m.label,
      );
    if (hit) this.selectedStopId.set(hit.stopId);
  }

  // ------------------------------------------------------------- fullscreen

  enterFullscreen(): void {
    this.fullscreen.set(true);
    this.panelCollapsed.set(window.matchMedia?.('(max-width: 1023px)').matches ?? false);
    this.refreshMapSize();
  }

  exitFullscreen(): void {
    this.fullscreen.set(false);
    this.refreshMapSize();
  }

  onEscape(): void {
    if (this.fullscreen() && !this.settleStop() && !this.releaseStop() && !this.detailStop()) {
      this.exitFullscreen();
    }
  }

  /** MapLibre needs a resize after the container changes; a fresh markers array triggers it. */
  private refreshMapSize(): void {
    setTimeout(() => this.resizeTick.update((n) => n + 1), 60);
  }

  // ---------------------------------------------------------------- helpers

  private formatAge(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h`;
  }

  private needsCollection(stop: DispatchRouteStop): boolean {
    if (stop.needs_collection != null) return stop.needs_collection;
    return (
      !stop.is_prepaid &&
      !['delivered', 'partial', 'released', 'rejected'].includes(stop.status)
    );
  }

  private amountToCollect(stop: DispatchRouteStop): number {
    return this.needsCollection(stop) ? Number(stop.dispatch_note?.grand_total || 0) : 0;
  }

  private formatAddress(stop: DispatchRouteStop): string {
    const note = stop.dispatch_note;
    const a: DispatchDeliveryAddress | null =
      note?.customer_address ?? note?.order?.shipping_address_snapshot ?? null;
    if (!a) return 'Sin dirección';
    const parts = [a.address_line1 ?? a.line1 ?? a.address, a.city]
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0);
    return parts.length ? parts.join(', ') : 'Sin dirección';
  }
}
