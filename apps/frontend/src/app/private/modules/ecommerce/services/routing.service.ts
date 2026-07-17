import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';

/** Punto geográfico que alimenta el motor de ruteo por calles (OSRM). */
export interface RoutingWaypoint {
  lat: number;
  lng: number;
}

/**
 * Geometría de la ruta devuelta por el proxy OSRM. Es un GeoJSON `LineString`
 * (muchos puntos siguiendo las vías reales), no la línea recta entre paradas.
 */
export interface RouteGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

/** Respuesta del proxy de ruteo por calles. */
export interface DirectionsResult {
  /** Polilínea por calles (GeoJSON LineString). Vacía si el proxy no resolvió. */
  geometry: RouteGeometry | null;
  /** Distancia total de la ruta por vías, en metros. */
  distance_m: number;
  /** Tiempo estimado de manejo (ETA), en segundos. */
  duration_s: number;
  /** `true` cuando la respuesta vino de la caché Redis del backend. */
  cached: boolean;
}

/**
 * Cliente de ruteo por calles. Llama SOLO a nuestro backend proxy
 * (`GET /ecommerce/routing/directions`), nunca a OSRM directo, así la caché
 * Redis, el rate-limit y el User-Agent se mantienen server-side (mismo patrón
 * que {@link GeocodingService} con Nominatim). El backend a su vez hace proxy
 * al OSRM público keyless y devuelve la geometría por calles + ETA.
 *
 * El orden de las paradas lo decide el caller (optimizador nearest-neighbor);
 * este servicio solo dibuja el trazo por vías entre los waypoints en el orden
 * dado y reporta distancia/ETA.
 */
@Injectable({ providedIn: 'root' })
export class RoutingService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantFacade);
  private readonly api_url = `${environment.apiUrl}/ecommerce/routing`;

  private getHeaders(): HttpHeaders {
    const storeId = this.tenant.getCurrentDomainConfig()?.store_id;
    return new HttpHeaders({
      'x-store-id': storeId?.toString() || '',
    });
  }

  /**
   * Traza la ruta por calles entre los waypoints (mínimo 2). El string de coords
   * usa el formato nativo de OSRM: `lng,lat;lng,lat;...` (lng primero).
   * Emite `{ geometry: null, distance_m: 0, duration_s: 0, cached: false }`
   * cuando hay menos de 2 waypoints — el caller debe caer a línea recta.
   */
  getDirections(waypoints: RoutingWaypoint[]): Observable<DirectionsResult> {
    if (!waypoints || waypoints.length < 2) {
      return of(EMPTY_RESULT);
    }
    // OSRM espera `lng,lat` separados por `;` — mismo orden que el backend.
    const coords = waypoints
      .map((w) => `${w.lng},${w.lat}`)
      .join(';');
    const params = new HttpParams().set('coords', coords);

    return this.http
      .get<DirectionsResult | { success: boolean; data: DirectionsResult }>(
        `${this.api_url}/directions`,
        { headers: this.getHeaders(), params },
      )
      .pipe(
        map((res) => {
          const payload =
            res && typeof res === 'object' && 'data' in res
              ? (res as { data: DirectionsResult }).data
              : (res as DirectionsResult);
          return payload;
        }),
      );
  }
}

const EMPTY_RESULT: DirectionsResult = {
  geometry: null,
  distance_m: 0,
  duration_s: 0,
  cached: false,
};