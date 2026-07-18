import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  effect,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** Simple lat/lng pair used for map center, route points and origin. */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * A single stop rendered on the map as a numbered pin.
 * - `label`  → the number/short text shown inside the pin (stop order).
 * - `color`  → explicit pin color; wins over `state`.
 * - `state`  → soft mapping to a color when `color` is not provided
 *              (see STATE_COLORS). Also surfaced for future use.
 */
export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  state?: string;
}

/**
 * Default view when there are NO points to frame: the whole of Colombia. The
 * map is always visible; with no marker/route we frame the country.
 */
const COLOMBIA_CENTER: LatLng = { lat: 4.0, lng: -73.0 };
const COUNTRY_ZOOM = 5;
/** Zoom used when there is exactly one point (no bounds to fit). */
const POINT_ZOOM = 15;
/** If the basemap has not loaded within this window, treat it as un-renderable. */
const LOAD_TIMEOUT_MS = 12000;

/**
 * Basemap style. OpenFreeMap `bright` (OSM data, KEYLESS, backed by OSMF/Fastly):
 * a street-oriented style that labels calles and carreras prominently.
 */
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';

/** Native MapLibre source/layer ids for the suggested-route polyline. */
const ROUTE_SOURCE_ID = 'mv-route';
const ROUTE_LAYER_ID = 'mv-route-line';
/** Route polyline color (violet — distinct from stop pins and the green
 *  COMPLETED_ROUTE_COLOR; same family as the NEXT stop highlight). */
const ROUTE_COLOR = '#7c3aed';

/** Native MapLibre source/layer ids for the completed (delivered) route leg. */
const COMPLETED_ROUTE_SOURCE_ID = 'mv-completed-route';
const COMPLETED_ROUTE_LAYER_ID = 'mv-completed-route-line';
/** Completed-route polyline color (green, solid — matches delivered pins). */
const COMPLETED_ROUTE_COLOR = '#16a34a';

/** Fallback stop color, and soft `state` → color mapping (overridable by `color`). */
const DEFAULT_MARKER_COLOR = '#16a34a';
const STATE_COLORS: Readonly<Record<string, string>> = {
  pending: '#f59e0b',
  in_progress: '#ea580c',
  delivered: '#16a34a',
  failed: '#dc2626',
  cancelled: '#6b7280',
};

/**
 * Reusable MapLibre-based read-only map that renders a set of numbered stops
 * (`markers`), an optional distinguished `origin` pin, and an optional
 * suggested-route polyline (`route`). It auto-frames everything with
 * `fitBounds`. Built for dispatch-route tracking (not-delivered stops with a
 * suggested path), but generic enough for any "N pins + optional path" view.
 *
 * Scaffolding is calqued from `AddressMapPickerComponent`: dynamic `import()`
 * of `maplibre-gl` (kept out of the main bundle), skeleton while tiles load,
 * placeholder on failure, a 12s load timeout, and full teardown on destroy.
 *
 * The route polyline is drawn with a NATIVE MapLibre GeoJSON source + `line`
 * layer (no extra libraries). Stops are custom HTML elements passed to
 * `new Marker({ element })` so each pin can show its number and color.
 *
 * Uses `ViewEncapsulation.None` so the imported MapLibre stylesheet (global
 * `.maplibregl-*` classes) applies to the runtime-created canvas and controls,
 * and so the global `.mv-marker*` classes style the custom pin elements.
 */
