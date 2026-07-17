import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { ButtonComponent } from '../button/button.component';
import {
  MapViewComponent,
  MapMarker,
  LatLng,
} from '../map-view/map-view.component';
// Reuse (no duplication): the live GPS watch degradation checks and the pure
// nearest-neighbor optimizer already live in the app. They are `providedIn:
// 'root'` singletons, so importing them here is a token/type import only —
// the same reuse the planilla map modal has always done.
import { GeolocationService } from '../../../private/modules/ecommerce/services/geolocation.service';
import {
  GeoStop,
  OptimizedRoute,
  RouteOptimizerService,
} from '../../../private/modules/store/planillas-rutas/services/route-optimizer.service';

/** Highlight color for the NEXT stop pin (distinct from map-view STATE_COLORS). */
const NEXT_STOP_COLOR = '#7c3aed';

/**
 * A located stop the map can paint. Structurally compatible with the planilla
 * `MapStop` (so the admin modal can pass its backend `MapStop[]` as-is) and
 * with the shape the carrier page builds from `dispatch_note.customer_address`.
 */
export interface RouteMapStop {
  stopId: number;
  sequence: number;
  /** `pending` / `in_progress` for pending stops; `delivered` for the done leg. */
  status: string;
  customerName: string | null;
  addressText: string | null;
  lat: number;
  lng: number;
}

/** A stop WITHOUT resolvable coordinates — listed under the map, never painted. */
export interface RouteMapUnlocatedStop {
  stopId: number;
  sequence: number;
  customerName: string | null;
  addressText: string | null;
}

/** One entry of the reorder payload emitted by `(applyOrder)`. */
export interface RouteMapReorderEntry {
  stopId: number;
  sequence: number;
}

/**
 * Presentational route map — the shared engine behind BOTH the admin
 * `PlanillaMapModalComponent` and the carrier `MapaPageComponent`.
 *
 * It owns the reusable, non-trivial parts that used to live in the modal:
 * building numbered markers, running {@link RouteOptimizerService} to suggest a
 * shortest-first visiting order, highlighting the NEXT stop, tracking the
 * driver's live position via `navigator.geolocation.watchPosition`, and drawing
 * everything through {@link MapViewComponent} (reused as-is).
 *
 * It is fully data-driven: the host supplies the located pending `stops`, the
 * `delivered` leg, the `unlocated` list and an optional `origin`; this component
 * never fetches. The optimizer anchors on the live driver location when
 * available (so "next stop" is relative to the driver) and degrades to `origin`
 * — or to nothing — when GPS is denied / unsupported / on an insecure context,
 * surfacing an amber notice and keeping the unlocated stops visible.
 *
 * The optional "Aplicar orden óptimo" action is enabled with `showApplyOrder`;
 * the component emits the optimized 1-based order through `(applyOrder)` and the
 * HOST persists it (the admin modal → `reorderStops`). This keeps the component
 * presentation-only (no HTTP, no service persistence of its own).
 *
 * Zoneless-clean: signal inputs/outputs, computed derived state, GPS readings
 * mirrored into signals (writes schedule change detection with no NgZone), and
 * `clearWatch` on destroy so switching tabs / closing the modal never leaks the
 * watch.
 */
@Component({
  selector: 'app-route-map-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ButtonComponent, MapViewComponent],
  template: `
    <!-- Flex column: summary bar (shrink) + map (grow) + unlocated (shrink).
         Fills the host's height so the map is the protagonist. -->
    <div class="flex h-full flex-col gap-3">
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
            {{ locationNotice() }}
          </div>
        }
      </div>

      <!-- Map: fills the remaining height. min-h-0 is REQUIRED so this flex-1
           child can shrink instead of overflowing. -->
      <div class="min-h-0 flex-1">
        <app-map-view
          class="block h-full"
          [markers]="markers()"
          [route]="routeLine()"
          [completedRoute]="completedRoute()"
          [origin]="mapOrigin()"
          [userLocation]="userLocation()"
          [fill]="fill()"
          [readonly]="readonly()"
        ></app-map-view>
      </div>

      <!-- Optional "apply optimal order" action (host persists on (applyOrder)). -->
      @if (showApplyOrder()) {
        <div class="shrink-0 flex flex-col gap-2">
          @if (confirming()) {
            <div
              class="rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-secondary"
            >
              ¿Aplicar el orden sugerido a
              {{ stopCount() }}
              {{ stopCount() === 1 ? 'parada' : 'paradas' }}? Esto reordenará las
              paradas pendientes.
            </div>
            <div class="flex items-center justify-end gap-2">
              <app-button
                variant="outline"
                size="sm"
                [disabled]="applying()"
                (clicked)="confirming.set(false)"
              >
                Cancelar
              </app-button>
              <app-button
                variant="primary"
                size="sm"
                [loading]="applying()"
                (clicked)="apply()"
              >
                Confirmar orden
              </app-button>
            </div>
          } @else {
            <div class="flex items-center justify-end">
              <app-button
                variant="primary"
                size="sm"
                [loading]="applying()"
                [disabled]="!canApply()"
                (clicked)="confirming.set(true)"
              >
                <app-icon slot="icon" name="navigation" [size]="16"></app-icon>
                Aplicar orden óptimo
              </app-button>
            </div>
          }
        </div>
      }

      <!-- Stops without coordinates (capped so it never steals the map height). -->
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
            Estas paradas no tienen coordenadas y no se pueden dibujar en el mapa
            ni incluir en el recorrido sugerido.
          </p>
        </div>
      }
    </div>
  `,
})
export class RouteMapViewComponent implements OnInit, OnDestroy {
  private readonly optimizer = inject(RouteOptimizerService);
  private readonly geo = inject(GeolocationService);

