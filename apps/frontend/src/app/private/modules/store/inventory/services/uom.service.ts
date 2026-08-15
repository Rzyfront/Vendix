import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { TenantCacheRegistry } from '../../../../../core/services/tenant-cache-registry.service';

export type UomDimension = 'mass' | 'volume' | 'length' | 'count';

export interface UnitOfMeasure {
  id: number;
  code: string;
  name: string;
  dimension: UomDimension;
  is_base: boolean;
  factor_to_base: string | number;
  /**
   * Si la unidad puede ser la unidad de STOCK de un producto. El inventario es
   * `Int` en la unidad base, así que una unidad con factor no entero —la
   * pulgada son 25,4 mm— perdería mercancía en cada conversión. Sirve como
   * unidad de compra o de presentación, nunca de stock. El backend rechaza lo
   * contrario con `PROD_UOM_NOT_STOCK_ELIGIBLE`.
   */
  is_stock_eligible?: boolean;
  is_active: boolean;
}

/** Etiqueta en español de cada dimensión, para agrupar los selectores. */
export const UOM_DIMENSION_LABELS: Record<UomDimension, string> = {
  mass: 'Peso',
  volume: 'Volumen',
  length: 'Longitud',
  count: 'Conteo',
};

export interface UomApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

/**
 * Units of Measure service (Fase UoM).
 *
 * The catalog is global / read-only and changes very rarely (only when
 * the Vendix team adds a new base unit). It is cached for the lifetime of
 * the app via shareReplay(1) so every UoM dropdown in product / recipe
 * forms hits the same Observable without re-hitting the backend.
 *
 * Pattern reference: `vendix-frontend-cache` — instance-level
 * shareReplay TTL cache with a single shared Observable.
 */
@Injectable({
  providedIn: 'root',
})
export class UomService {
  private readonly baseUrl = `${environment.apiUrl}/store/uom`;
  private catalog$: Observable<UomApiResponse<UnitOfMeasure[]>> | null = null;
  private readonly tenantCacheRegistry = inject(TenantCacheRegistry);

  constructor(private http: HttpClient) {
    // QUI-563 Fase 2: aunque el catálogo de UoM es global en diseño, el
    // endpoint `/store/uom` corre bajo el scope del RequestContextService,
    // así que si dos tiendas tienen un override de UoM distinto, el cache
    // a nivel de app mostraría la respuesta de la tienda anterior. Mejor
    // evictar en cada switch.
    this.tenantCacheRegistry.register(
      'store-uom-catalog',
      () => this.invalidate(),
      'UomService',
    );
  }

  getCatalog(forceReload = false): Observable<UomApiResponse<UnitOfMeasure[]>> {
    if (!this.catalog$ || forceReload) {
      this.catalog$ = this.http
        .get<UomApiResponse<UnitOfMeasure[]>>(this.baseUrl)
        .pipe(
          tap(() => {/* cache hit */}),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.catalog$;
  }

  /**
   * Synchronous helper: returns the cached Observable or `null` if it has
   * not been fetched yet. Useful for components that want to render a
   * default selection on first paint without subscribing.
   */
  peekCatalog(): Observable<UomApiResponse<UnitOfMeasure[]>> | null {
    return this.catalog$;
  }

  /**
   * Invalidates the cached catalog. Call after admin UoM seed changes
   * (none yet — the seed is immutable at runtime — but exposed for
   * symmetry with other cache services in this module).
   */
  invalidate(): void {
    this.catalog$ = null;
  }
}