@Component({
  selector: 'app-map-view',
  standalone: true,
  imports: [],
  templateUrl: './map-view.component.html',
  styleUrls: ['./map-view.component.scss'],
  // Extra global styles for the runtime-created "you are here" marker. Kept in
  // the component (not the .scss) and applied globally thanks to
  // `ViewEncapsulation.None`, exactly like the `.mv-marker*` classes.
  styles: [
    `
      .mv-user-location {
        position: relative;
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }
      .mv-user-location__dot {
        position: relative;
        z-index: 1;
        width: 14px;
        height: 14px;
        border-radius: 9999px;
        background: #2563eb;
        border: 2px solid #ffffff;
        box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.55);
      }
      .mv-user-location__pulse {
        position: absolute;
        inset: 0;
        border-radius: 9999px;
        background: rgba(37, 99, 235, 0.35);
        animation: mv-user-location-pulse 1.8s ease-out infinite;
      }
      @keyframes mv-user-location-pulse {
        0% {
          transform: scale(0.6);
          opacity: 0.85;
        }
        70% {
          transform: scale(2.6);
          opacity: 0;
        }
        100% {
          transform: scale(2.6);
          opacity: 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .mv-user-location__pulse {
          animation: none;
          opacity: 0.35;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class MapViewComponent implements AfterViewInit, OnDestroy {
  /** Numbered stops to render as pins. */
  readonly markers = input<MapMarker[]>([]);
  /** Ordered points for the suggested-route polyline. `null`/<2 points → no line. */
  readonly route = input<LatLng[] | null>(null);
  /**
   * Ordered points for the COMPLETED (delivered) route leg, drawn as a solid
   * green polyline underneath the suggested route. `null`/<2 points → no line.
   */
  readonly completedRoute = input<LatLng[] | null>(null);
  /** Distinguished origin pin (e.g. the warehouse/start). `null` → none. */
  readonly origin = input<LatLng | null>(null);
  /**
   * Live position of the current user (e.g. the driver). Rendered as a distinct
   * pulsing blue "you are here" dot and always included in `fitBounds` so the
   * user stays framed together with the stops. `null` → not shown.
   */
  readonly userLocation = input<LatLng | null>(null);
  /** Tracking mode: `true` (default) keeps pins non-draggable and read-only. */
  readonly readonly = input<boolean>(true);
  /**
   * Fill mode: when `true` the map fills its container's height (drives the
   * `.map-view--fill` styles) instead of the default fixed 320px card. Used by
   * full-screen/immersive hosts. Default `false` → exact legacy behavior.
   */
  readonly fill = input<boolean>(false);
  /**
   * Camera rotation (degrees, clockwise from north) applied on every framing.
   * `null` (default) → north-up, i.e. exact legacy behavior; the admin modal,
   * which never passes this, is therefore unaffected. Immersive hosts pass a
   * live heading (e.g. bearing toward the next stop) to orient the map.
   */
  readonly bearing = input<number | null>(null);
  /**
   * When `true`, renders a floating "center on me" control over the map. Default
   * `false` → no control (legacy behavior; the admin modal stays button-less).
   */
  readonly showRecenterControl = input<boolean>(false);
  /**
   * Two-way "follow me" mode. When `true` (and a `userLocation` is present) the
   * camera eases to keep the live location centered instead of fitting all
   * points. A manual pan/rotate gesture turns it back off. Default `false` →
   * exact legacy fit-to-data framing (the admin modal never opts in).
   */
  readonly followUser = model<boolean>(false);

  /** Emitted when a stop pin is clicked. */
  readonly markerClick = output<MapMarker>();

  readonly mapContainer =
    viewChild.required<ElementRef<HTMLDivElement>>('mapContainer');

  /** True while the basemap tiles are still loading (drives the skeleton). */
  readonly loading = signal(true);
  /** True when the map could not be rendered at all (drives the placeholder). */
  readonly error = signal(false);

  // MapLibre instances are typed as `any` because the library is dynamically
  // imported (same criterion as AddressMapPickerComponent); never read from
  // the template.
  private maplibregl: any = null;
  private map: any = null;
  private markerRefs: any[] = [];
  private originMarker: any = null;
  private userMarker: any = null;
  private mapReady = false;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  /** Delays collapsing the map credit so it flashes briefly (~0.3s) on load. */
  private attribTimer: ReturnType<typeof setTimeout> | null = null;
  /** ResizeObserver que monitorea cambios de tamaño del contenedor del mapa (fix para mobile). */
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    // Re-render stops + route + framing whenever any input changes, once the
    // basemap is ready. Reading the signals here registers them as
    // dependencies; `renderData` re-reads their current values.
    effect(() => {
      this.markers();
      this.route();
      this.completedRoute();
      this.origin();
      this.userLocation();
      this.readonly();
      // Reading `fill()` re-renders (and thus re-`resize()`s the canvas) if the
      // container's sizing mode flips at runtime.
      this.fill();
      // Register camera-orientation + follow-mode as deps so a bearing change or
      // a recenter (followUser → true) re-frames the map through `renderData`.
      this.bearing();
      this.followUser();
      if (this.mapReady) this.renderData();
    });
  }

  async ngAfterViewInit(): Promise<void> {
    try {
      const maplibreModule = await import('maplibre-gl');
      this.maplibregl = (maplibreModule as any).default ?? maplibreModule;

      this.map = new this.maplibregl.Map({
        container: this.mapContainer().nativeElement,
        style: BASEMAP_STYLE,
        center: [COLOMBIA_CENTER.lng, COLOMBIA_CENTER.lat],
        zoom: COUNTRY_ZOOM,
        attributionControl: false,
      });

      this.map.addControl(
        new this.maplibregl.NavigationControl({ showCompass: false }),
        'top-right',
      );
      // Fullscreen: lets the user expand the map to inspect the full route.
      this.map.addControl(new this.maplibregl.FullscreenControl(), 'top-right');
      // OSM/OpenFreeMap attribution is REQUIRED by the ODbL license.
      this.map.addControl(
        new this.maplibregl.AttributionControl({ compact: true }),
        'bottom-right',
      );

      // A manual pan/rotate breaks "follow me": the camera stops chasing the
      // live location until the user re-centers. A programmatic `easeTo` does
      // NOT emit `dragstart`/`rotatestart`, so this only fires on real gestures.
      this.map.on('dragstart', () => this.followUser.set(false));
      this.map.on('rotatestart', () => this.followUser.set(false));

      this.map.on('load', () => {
        this.mapReady = true;
        this.loading.set(false);
        this.clearLoadTimer();
        // Let the OSM/OpenFreeMap credit flash briefly (~0.3s) on load so it is
        // seen, then collapse it to the ⓘ button (maplibre-gl v5 renders it
        // expanded). Hover or click re-expands it (see the .scss :hover rule and
        // the native <summary> toggle).
        this.attribTimer = setTimeout(() => this.minimizeAttribution(), 300);
        // Draw whatever inputs are already present and frame them.
        this.renderData();
        // Ensure correct sizing after the container transitions into view.
        this.map.resize();
        // Arranca ResizeObserver para mapa fullscreen (mobile): el contenedor puede
        // cambiar de tamaño por barra de direcciones, teclado virtual, orientación.
        this.startResizeObserver();
      });

      // If the basemap never loads (tiles unreachable), fall back to the
      // placeholder instead of leaving the skeleton spinning forever.
      this.loadTimer = setTimeout(() => {
        if (!this.mapReady) {
          this.loading.set(false);
          this.error.set(true);
        }
      }, LOAD_TIMEOUT_MS);
    } catch (err) {
      // WebGL unsupported / dynamic import failed / init threw → show the
      // placeholder instead of a broken canvas.
      console.error('MapViewComponent: error initializing MapLibre:', err);
      this.loading.set(false);
      this.error.set(true);
    }
  }

  /** Arranca el ResizeObserver para detectar cambios de tamaño del contenedor. */
  private startResizeObserver(): void {
    if (!('ResizeObserver' in window) || this.resizeObserver) return;
    try {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.map && this.mapReady) {
          try {
            this.map.resize();
          } catch {
            // ignore if context lost
          }
        }
      });
      this.resizeObserver.observe(this.mapContainer().nativeElement);
    } catch {
      // ResizeObserver not supported or init failed; map will degrade gracefully.
    }
  }

  /** Detiene el ResizeObserver al destruir el componente. */
  private stopResizeObserver(): void {
    if (this.resizeObserver) {
      try {
        this.resizeObserver.disconnect();
      } catch {
        // ignore
      }
      this.resizeObserver = null;
    }
  }

  /**
   * Re-enables "follow me" (e.g. from the floating recenter control) and re-runs
   * the render so the camera snaps to the live location on the next frame.
   */
  onRecenterClick(): void {
    this.followUser.set(true);
    if (this.mapReady) this.renderData();
  }

  /**
   * maplibre-gl v5 renders a `compact: true` AttributionControl EXPANDED on
   * load (it adds `maplibregl-compact-show` + the `open` attribute). Strip both
   * once so only the ⓘ button shows; the OSM/OpenFreeMap credit stays fully
   * accessible on click, keeping the ODbL license satisfied without crowding
   * the route view. The `maplibregl-compact` class remains, so MapLibre's
   * internal `_updateCompact()` never re-expands it on later events.
   */
  private minimizeAttribution(): void {
    const attrib = this.map
      ?.getContainer()
      ?.querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.remove('maplibregl-compact-show');
    attrib?.removeAttribute('open');
  }

  /**
   * Full redraw: clears previous pins, redraws the route layer, recreates all
   * pins (origin + numbered stops) and re-frames the map. Guarded so it only
   * runs on a ready map. Called from the `load` handler and the reactive effect.
   */
  private renderData(): void {
    if (!this.map || !this.maplibregl || !this.mapReady) return;
    // The container can grow AFTER the map was created — e.g. a full-screen
    // modal takeover or an open animation. MapLibre sizes its canvas to the
    // container at init and does NOT auto-follow, so sync it to the real
    // current size before framing; otherwise the map stays a 320px strip and
    // fitBounds padding is computed against the wrong dimensions. Cheap no-op
    // when the size is unchanged (the default 320px consumers).
    try {
      this.map.resize();
    } catch {
      // MapLibre can throw if the WebGL context is not ready — ignore.
    }
    this.clearMarkers();
    // Completed (delivered) leg first, so the suggested route sits on top of it.
    this.drawCompletedRoute();
    this.drawRoute();
    this.drawOrigin();
    this.drawMarkers();
    // Drawn last so the live "you are here" dot always sits on top of the pins.
    this.drawUserLocation();
    // Final framing: in follow mode (immersive hosts) keep the live location
    // centered and oriented; otherwise fit ALL points (legacy behavior, and
    // what the admin modal always gets since it never opts into follow/bearing).
    const user = this.userLocation();
    if (this.followUser() && user) {
      this.map.easeTo({
        center: [user.lng, user.lat],
        bearing: this.bearing() ?? this.map.getBearing(),
        zoom: Math.max(this.map.getZoom(), 15.5),
        duration: 500,
      });
    } else {
      this.fitToData();
    }
  }

  /** Removes and forgets every custom marker (stops + origin) to avoid leaks. */
  private clearMarkers(): void {
    for (const ref of this.markerRefs) {
      try {
        ref.remove();
      } catch {
        // ignore if already detached
      }
    }
    this.markerRefs = [];
    if (this.originMarker) {
      try {
        this.originMarker.remove();
      } catch {
        // ignore
      }
      this.originMarker = null;
    }
    if (this.userMarker) {
      try {
        this.userMarker.remove();
      } catch {
        // ignore
      }
      this.userMarker = null;
    }
  }

  /** (Re)draws the suggested-route polyline as a native GeoJSON line layer. */
  private drawRoute(): void {
    // Remove any previous layer/source before re-adding.
    if (this.map.getLayer(ROUTE_LAYER_ID)) this.map.removeLayer(ROUTE_LAYER_ID);
    if (this.map.getSource(ROUTE_SOURCE_ID)) this.map.removeSource(ROUTE_SOURCE_ID);

    const route = this.route();
    if (!route || route.length < 2) return;

    const coordinates = route.map((point) => [point.lng, point.lat]);
    this.map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      },
    });
    this.map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ROUTE_COLOR,
        'line-width': 4,
        'line-opacity': 0.85,
        // Dashed to read as a *suggested* path rather than a fixed track.
        'line-dasharray': [2, 1.5],
      },
    });
  }

  /**
   * (Re)draws the COMPLETED (delivered) route leg as a solid green GeoJSON line
   * layer. Rendered underneath the suggested route so an already-travelled path
   * reads as "done" while the pending suggestion still stands out on top.
   */
  private drawCompletedRoute(): void {
    // Remove any previous layer/source before re-adding.
    if (this.map.getLayer(COMPLETED_ROUTE_LAYER_ID))
      this.map.removeLayer(COMPLETED_ROUTE_LAYER_ID);
    if (this.map.getSource(COMPLETED_ROUTE_SOURCE_ID))
      this.map.removeSource(COMPLETED_ROUTE_SOURCE_ID);

    const completed = this.completedRoute();
    if (!completed || completed.length < 2) return;

    const coordinates = completed.map((point) => [point.lng, point.lat]);
    this.map.addSource(COMPLETED_ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      },
    });
    this.map.addLayer({
      id: COMPLETED_ROUTE_LAYER_ID,
      type: 'line',
      source: COMPLETED_ROUTE_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': COMPLETED_ROUTE_COLOR,
        'line-width': 4,
        // Solid (no dash) to read as an already-travelled, settled leg.
        'line-opacity': 0.9,
      },
    });
  }

  /** Creates the distinguished origin pin, if an origin was provided. */
  private drawOrigin(): void {
    const origin = this.origin();
    if (!origin) return;
    const element = this.createOriginElement();
    this.originMarker = new this.maplibregl.Marker({
      element,
      anchor: 'center',
      draggable: false,
    })
      .setLngLat([origin.lng, origin.lat])
      .addTo(this.map);
    this.markerRefs.push(this.originMarker);
  }

  /** Creates the live "you are here" pulsing dot, if a user location was given. */
  private drawUserLocation(): void {
    const loc = this.userLocation();
    if (!loc) return;
    const element = this.createUserLocationElement();
    this.userMarker = new this.maplibregl.Marker({
      element,
      anchor: 'center',
      draggable: false,
    })
      .setLngLat([loc.lng, loc.lat])
      .addTo(this.map);
    this.markerRefs.push(this.userMarker);
  }

  /** Creates one numbered pin per stop. */
  private drawMarkers(): void {
    const draggable = !this.readonly();
    for (const marker of this.markers()) {
      const element = this.createMarkerElement(marker);
      element.addEventListener('click', () => this.markerClick.emit(marker));
      const ref = new this.maplibregl.Marker({
        element,
        anchor: 'center',
        draggable,
      })
        .setLngLat([marker.lng, marker.lat])
        .addTo(this.map);
      this.markerRefs.push(ref);
    }
  }

  /** Frames all points (origin + stops + route) with fitBounds; falls back for 0/1. */
  private fitToData(): void {
    const points: LatLng[] = [];
    const origin = this.origin();
    if (origin) points.push(origin);
    // ALWAYS frame the live user location together with the stops/route.
    const userLocation = this.userLocation();
    if (userLocation) points.push(userLocation);
    points.push(...this.markers());
    const route = this.route();
    if (route) points.push(...route);
    const completedRoute = this.completedRoute();
    if (completedRoute) points.push(...completedRoute);

    // `bearing() ?? 0` → north-up when no host bearing is supplied (legacy
    // behavior; the admin modal never passes one), or the host heading otherwise.
    const bearing = this.bearing() ?? 0;
    if (points.length === 0) {
      this.map.jumpTo({
        center: [COLOMBIA_CENTER.lng, COLOMBIA_CENTER.lat],
        zoom: COUNTRY_ZOOM,
        bearing,
      });
      return;
    }
    if (points.length === 1) {
      this.map.jumpTo({
        center: [points[0].lng, points[0].lat],
        zoom: POINT_ZOOM,
        bearing,
      });
      return;
    }
    const bounds = new this.maplibregl.LngLatBounds();
    for (const point of points) bounds.extend([point.lng, point.lat]);
    this.map.fitBounds(bounds, {
      padding: 56,
      maxZoom: 16,
      duration: 400,
      bearing,
    });
  }

  /** Builds a numbered stop pin element, colored by `color` → `state` → default. */
  private createMarkerElement(marker: MapMarker): HTMLElement {
    const doc = this.mapContainer().nativeElement.ownerDocument;
    const element = doc.createElement('div');
    element.className = 'mv-marker';
    if (!this.readonly()) element.classList.add('mv-marker--interactive');
    const color =
      marker.color ??
      (marker.state ? STATE_COLORS[marker.state] : undefined) ??
      DEFAULT_MARKER_COLOR;
    element.style.setProperty('--mv-marker-color', color);
    const label = marker.label?.trim();
    element.textContent = label && label.length > 0 ? label : '•';
    element.setAttribute('title', label ? `Parada ${label}` : 'Parada');
    return element;
  }

  /** Builds the distinguished origin pin element (fixed color + home glyph). */
  private createOriginElement(): HTMLElement {
    const doc = this.mapContainer().nativeElement.ownerDocument;
    const element = doc.createElement('div');
    element.className = 'mv-marker mv-marker--origin';
    element.setAttribute('title', 'Origen');
    element.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
      '<polyline points="9 22 9 12 15 12 15 22"/></svg>';
    return element;
  }

  /**
   * Builds the live "you are here" marker: a pulsing halo behind a solid blue
   * dot. Deliberately distinct from the numbered stop pins and the origin
   * (home) pin so the driver's position is unmistakable.
   */
  private createUserLocationElement(): HTMLElement {
    const doc = this.mapContainer().nativeElement.ownerDocument;
    const element = doc.createElement('div');
    element.className = 'mv-user-location';
    element.setAttribute('title', 'Tu ubicación');
    const pulse = doc.createElement('span');
    pulse.className = 'mv-user-location__pulse';
    pulse.setAttribute('aria-hidden', 'true');
    const dot = doc.createElement('span');
    dot.className = 'mv-user-location__dot';
    dot.setAttribute('aria-hidden', 'true');
    element.appendChild(pulse);
    element.appendChild(dot);
    return element;
  }

  private clearLoadTimer(): void {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.stopResizeObserver();
    this.clearLoadTimer();
    if (this.attribTimer) clearTimeout(this.attribTimer);
    try {
      this.clearMarkers();
      this.map?.remove?.();
    } catch {
      // MapLibre can throw if the WebGL context was already lost — ignore.
    }
    this.markerRefs = [];
    this.originMarker = null;
    this.userMarker = null;
    this.map = null;
    this.maplibregl = null;
  }
}
