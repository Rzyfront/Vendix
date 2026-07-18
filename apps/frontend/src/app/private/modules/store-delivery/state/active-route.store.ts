import { Injectable, computed, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RepartosService } from '../services/repartos.service';
import type {
  CarrierActiveRouteResponse,
  CarrierPayout,
  DispatchRoute,
  DispatchRouteStop,
} from '../interfaces/repartos.interface';

/**
 * Estado global (singleton) de la ruta activa del carrier en Vendix Repartos.
 *
 * Es la única fuente de verdad de "mi ruta" para toda la cáscara `/repartos`:
 * el shell dispara `resolve()` al montar, el bottom-nav lee `activeRouteId` y
 * `pendingStopsCount` para el badge, y las páginas F3-F6 (pool/ruta/mapa/sesión)
 * mutan el estado tras cada acción (claim, dispatch, start/settle/release, close)
 * vía `set()` / `refresh()`.
 *
 * Zoneless-safe: todo el estado observado por plantillas vive en signals; los
 * derivados son `computed`. La suscripción HTTP se ata a `takeUntilDestroyed`
 * con el `DestroyRef` del root injector (vive lo que vive la app).
 */
@Injectable({ providedIn: 'root' })
export class ActiveRouteStore {
  private readonly repartosService = inject(RepartosService);
  private readonly destroyRef = inject(DestroyRef);

  /** Ruta activa (draft/dispatched/in_transit) o `null` si no hay ninguna. */
  readonly activeRoute = signal<DispatchRoute | null>(null);
  /** Paradas de la ruta activa. */
  readonly stops = signal<DispatchRouteStop[]>([]);
  /** Payout estimado/ganado del carrier por la ruta. */
  readonly payout = signal<CarrierPayout | null>(null);
  /** Cargando la ruta activa (primera resolución o refresh). */
  readonly loading = signal(false);

  /** True una vez que la primera resolución terminó (con o sin ruta). */
  private readonly resolved = signal(false);

  /** Id de la ruta activa, o `null`. Consumido por el bottom-nav. */
  readonly activeRouteId = computed<number | null>(
    () => this.activeRoute()?.id ?? null,
  );

  /**
   * Paradas aún por atender (pending / in_progress). Alimenta el badge de
   * "Mi Ruta" en el bottom-nav. Las entregadas/rechazadas/liberadas no cuentan.
   */
  readonly pendingStopsCount = computed<number>(
    () =>
      this.stops().filter(
        (s) => s.status === 'pending' || s.status === 'in_progress',
      ).length,
  );

  /**
   * Resolución perezosa: carga la ruta activa la PRIMERA vez que se invoca
   * (idempotente — múltiples montajes del shell no re-piden). Usa `refresh()`
   * para forzar una recarga tras una mutación.
   */
  resolve(): void {
    if (this.resolved() || this.loading()) return;
    this.load();
  }

  /** Fuerza una recarga de la ruta activa desde el backend. */
  refresh(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.repartosService
      .getMyActiveRoute()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.applyResponse(res);
          this.loading.set(false);
          this.resolved.set(true);
        },
        error: () => {
          // El shell no debe romperse por un fallo de red: se marca resuelto
          // y se deja el estado previo. Las páginas F3-F6 muestran su propio
          // error (parseApiError) al accionar.
          this.loading.set(false);
          this.resolved.set(true);
        },
      });
  }

  /**
   * Reemplaza el estado con la respuesta de "mi ruta activa" (usado tras
   * claim/dispatch/settle/release, que ya devuelven la ruta fresca desde F3-F6).
   */
  set(response: CarrierActiveRouteResponse): void {
    this.applyResponse(response);
    this.resolved.set(true);
  }

  private applyResponse(res: CarrierActiveRouteResponse): void {
    this.activeRoute.set(res.route);
    this.stops.set(res.stops ?? []);
    this.payout.set(res.payout ?? null);
  }

  /** Limpia el estado (p. ej. al cerrar la ruta o cerrar sesión). */
  clear(): void {
    this.activeRoute.set(null);
    this.stops.set([]);
    this.payout.set(null);
    this.loading.set(false);
    this.resolved.set(false);
  }
}
