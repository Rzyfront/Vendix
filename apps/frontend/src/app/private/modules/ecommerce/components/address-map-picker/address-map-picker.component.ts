import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** Simple lat/lng pair used for map center and marker position. */
interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Default view when there is NO located point yet: the whole of Colombia. The
 * map is always visible (even without GPS), so with no coordinate we frame the
 * country and drop NO marker — a marker only appears once there is a real point
 * (GPS, a map click/drag, or a forward-geocoded typed address).
 */
const COLOMBIA_CENTER: LatLng = { lat: 4.0, lng: -73.0 };
const COUNTRY_ZOOM = 5;
/** Zoom used once an actual point exists, close enough to place the marker. */
const POINT_ZOOM = 16;
/** If the basemap has not loaded within this window, treat it as un-renderable. */
const LOAD_TIMEOUT_MS = 12000;

/**
 * Basemap style. OpenFreeMap `bright` (OSM data, KEYLESS, backed by OSMF/Fastly):
 * a street-oriented style that labels calles and carreras prominently so the
 * customer can place the marker on the right corner.
 */
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';

/**
 * MapLibre-based location picker shown ABOVE the shipping-address form. The map
 * is ALWAYS visible (it does not wait for GPS permission): with no located point
 * it frames Colombia, and it centers on a real coordinate whenever one arrives —
 * from GPS, a click/drag, or a forward-geocoded address the customer typed.
 *
 * A draggable marker appears only once a point exists; dragging or clicking the
 * map emits the new coordinate so the parent can reverse-geocode + re-fill.
 *
 * While the tiles load, a skeleton reserves the space; if the map cannot render
 * at all (WebGL unsupported, tiles unreachable, dynamic import fails), a
 * placeholder replaces it so the customer is never stuck on a broken canvas.
 *
 * `maplibre-gl` is loaded via dynamic import so it stays OUT of the main bundle
 * and only downloads when this component is instantiated. Exact coordinates are
 * NEVER rendered as text — the map is the only representation the customer sees.
 *
 * Uses `ViewEncapsulation.None` so the imported MapLibre stylesheet (global
 * `.maplibregl-*` classes) applies to the runtime-created canvas and controls.
 */
