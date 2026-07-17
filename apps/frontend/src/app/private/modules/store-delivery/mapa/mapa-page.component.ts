import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  EmptyStateComponent,
  IconComponent,
  ToastService,
} from '../../../../shared/components/index';
import {
  RouteMapViewComponent,
  RouteMapStop,
  RouteMapUnlocatedStop,
  RouteMapReorderEntry,
} from '../../../../shared/components/route-map-view/route-map-view.component';
import { ActiveRouteStore } from '../state/active-route.store';
import { RepartosService } from '../services/repartos.service';
import type { DispatchRouteStop } from '../interfaces/repartos.interface';
import type { DispatchDeliveryAddress } from '../../store/planillas-rutas/interfaces/planilla.interface';

/**
 * Fase F5 — Mapa (`/repartos/mapa`), pestaña 3 de Vendix Repartos.
 *
 * Guía al repartidor (rol `carrier`, app_type STORE_DELIVERY) parada por parada
 * con GPS vivo, reusando el motor de mapa compartido {@link RouteMapViewComponent}
 * (map-view + optimizer + watchPosition), el MISMO que usa el modal admin de
 * planillas — sin duplicar la lógica de markers/ruta/GPS.
 *
 * ## Origen de datos
 * A diferencia del lado admin (que pide `/store/dispatch-routes/:id/map-stops`,
 * bloqueado para el carrier por el `DomainScopeGuard`), esta página NO hace fetch
 * de mapa: lee las paradas de `ActiveRouteStore.stops()` (la ruta activa ya
 * hidratada por el shell) y deriva las coordenadas de cada parada desde el
 * snapshot de dirección del pedido — `dispatch_note.customer_address` (con
 * fallback a `order.shipping_address_snapshot`), donde el checkout guardó
 * `latitude`/`longitude`. Las paradas sin coordenadas se listan como "sin
 * ubicación" bajo el mapa.
 *
 * El motor compartido resuelve por sí mismo el GPS vivo del repartidor
 * (`watchPosition`, con `clearWatch` en destroy — crítico al cambiar de pestaña),
 * el aviso ámbar cuando el GPS está denegado / en contexto inseguro (HTTPS
 * obligatorio) y la "Próxima parada" del recorrido óptimo.
 *
 * ## Reordenar (Vendix Repartos F9)
 * El botón "Aplicar orden óptimo" está HABILITADO en el lado carrier: el
 * backend B7/B8 expone `POST /store/carrier/route/reorder` (resuelto por JWT)
 * y `RepartosService.reorderStops` lo consume. Al confirmar, el motor emite el
 * orden sugerido (`RouteMapReorderEntry[]`), esta página lo persiste y refresca
 * el `ActiveRouteStore` para reflejar el nuevo `stop_sequence` en todo `/repartos`.
 *
 * Zoneless-safe: todo el estado observado por la plantilla vive en signals del
 * `ActiveRouteStore`; los derivados de mapa son `computed`.
 */
