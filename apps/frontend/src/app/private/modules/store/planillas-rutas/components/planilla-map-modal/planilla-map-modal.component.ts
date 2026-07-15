import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import {
  MapViewComponent,
  MapMarker,
  LatLng,
} from '../../../../../../shared/components/map-view/map-view.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { GeolocationService } from '../../../../ecommerce/services/geolocation.service';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import {
  GeoStop,
  OptimizedRoute,
  RouteOptimizerService,
} from '../../services/route-optimizer.service';
import {
  MapStop,
  MapStopUnlocated,
  MapStopsResponse,
  ReorderStopEntry,
} from '../../interfaces/planilla.interface';

/** Highlight color for the NEXT stop pin (distinct from map-view STATE_COLORS). */
const NEXT_STOP_COLOR = '#7c3aed';

/**
 * Route map modal — shows the NOT-delivered stops of a dispatch route on a map,
 * with a suggested (shortest-first) visiting order and a one-click "apply order"
 * action.
 *
 * ## Data flow
 * On open it calls `getMapStops(routeId)`; the backend returns ONLY pending /
 * in_progress stops (delivered / released / rejected are omitted). It builds
 * `GeoStop[]` from `stops` (the backend already exposes `sequence` camelCase, so
 * it is consumed as-is) and runs {@link RouteOptimizerService.optimize} to get
 * the suggested order + total distance.
 *
 * Markers are labelled with their position in the SUGGESTED order (index + 1)
 * and colored by stop `status` (via `MapMarker.state`); the NEXT stop
 * (`orderedStops[0]`) is highlighted with a distinct color + a "Próxima" badge.
 * Stops without coordinates (`unlocated`) cannot be painted, so they are listed
 * under the map so the operator still sees them.
 *
 * ## Live driver location
 * The driver's device position is tracked live via
 * `navigator.geolocation.watchPosition` (the shared `GeolocationService` only
 * exposes one-shot reads, so the continuous watch is wired here) and fed to the
 * map as a pulsing "you are here" dot. It becomes the START point of the route:
 * the optimizer runs nearest-neighbor FROM the driver, so "next stop" = the
 * closest one to the driver, and the polyline begins at the driver. When the GPS
 * is unavailable (denied / unsupported / insecure context) it degrades to the
 * route's own origin and shows a subtle notice. The watch is cleared on destroy.
 *
 * ## "The delivered stop disappears"
 * There is NO client-side filtering for this: the backend never returns settled
 * stops, so after a settle the reload of `getMapStops` simply omits them.
 *
 * ## Open/close
 * Calqued from the module's canonical modal pattern (stop-settle-modal /
 * stop-detail-modal): the parent guards rendering with `@if (signal())`, this
 * modal hardcodes `[isOpen]="true"` and emits `(close)`. Being recreated on each
 * open means the initial fetch lives cleanly in `ngOnInit`.
 *
 * Zoneless-clean: signal input/output, computed state, no legacy CD APIs.
 */
