import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { LatLng } from '../../../../../../shared/components/map-view/map-view.component';
import {
  RouteMapViewComponent,
  RouteMapReorderEntry,
} from '../../../../../../shared/components/route-map-view/route-map-view.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { MapStopsResponse } from '../../interfaces/planilla.interface';

/**
 * Route map modal — shows the NOT-delivered stops of a dispatch route on a map,
 * with a suggested (shortest-first) visiting order and a one-click "apply order"
 * action.
 *
 * ## Thin wrapper over {@link RouteMapViewComponent}
 * As of Fase F5 the heavy map logic (markers, optimizer, live driver
 * `watchPosition`, next-stop highlight, unlocated list) lives in the SHARED
 * `RouteMapViewComponent`, reused by both this admin modal and the carrier
 * `/repartos/mapa` page. This component keeps only the modal chrome, the initial
 * `getMapStops(routeId)` fetch, and the ADMIN-only reorder persistence
 * (`reorderStops`): it maps the backend `MapStopsResponse` to the shared
 * component's inputs and persists on `(applyOrder)`.
 *
 * ## Data flow
 * On open it calls `getMapStops(routeId)`; the backend returns ONLY pending /
 * in_progress stops plus a delivered leg and any unlocated stops. Those feed the
 * shared component, which builds `GeoStop[]`, runs the optimizer and paints the
 * map. There is NO client-side filtering of settled stops: after a settle, the
 * reload of `getMapStops` simply omits them.
 *
 * ## Open/close
 * Calqued from the module's canonical modal pattern: the parent guards
 * rendering with `@if (signal())`, this modal hardcodes `[isOpen]="true"` and
 * emits `(close)`. Being recreated on each open means the initial fetch lives
 * cleanly in `ngOnInit`.
 *
 * Public API (unchanged): selector `app-planilla-map-modal`, input `routeId`,
 * outputs `close` / `reordered`.
 *
 * Zoneless-clean: signal input/output, computed state, no legacy CD APIs.
 */
@Component({
  selector: 'app-planilla-map-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, IconComponent, ButtonComponent, RouteMapViewComponent],
  template: `
    <app-modal
      [isOpen]="true"
      title="Mapa de la ruta"
      subtitle="Paradas pendientes y recorrido sugerido"
      size="full"
      (cancel)="close.emit()"
      (closed)="close.emit()"
    >
      <div class="flex h-full flex-col">
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
          <app-route-map-view
            class="block h-full flex-1"
            [stops]="data()?.stops ?? []"
            [delivered]="data()?.delivered ?? []"
            [unlocated]="data()?.unlocated ?? []"
            [origin]="routeOrigin()"
            [fill]="true"
            [readonly]="true"
            [showApplyOrder]="true"
            [applying]="reordering()"
            (applyOrder)="onApplyOrder($event)"
            (addressFixed)="onAddressFixed($event)"
          ></app-route-map-view>
        }
      </div>

      <div slot="footer" class="flex items-center justify-end">
        <app-button variant="outline" size="sm" (clicked)="close.emit()">
          Cerrar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PlanillaMapModalComponent {
  private readonly service = inject(PlanillasRutasService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Route whose pending stops are mapped. */
  readonly routeId = input.required<number>();

  /** Dismiss the modal. */
  readonly close = output<void>();
  /** Emitted after a successful reorder so the parent can reload the detail. */
  readonly reordered = output<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<MapStopsResponse | null>(null);
  /** True while the reorder request is in flight (drives the apply spinner). */
  readonly reordering = signal(false);

  /** Route origin (warehouse) reported by the backend, if any. */
  readonly routeOrigin = computed<LatLng | null>(() => {
    const o = this.data()?.origin;
    return o ? { lat: o.lat, lng: o.lng } : null;
  });

  ngOnInit(): void {
    // The modal is recreated on each open (parent `@if` guard), so the initial
    // fetch lives here — same lifecycle convention as the detail page.
    this.fetch();
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
   * Persist the suggested order emitted by the shared map. `sequence` is already
   * the optimized 1-based position, so it always satisfies the backend contract
   * regardless of the stops' original sequence values.
   */
  onApplyOrder(order: RouteMapReorderEntry[]): void {
    if (this.reordering()) return;
    this.reordering.set(true);
    this.service
      .reorderStops(this.routeId(), order)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.reordering.set(false);
          this.toast.success('Orden de paradas actualizado');
          this.reordered.emit();
          // Reload: settled stops won't come back, and the pins/order refresh.
          this.fetch();
        },
        error: (err: Error) => {
          this.reordering.set(false);
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

  /**
   * Tras corregir la dirección de un stop `unlocated` vía el editor "Fijar en
   * mapa" (el shared `app-route-map-view` emite `addressFixed` con el
   * `dispatchNoteId`): recarga `getMapStops`. El backend re-geocodificar la
   * remisión al PATCHear su `customer_address` (commit f3db91156), as el stop
   * debe reaparecer con coordenadas en `stops[]` y salir de `unlocated[]`.
   */
  onAddressFixed(_noteId: number): void {
    this.fetch();
  }
}