@Component({
  selector: 'app-mapa-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent, IconComponent, RouteMapViewComponent],
  template: `
    <div class="mapa-shell">
      @if (loading() && !route()) {
        <div class="flex-1 flex items-center justify-center gap-2 text-text-secondary">
          <app-icon name="loader-2" [size]="18" [spin]="true"></app-icon>
          <span class="text-sm">Cargando tu ruta…</span>
        </div>
      } @else if (!route()) {
        <!-- Sin ruta activa → CTA al pool -->
        <div class="flex-1 flex items-center justify-center p-4">
          <app-empty-state
            icon="map-pin"
            title="No tienes una ruta activa"
            description="Toma pedidos del pool para armar tu ruta y ver el mapa de tu recorrido."
            actionButtonText="Ir al pool"
            actionButtonIcon="package"
            [showActionButton]="true"
            (actionClick)="goToPool()"
          ></app-empty-state>
        </div>
      } @else if (!hasAnyMappableStop()) {
        <!-- Ruta activa pero sin paradas ubicables -->
        <div class="flex-1 flex items-center justify-center p-4">
          <app-empty-state
            icon="map-pin"
            title="Sin paradas para mapear"
            description="Tu ruta aún no tiene paradas con dirección ubicable en el mapa."
            [showActionButton]="false"
          ></app-empty-state>
        </div>
      } @else {
        <div class="map-wrap">
          <app-route-map-view
            class="block h-full"
            [stops]="mapStops()"
            [delivered]="mapDelivered()"
            [unlocated]="mapUnlocated()"
            [origin]="null"
            [fill]="true"
            [readonly]="true"
            [showApplyOrder]="true"
            [applying]="applying()"
            (applyOrder)="onApplyOrder($event)"
          ></app-route-map-view>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      .mapa-shell {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        padding: 12px;
      }
      /* Floor via dvh so the map is usable even if the height:100% chain from
         the delivery shell does not resolve; flex-grow expands it when it does. */
      .map-wrap {
        flex: 1 1 auto;
        min-height: 60dvh;
      }
    `,
  ],
})
export class MapaPageComponent {
  private readonly store = inject(ActiveRouteStore);
  private readonly router = inject(Router);
  private readonly repartosService = inject(RepartosService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Estado leído del store (single source of truth) ────────────────────────
  readonly route = this.store.activeRoute;
  readonly stops = this.store.stops;
  readonly loading = this.store.loading;

  /** Guardando el reorden (deshabilita/gira el botón "Aplicar orden óptimo"). */
  readonly applying = signal(false);

  ngOnInit(): void {
    // Resolución perezosa idempotente: si el shell ya cargó la ruta esto es un
    // no-op; si el carrier abrió `/repartos/mapa` directo, carga aquí.
    this.store.resolve();
  }

  // ── Derivación de paradas mapeables desde el store ──────────────────────────

  /** Paradas pendientes CON coordenadas → entrada del optimizer / pines. */
  readonly mapStops = computed<RouteMapStop[]>(() =>
    this.stops()
      .filter((s) => s.status === 'pending' || s.status === 'in_progress')
      .map((s) => this.toLocatedStop(s))
      .filter((s): s is RouteMapStop => s !== null),
  );

  /** Paradas entregadas CON coordenadas → tramo verde "hecho". */
  readonly mapDelivered = computed<RouteMapStop[]>(() =>
    this.stops()
      .filter((s) => s.status === 'delivered')
      .map((s) => this.toLocatedStop(s))
      .filter((s): s is RouteMapStop => s !== null),
  );

  /** Paradas pendientes SIN coordenadas → listadas bajo el mapa. */
  readonly mapUnlocated = computed<RouteMapUnlocatedStop[]>(() =>
    this.stops()
      .filter(
        (s) =>
          (s.status === 'pending' || s.status === 'in_progress') &&
          this.coordsOf(this.resolveAddress(s)) === null,
      )
      .map((s) => ({
        stopId: s.id,
        sequence: s.stop_sequence,
        customerName: s.dispatch_note?.customer_name ?? null,
        addressText: this.addressText(this.resolveAddress(s)),
      })),
  );

  /** True si hay al menos una parada ubicable (pendiente o entregada). */
  readonly hasAnyMappableStop = computed<boolean>(
    () => this.mapStops().length > 0 || this.mapDelivered().length > 0,
  );

  goToPool(): void {
    this.router.navigate(['/repartos/pool']);
  }

  /**
   * Persiste el orden sugerido del mapa (Vendix Repartos F9). Reordena SOLO las
   * paradas pending de mi ruta activa vía `reorderStops`; al éxito refresca el
   * store para que el nuevo `stop_sequence` se refleje en todas las páginas de
   * `/repartos`. Guard anti-doble-tap con el signal `applying`.
   */
  onApplyOrder(entries: RouteMapReorderEntry[]): void {
    if (this.applying()) return;
    this.applying.set(true);
    this.repartosService
      .reorderStops(entries)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.applying.set(false);
          this.store.refresh();
          this.toast.success('Paradas reordenadas');
        },
        error: (err) => {
          this.applying.set(false);
          this.toast.error(err?.message ?? 'No se pudo reordenar la ruta');
        },
      });
  }

  // ── Helpers de dirección/coordenadas ────────────────────────────────────────

  /**
   * Snapshot de dirección de la parada: el de la remisión primero (inmutable al
   * momento del pedido), con fallback al snapshot de envío de la orden. Mismo
   * criterio que la página "Mi Ruta".
   */
  private resolveAddress(
    stop: DispatchRouteStop,
  ): DispatchDeliveryAddress | null {
    const note = stop.dispatch_note;
    return (
      note?.customer_address ?? note?.order?.shipping_address_snapshot ?? null
    );
  }

  /** Coordenadas finitas de una dirección, o `null` si faltan/son inválidas. */
  private coordsOf(
    address: DispatchDeliveryAddress | null,
  ): { lat: number; lng: number } | null {
    if (!address) return null;
    const lat = address.latitude;
    const lng = address.longitude;
    if (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng)
    ) {
      return { lat, lng };
    }
    return null;
  }

  /** Texto de dirección legible (línea 1 + ciudad + depto), o `null`. */
  private addressText(address: DispatchDeliveryAddress | null): string | null {
    if (!address) return null;
    const parts = [
      address.address_line1 ?? address.line1 ?? address.address,
      address.city,
      address.state_province,
    ]
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0);
    return parts.length > 0 ? parts.join(', ') : null;
  }

  /** Convierte una parada del store a `RouteMapStop`, o `null` si no tiene coords. */
  private toLocatedStop(stop: DispatchRouteStop): RouteMapStop | null {
    const address = this.resolveAddress(stop);
    const coords = this.coordsOf(address);
    if (!coords) return null;
    return {
      stopId: stop.id,
      sequence: stop.stop_sequence,
      status: stop.status,
      customerName: stop.dispatch_note?.customer_name ?? null,
      addressText: this.addressText(address),
      lat: coords.lat,
      lng: coords.lng,
    };
  }
}