@Component({
  selector: 'app-planilla-map-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, IconComponent, ButtonComponent, MapViewComponent],
  template: `
    <app-modal
      [isOpen]="true"
      title="Mapa de la ruta"
      subtitle="Paradas pendientes y recorrido sugerido"
      size="full"
      (cancel)="close.emit()"
      (closed)="close.emit()"
    >
      <!-- Full-screen flex column: summary bar (shrink) + map (grow) + unlocated (shrink). -->
      <div class="flex h-full flex-col gap-3">
        @if (loading()) {
          <div class="flex flex-1 items-center justify-center gap-2 text-text-secondary">
            <app-icon name="loader-2" [size]="18" [spin]="true"></app-icon>
            <span class="text-sm">Cargando mapa de la ruta…</span>
          </div>
        } @else if (error()) {
          <div class="flex flex-1 items-center justify-center">
            <div
              class="max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3"
            >
              <app-icon
                name="alert-triangle"
                [size]="18"
                class="text-red-600 mt-0.5 shrink-0"
              ></app-icon>
              <div class="min-w-0 text-sm text-red-800">
                <p class="font-semibold">No se pudo cargar el mapa</p>
                <p class="mt-0.5 text-red-700">{{ error() }}</p>
              </div>
            </div>
          </div>
        } @else {
          <!-- Suggested-route summary (top bar) -->
          <div class="shrink-0 space-y-2 rounded-xl border border-border bg-surface p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-sm">
                <app-icon name="navigation" [size]="16" class="text-primary-600"></app-icon>
                <span class="font-semibold text-text-primary">
                  Recorrido sugerido: {{ distanceLabel() }}
                </span>
              </div>
              <span class="text-xs text-text-secondary">
                {{ stopCount() }}
                {{ stopCount() === 1 ? 'parada pendiente' : 'paradas pendientes' }}
              </span>
              @if (deliveredStops().length > 0) {
                <span class="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                  <app-icon name="check-circle" [size]="12" class="text-green-600"></app-icon>
                  {{ deliveredStops().length }}
                  {{ deliveredStops().length === 1 ? 'entregada' : 'entregadas' }}
                </span>
              }
            </div>

            <!-- Next stop (first in the optimized order) -->
            @if (nextStop(); as next) {
              <div class="flex items-center gap-2 text-xs">
                <span
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold uppercase tracking-wide text-white"
                  [style.background]="nextStopColor"
                >
                  <app-icon name="map-pin" [size]="12"></app-icon>
                  Próxima
                </span>
                <span class="min-w-0 truncate text-text-primary">
                  #{{ next.sequence }} · {{ next.customerName || '(Cliente)' }}
                  @if (next.addressText) {
                    <span class="text-text-secondary"> · {{ next.addressText }}</span>
                  }
                </span>
              </div>
            }

            <!-- GPS fallback notice -->
            @if (locationUnavailable()) {
              <div class="flex items-center gap-1.5 text-[11px] text-amber-700">
                <app-icon name="alert-triangle" [size]="12" class="text-amber-600"></app-icon>
                Ubicación no disponible — usando origen de la ruta.
              </div>
            }
          </div>

          <!-- Map: the protagonist — fills the remaining height. min-h-0 is
               REQUIRED so this flex-1 child can shrink instead of overflowing. -->
          <div class="min-h-0 flex-1">
            <app-map-view
              class="block h-full"
              [markers]="markers()"
              [route]="routeLine()"
              [completedRoute]="completedRoute()"
              [origin]="mapOrigin()"
              [userLocation]="userLocation()"
              [fill]="true"
              [readonly]="true"
            ></app-map-view>
          </div>

          <!-- Stops without coordinates (bottom panel; capped so it never
               steals the map's height, scrolls on overflow). -->
          @if (unlocated().length > 0) {
            <div
              class="shrink-0 max-h-[28vh] overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-3"
            >
              <div class="flex items-center gap-1.5 mb-2">
                <app-icon name="map-pin" [size]="14" class="text-amber-600"></app-icon>
                <span class="text-[11px] font-bold uppercase tracking-wide text-amber-800">
                  Sin ubicación ({{ unlocated().length }})
                </span>
              </div>
              <ul class="space-y-1">
                @for (u of unlocated(); track u.stopId) {
                  <li class="flex items-start gap-2 text-xs text-amber-900">
                    <span class="font-mono font-semibold shrink-0">#{{ u.sequence }}</span>
                    <span class="min-w-0">
                      {{ u.customerName || '(Cliente)' }}
                      @if (u.addressText) {
                        <span class="text-amber-700"> · {{ u.addressText }}</span>
                      }
                    </span>
                  </li>
                }
              </ul>
              <p class="mt-2 text-[11px] text-amber-700">
                Estas paradas no tienen coordenadas y no se pueden dibujar en el
                mapa ni incluir en el recorrido sugerido.
              </p>
            </div>
          }
        }
      </div>

      <div slot="footer" class="flex flex-col gap-2">
        @if (confirming()) {
          <div
            class="rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-secondary"
          >
            ¿Aplicar el orden sugerido a
            {{ stopCount() }}
            {{ stopCount() === 1 ? 'parada' : 'paradas' }}? Esto reordenará la
            planilla.
          </div>
        }
        <div class="flex items-center justify-end gap-2">
          @if (confirming()) {
            <app-button
              variant="outline"
              size="sm"
              [disabled]="reordering()"
              (clicked)="confirming.set(false)"
            >
              Cancelar
            </app-button>
            <app-button
              variant="primary"
              size="sm"
              [loading]="reordering()"
              (clicked)="applyOrder()"
            >
              Confirmar orden
            </app-button>
          } @else {
            <app-button variant="outline" size="sm" (clicked)="close.emit()">
              Cerrar
            </app-button>
            <app-button
              variant="primary"
              size="sm"
              [disabled]="!canApply()"
              (clicked)="confirming.set(true)"
            >
              <app-icon slot="icon" name="navigation" [size]="16"></app-icon>
              Aplicar orden óptimo
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class PlanillaMapModalComponent implements OnDestroy {
  private readonly service = inject(PlanillasRutasService);
  private readonly optimizer = inject(RouteOptimizerService);
  private readonly toast = inject(ToastService);
  private readonly geo = inject(GeolocationService);
  private readonly destroyRef = inject(DestroyRef);

  /** Active `watchPosition` id, cleared on destroy. `null` when not watching. */
  private watchId: number | null = null;

  /** Route whose pending stops are mapped. */
  readonly routeId = input.required<number>();

  /** Highlight color for the "Próxima" badge (kept in sync with the map pin). */
  readonly nextStopColor = NEXT_STOP_COLOR;

  /** Dismiss the modal. */
  readonly close = output<void>();
  /** Emitted after a successful reorder so the parent can reload the detail. */
  readonly reordered = output<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<MapStopsResponse | null>(null);
  /** True while the reorder request is in flight. */
  readonly reordering = signal(false);
  /** Inline confirm state for the "apply order" action (no separate dialog). */
  readonly confirming = signal(false);

  /** Live driver position (updated on every GPS reading). `null` until a fix. */
  readonly userLocation = signal<LatLng | null>(null);
  /** True once GPS is known to be unavailable (denied / unsupported / insecure). */
  readonly locationUnavailable = signal(false);

  /** Route origin (warehouse) reported by the backend, if any. */
  readonly routeOrigin = computed<LatLng | null>(() => {
    const o = this.data()?.origin;
    return o ? { lat: o.lat, lng: o.lng } : null;
  });

  /**
   * Start of the route: the live driver location when available, otherwise the
   * route's own origin. This is what the optimizer anchors on and where the
   * polyline begins.
   */
  private readonly startPoint = computed<LatLng | null>(
    () => this.userLocation() ?? this.routeOrigin(),
  );

  /**
   * Origin (home) pin shown on the map. Only when there is NO live location —
   * once the driver's live dot is the start, a second "home" start pin would be
   * confusing, so it is hidden.
   */
  readonly mapOrigin = computed<LatLng | null>(() =>
    this.userLocation() ? null : this.routeOrigin(),
  );

  /** Located pending stops as optimizer input (`sequence` is already camelCase). */
  private readonly geoStops = computed<GeoStop[]>(() =>
    (this.data()?.stops ?? []).map((s) => ({
      stopId: s.stopId,
      sequence: s.sequence,
      lat: s.lat,
      lng: s.lng,
    })),
  );

  /**
   * Suggested visiting order + total distance (pure haversine nearest-neighbor).
   * Anchored on {@link startPoint} — the live driver when available — so the
   * order (and thus the "next" stop) is relative to the driver's position.
   */
  private readonly optimized = computed<OptimizedRoute>(() =>
    this.optimizer.optimize(this.startPoint(), this.geoStops()),
  );

  /** Located stops keyed by id, for looking up status/customer while rendering. */
  private readonly stopsById = computed<Map<number, MapStop>>(
    () => new Map((this.data()?.stops ?? []).map((s) => [s.stopId, s])),
  );

  /**
   * Delivered located stops (ordered by sequence from the backend). Kept on the
   * map in green so a settled parada does not disappear from the operator's view.
   */
  readonly deliveredStops = computed<MapStop[]>(
    () => this.data()?.delivered ?? [],
  );

  /**
   * Pins: the SUGGESTED (pending) order first — labelled by position, next stop
   * highlighted — followed by delivered stops as green ✓ pins. Delivered pins
   * carry no sequence number (they are done, not part of the suggested path).
   */
  readonly markers = computed<MapMarker[]>(() => {
    const byId = this.stopsById();
    const pending = this.optimized().orderedStops.map((s, i) => {
      const isNext = i === 0;
      return {
        lat: s.lat,
        lng: s.lng,
        label: String(i + 1),
        // `color` wins over `state` in map-view, so the next stop stands out.
        color: isNext ? NEXT_STOP_COLOR : undefined,
        state: isNext ? undefined : byId.get(s.stopId)?.status,
      } satisfies MapMarker;
    });
    const delivered = this.deliveredStops().map(
      (s) =>
        ({
          lat: s.lat,
          lng: s.lng,
          label: '✓',
          // `state:'delivered'` → green pin (map-view STATE_COLORS).
          state: 'delivered',
        }) satisfies MapMarker,
    );
    return [...pending, ...delivered];
  });

  /** The next stop to visit (first in the optimized order), for the badge. */
  readonly nextStop = computed<MapStop | null>(() => {
    const first = this.optimized().orderedStops[0];
    return first ? (this.stopsById().get(first.stopId) ?? null) : null;
  });

  /** Polyline points: the start (driver or route origin) then the ordered stops. */
  readonly routeLine = computed<LatLng[]>(() => {
    const points: LatLng[] = [];
    const start = this.startPoint();
    if (start) points.push(start);
    for (const s of this.optimized().orderedStops) {
      points.push({ lat: s.lat, lng: s.lng });
    }
    return points;
  });

  /**
   * Green completed-route polyline: the delivered stops in their persisted
   * `sequence` order (already ordered by the backend). Independent of the
   * optimizer, which only reasons about pending stops.
   */
  readonly completedRoute = computed<LatLng[]>(() =>
    this.deliveredStops().map((s) => ({ lat: s.lat, lng: s.lng })),
  );

  /** Pending stops that could not be located, surfaced as a list under the map. */
  readonly unlocated = computed<MapStopUnlocated[]>(
    () => this.data()?.unlocated ?? [],
  );

  /** Number of mappable (located) pending stops. */
  readonly stopCount = computed<number>(() => this.data()?.stops.length ?? 0);

  /** Human-readable total distance of the suggested route. */
  readonly distanceLabel = computed<string>(
    () => `${this.optimized().totalDistanceKm.toFixed(1)} km`,
  );

  /** "Apply" is available only with >=2 located stops and no in-flight work. */
  readonly canApply = computed<boolean>(
    () => !this.loading() && !this.reordering() && this.stopCount() >= 2,
  );

  ngOnInit(): void {
    // The modal is recreated on each open (parent `@if` guard), so the initial
    // fetch lives here — same lifecycle convention as the detail page.
    this.fetch();
    this.startLocationWatch();
  }

  ngOnDestroy(): void {
    this.stopLocationWatch();
  }

  /**
   * Starts a continuous GPS watch. The shared `GeolocationService` only offers
   * one-shot reads, so we drive `navigator.geolocation.watchPosition` directly
   * and mirror each reading into the `userLocation` signal. On error (denied /
   * unavailable / timeout) we degrade to the route origin and flag the notice.
   */
  private startLocationWatch(): void {
    if (
      !this.geo.isSupported() ||
      typeof navigator === 'undefined' ||
      !navigator.geolocation
    ) {
      this.locationUnavailable.set(true);
      return;
    }
    if (
      typeof window !== 'undefined' &&
      (window as Window).isSecureContext === false
    ) {
      this.locationUnavailable.set(true);
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        // Signal writes schedule change detection in the zoneless runtime; no
        // NgZone needed even though this callback fires outside Angular.
        this.userLocation.set({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        this.locationUnavailable.set(false);
      },
      () => {
        // Only surface the fallback notice while we have no fix at all; a
        // transient error after a good fix keeps the last known position.
        if (!this.userLocation()) this.locationUnavailable.set(true);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }

  /** Clears the active GPS watch, if any. Idempotent. */
  private stopLocationWatch(): void {
    if (
      this.watchId != null &&
      typeof navigator !== 'undefined' &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .getMapStops(this.routeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.data.set(res);
          this.loading.set(false);
        },
        error: (e: Error) => {
          this.error.set(e?.message || 'No se pudo cargar el mapa de la ruta');
          this.loading.set(false);
        },
      });
  }

  /**
   * Persist the suggested order. `sequence` is re-derived from the position in
   * the optimized list (1-based) so it always satisfies the backend contract
   * regardless of the stops' original sequence values.
   */
  applyOrder(): void {
    if (!this.canApply()) return;
    const order: ReorderStopEntry[] = this.optimized().orderedStops.map(
      (s, i) => ({ stopId: s.stopId, sequence: i + 1 }),
    );
    this.reordering.set(true);
    this.service
      .reorderStops(this.routeId(), order)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.reordering.set(false);
          this.confirming.set(false);
          this.toast.success('Orden de paradas actualizado');
          this.reordered.emit();
          // Reload: settled stops won't come back, and the pins/order refresh.
          this.fetch();
        },
        error: (err: Error) => {
          this.reordering.set(false);
          this.confirming.set(false);
          // The service maps API errors to `Error(message)`; the backend ships a
          // specific Spanish message for the 409 not-editable case
          // (DSP_ROUTE_NOT_EDITABLE_001), so surface it. Fall back to the
          // canonical "not reorderable in current state" copy when absent.
          const msg = err?.message?.trim();
          this.toast.error(
            msg && msg.length > 0
              ? msg
              : 'La ruta no admite reordenamiento en su estado actual',
          );
        },
      });
  }
}
