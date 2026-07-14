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

/** Default map center when no coordinate is provided yet (Bogotá, CO). */
const DEFAULT_CENTER: LatLng = { lat: 4.7110, lng: -74.0721 };

/**
 * MapLibre-based location picker shown above the shipping-address form once the
 * customer opts in to using their location. Renders an OpenStreetMap basemap
 * (OpenFreeMap tiles, no API key) with a draggable marker; dragging or clicking
 * the map emits the new coordinate so the parent can reverse-geocode + re-fill.
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
  /** Coordinate to center the map / marker on. */
  readonly center = input<LatLng | null>(null);
  /** Emitted with the new coordinate whenever the marker is moved. */
  readonly located = output<LatLng>();

  readonly mapContainer =
    viewChild.required<ElementRef<HTMLDivElement>>('mapContainer');

  /** True while the basemap tiles are still loading (drives the overlay). */
  readonly loading = signal(true);

  // MapLibre instances are typed as `unknown`/`any` because the library is
  // dynamically imported; they are never read from the template.
  private map: any = null;
  private marker: any = null;
  private mapReady = false;

  constructor() {
    // Re-center the map + marker when the parent pushes a new coordinate
    // (e.g. after re-geocoding). Guarded until the map has finished loading.
    effect(() => {
      const next = this.center();
      if (next && this.mapReady && this.map && this.marker) {
        this.map.setCenter([next.lng, next.lat]);
        this.marker.setLngLat([next.lng, next.lat]);
      }
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const start = this.center() ?? DEFAULT_CENTER;

    const maplibreModule = await import('maplibre-gl');
    const maplibregl: any =
      (maplibreModule as any).default ?? maplibreModule;

    this.map = new maplibregl.Map({
      container: this.mapContainer().nativeElement,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [start.lng, start.lat],
      zoom: 16,
      attributionControl: false,
    });

    this.map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right',
    );
    this.map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    );

    this.marker = new maplibregl.Marker({ draggable: true, color: '#16a34a' })
      .setLngLat([start.lng, start.lat])
      .addTo(this.map);

    // Dragging the marker is the primary interaction; clicking the map is a
    // convenience that re-positions the marker to the clicked point.
    this.marker.on('dragend', () => this.emitFromMarker());
    this.map.on('click', (event: any) => {
      this.marker.setLngLat(event.lngLat);
      this.emitFromMarker();
    });

    this.map.on('load', () => {
      this.mapReady = true;
      this.loading.set(false);
      // Ensure correct sizing after the container transitions into view.
      this.map.resize();
    });
  }

  private emitFromMarker(): void {
    const lngLat = this.marker.getLngLat();
    this.located.emit({ lat: lngLat.lat, lng: lngLat.lng });
  }

  ngOnDestroy(): void {
    try {
      this.marker?.remove?.();
      this.map?.remove?.();
    } catch {
      // MapLibre can throw if the WebGL context was already lost — ignore.
    }
    this.marker = null;
    this.map = null;
  }
}