@Component({
  selector: 'app-address-map-picker',
  standalone: true,
  imports: [],
  templateUrl: './address-map-picker.component.html',
  styleUrls: ['./address-map-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class AddressMapPickerComponent implements AfterViewInit, OnDestroy {
  /** Coordinate to center the map / marker on. Null → frame Colombia, no marker. */
  readonly center = input<LatLng | null>(null);
  /** Emitted with the new coordinate whenever the marker is moved. */
  readonly located = output<LatLng>();

  readonly mapContainer =
    viewChild.required<ElementRef<HTMLDivElement>>('mapContainer');

  /** True while the basemap tiles are still loading (drives the skeleton). */
  readonly loading = signal(true);
  /** True when the map could not be rendered at all (drives the placeholder). */
  readonly error = signal(false);
  /** True once an actual point/marker exists (drives the drag hint vs. prompt). */
  readonly hasPoint = signal(false);

  // MapLibre instances are typed as `unknown`/`any` because the library is
  // dynamically imported; they are never read from the template.
  private maplibregl: any = null;
  private map: any = null;
  private marker: any = null;
  private mapReady = false;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  /** Delays collapsing the map credit so it flashes briefly (~0.3s) on load. */
  private attribTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Re-center the map + (lazily) create the marker when the parent pushes a
    // coordinate (GPS, forward-geocode, etc.). Guarded until the map has loaded.
    effect(() => {
      const next = this.center();
      if (next && this.mapReady && this.map) {
        this.ensureMarker(next);
        this.map.flyTo({ center: [next.lng, next.lat], zoom: POINT_ZOOM });
      }
    });
  }

  async ngAfterViewInit(): Promise<void> {
    try {
      const start = this.center();

      const maplibreModule = await import('maplibre-gl');
      this.maplibregl = (maplibreModule as any).default ?? maplibreModule;

      this.map = new this.maplibregl.Map({
        container: this.mapContainer().nativeElement,
        style: BASEMAP_STYLE,
        center: start ? [start.lng, start.lat] : [COLOMBIA_CENTER.lng, COLOMBIA_CENTER.lat],
        zoom: start ? POINT_ZOOM : COUNTRY_ZOOM,
        attributionControl: false,
      });

      this.map.addControl(
        new this.maplibregl.NavigationControl({ showCompass: false }),
        'top-right',
      );
      // Fullscreen: lets the customer expand the map to place the pin precisely.
      this.map.addControl(new this.maplibregl.FullscreenControl(), 'top-right');
      // Geolocate ("recenter on me"): one click re-centers on the live GPS
      // position, drops the delivery marker there and re-emits so the parent
      // re-geocodes. showUserLocation/showAccuracyCircle OFF so the blue dot +
      // accuracy circle do not sit on top of the map and block dragging the
      // green marker.
      const geolocate = new this.maplibregl.GeolocateControl({
        // timeout + maximumAge keep the "locate me" button fast: reuse a recent
        // fix and never hang waiting for a perfect one.
        positionOptions: {
          enableHighAccuracy: true,
          timeout: 6000,
          maximumAge: 30000,
        },
        trackUserLocation: false,
        showUserLocation: false,
        showAccuracyCircle: false,
      });
      this.map.addControl(geolocate, 'top-right');
      geolocate.on('geolocate', (pos: any) => {
        const coord = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        this.ensureMarker(coord);
        this.map.flyTo({ center: [coord.lng, coord.lat], zoom: POINT_ZOOM });
        this.emitFromMarker();
      });
      this.map.addControl(
        new this.maplibregl.AttributionControl({ compact: true }),
        'bottom-right',
      );

      // A marker exists from the start ONLY if we already have a point.
      if (start) this.ensureMarker(start);

      // Clicking the map is a convenience that positions/creates the marker.
      this.map.on('click', (event: any) => {
        this.ensureMarker({ lat: event.lngLat.lat, lng: event.lngLat.lng });
        this.emitFromMarker();
      });

      this.map.on('load', () => {
        this.mapReady = true;
        this.loading.set(false);
        this.clearLoadTimer();
        // Let the OSM/OpenFreeMap credit flash briefly (~0.3s) on load so it is
        // seen, then collapse it to the ⓘ button (maplibre-gl v5 renders it
        // expanded). Hover or click re-expands it (see the .scss :hover rule and
        // the native <summary> toggle).
        this.attribTimer = setTimeout(() => this.minimizeAttribution(), 300);
        // A point may have arrived during load → make sure it is shown.
        const c = this.center();
        if (c) {
          this.ensureMarker(c);
          this.map.flyTo({ center: [c.lng, c.lat], zoom: POINT_ZOOM });
        }
        // Ensure correct sizing after the container transitions into view.
        this.map.resize();
      });

      // If the basemap never loads (tiles unreachable), fall back to the
      // placeholder instead of leaving the skeleton spinning forever.
      this.loadTimer = setTimeout(() => {
        if (!this.mapReady) {
          this.loading.set(false);
          this.error.set(true);
        }
      }, LOAD_TIMEOUT_MS);
    } catch {
      // WebGL unsupported / dynamic import failed / init threw → show the
      // placeholder; the customer fills the address manually (form still works).
      this.loading.set(false);
      this.error.set(true);
    }
  }

  /**
   * maplibre-gl v5 renders a `compact: true` AttributionControl EXPANDED on
   * load (it adds `maplibregl-compact-show` + the `open` attribute). Strip both
   * once so only the ⓘ button shows; the OSM/OpenFreeMap credit stays fully
   * accessible on click, keeping the ODbL license satisfied without crowding
   * the form. The `maplibregl-compact` class remains, so MapLibre's internal
   * `_updateCompact()` never re-expands it on later resize/sourcedata events.
   */
  private minimizeAttribution(): void {
    const attrib = this.map
      ?.getContainer()
      ?.querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.remove('maplibregl-compact-show');
    attrib?.removeAttribute('open');
  }

  /** Lazily creates the draggable marker on first point, or moves the existing one. */
  private ensureMarker(coord: LatLng): void {
    if (!this.map || !this.maplibregl) return;
    if (!this.marker) {
      // anchor:'bottom' puts the pin TIP exactly on the coordinate (the default
      // 'center' anchor makes the pin hang below, reading as ~south of the point).
      this.marker = new this.maplibregl.Marker({
        draggable: true,
        color: '#16a34a',
        anchor: 'bottom',
      })
        .setLngLat([coord.lng, coord.lat])
        .addTo(this.map);
      this.marker.on('dragend', () => this.emitFromMarker());
      this.hasPoint.set(true);
    } else {
      this.marker.setLngLat([coord.lng, coord.lat]);
    }
  }

  private emitFromMarker(): void {
    if (!this.marker) return;
    const lngLat = this.marker.getLngLat();
    this.located.emit({ lat: lngLat.lat, lng: lngLat.lng });
  }

  private clearLoadTimer(): void {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.clearLoadTimer();
    if (this.attribTimer) clearTimeout(this.attribTimer);
    try {
      this.marker?.remove?.();
      this.map?.remove?.();
    } catch {
      // MapLibre can throw if the WebGL context was already lost — ignore.
    }
    this.marker = null;
    this.map = null;
    this.maplibregl = null;
  }
}