  /** Active `watchPosition` id, cleared on destroy. `null` when not watching. */
  private watchId: number | null = null;

  /** Located pending stops — the optimizer input (numbered, next highlighted). */
  readonly stops = input<RouteMapStop[]>([]);
  /** Located delivered stops — kept green on the map so a settled stop stays. */
  readonly delivered = input<RouteMapStop[]>([]);
  /** Pending stops without coordinates — listed under the map. */
  readonly unlocated = input<RouteMapUnlocatedStop[]>([]);
  /** Route origin (warehouse). `null` → the map anchors on the driver only. */
  readonly origin = input<LatLng | null>(null);
  /** Passthrough to map-view: `true` (default) keeps pins read-only. */
  readonly readonly = input<boolean>(true);
  /** Passthrough to map-view: `true` fills the host height (immersive hosts). */
  readonly fill = input<boolean>(false);
  /** Renders the "Aplicar orden óptimo" action (host persists on emit). */
  readonly showApplyOrder = input<boolean>(false);
  /** Host-driven loading of the persist call — spins/disables the apply button. */
  readonly applying = input<boolean>(false);
  /** Minimum located stops required before "apply order" is available. */
  readonly minStopsToApply = input<number>(2);

  /** Emitted (1-based order) when the user confirms "apply optimal order". */
  readonly applyOrder = output<RouteMapReorderEntry[]>();

  /** Highlight color for the "Próxima" badge (kept in sync with the map pin). */
  readonly nextStopColor = NEXT_STOP_COLOR;

  /** Live driver position (updated on every GPS reading). `null` until a fix. */
  readonly userLocation = signal<LatLng | null>(null);
  /** True once GPS is known to be unavailable (denied / unsupported / insecure). */
  readonly locationUnavailable = signal(false);
  /** Inline confirm state for the "apply order" action (no separate dialog). */
  readonly confirming = signal(false);

  /**
   * Start of the route: the live driver location when available, otherwise the
   * route's own origin. This is what the optimizer anchors on and where the
   * polyline begins.
   */
  private readonly startPoint = computed<LatLng | null>(
    () => this.userLocation() ?? this.origin(),
  );

  /**
   * Origin (home) pin shown on the map. Only when there is NO live location —
   * once the driver's live dot is the start, a second "home" start pin would be
   * confusing, so it is hidden.
   */
  readonly mapOrigin = computed<LatLng | null>(() =>
    this.userLocation() ? null : this.origin(),
  );

  /** Located pending stops as optimizer input. */
  private readonly geoStops = computed<GeoStop[]>(() =>
    this.stops().map((s) => ({
      stopId: s.stopId,
      sequence: s.sequence,
      lat: s.lat,
      lng: s.lng,
    })),
  );

  /**
   * Suggested visiting order + total distance (pure haversine nearest-neighbor),
   * anchored on {@link startPoint} so the "next" stop is relative to the driver.
   */
  private readonly optimized = computed<OptimizedRoute>(() =>
    this.optimizer.optimize(this.startPoint(), this.geoStops()),
  );

  /** Located pending stops keyed by id, for status/customer lookup on render. */
  private readonly stopsById = computed<Map<number, RouteMapStop>>(
    () => new Map(this.stops().map((s) => [s.stopId, s])),
  );

  /** Delivered located stops (kept green on the map). */
  readonly deliveredStops = computed<RouteMapStop[]>(() => this.delivered());

  /**
   * Pins: the SUGGESTED (pending) order first — labelled by position, next stop
   * highlighted — followed by delivered stops as green ✓ pins.
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
          state: 'delivered',
        }) satisfies MapMarker,
    );
    return [...pending, ...delivered];
  });

  /** The next stop to visit (first in the optimized order), for the badge. */
  readonly nextStop = computed<RouteMapStop | null>(() => {
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

  /** Green completed-route polyline: the delivered stops in their given order. */
  readonly completedRoute = computed<LatLng[]>(() =>
    this.deliveredStops().map((s) => ({ lat: s.lat, lng: s.lng })),
  );

  /** Number of mappable (located) pending stops. */
  readonly stopCount = computed<number>(() => this.stops().length);

  /** Human-readable total distance of the suggested route. */
  readonly distanceLabel = computed<string>(
    () => `${this.optimized().totalDistanceKm.toFixed(1)} km`,
  );

  /** "Apply" is available only with enough located stops and no in-flight work. */
  readonly canApply = computed<boolean>(
    () =>
      this.showApplyOrder() &&
      !this.applying() &&
      this.stopCount() >= this.minStopsToApply(),
  );

  /** GPS fallback copy — adapts to whether a route origin is available. */
  readonly locationNotice = computed<string>(() =>
    this.origin()
      ? 'Ubicación no disponible — usando origen de la ruta.'
      : 'Ubicación no disponible — mostrando solo las paradas.',
  );

  ngOnInit(): void {
    this.startLocationWatch();
  }

  ngOnDestroy(): void {
    this.stopLocationWatch();
  }

  /**
   * Emits the optimized order (1-based `sequence` re-derived from position) for
   * the host to persist. Closes the inline confirm; the host owns the loading
   * feedback via `applying` and re-feeds fresh stops on success.
   */
  apply(): void {
    if (!this.canApply()) return;
    const order: RouteMapReorderEntry[] = this.optimized().orderedStops.map(
      (s, i) => ({ stopId: s.stopId, sequence: i + 1 }),
    );
    this.applyOrder.emit(order);
    this.confirming.set(false);
  }

  /**
   * Starts a continuous GPS watch. The shared `GeolocationService` only offers
   * one-shot reads, so we drive `navigator.geolocation.watchPosition` directly
   * and mirror each reading into `userLocation`. On error (denied / unavailable
   * / timeout) we degrade to the route origin and flag the notice.
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
}
