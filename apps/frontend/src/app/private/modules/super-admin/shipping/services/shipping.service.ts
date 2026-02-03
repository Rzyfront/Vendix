import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import {
  ShippingMethod,
  ShippingZone,
  ShippingRate,
  ShippingMethodStats,
  ShippingZoneStats,
} from '../interfaces/shipping.interface';
import { environment } from '../../../../../../environments/environment';

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let shippingMethodStatsCache: CacheEntry<Observable<ShippingMethodStats>> | null = null;
let shippingZoneStatsCache: CacheEntry<Observable<ShippingZoneStats>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class ShippingService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/admin/shipping`;
  private readonly CACHE_TTL = 30000; // 30 segundos

  // --- METHODS ---
  getMethods(): Observable<ShippingMethod[]> {
    return this.http.get<ShippingMethod[]>(`${this.apiUrl}/methods`);
  }

  getMethodStats(): Observable<ShippingMethodStats> {
    const now = Date.now();

    if (shippingMethodStatsCache && (now - shippingMethodStatsCache.lastFetch) < this.CACHE_TTL) {
      return shippingMethodStatsCache.observable;
    }

    const observable$ = this.http
      .get<ShippingMethodStats>(`${this.apiUrl}/methods/stats`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        tap(() => {
          if (shippingMethodStatsCache) {
            shippingMethodStatsCache.lastFetch = Date.now();
          }
        }),
      );

    shippingMethodStatsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
  }

  createMethod(data: Partial<ShippingMethod>): Observable<ShippingMethod> {
    return this.http.post<ShippingMethod>(`${this.apiUrl}/methods`, data);
  }

  updateMethod(id: number, data: Partial<ShippingMethod>): Observable<ShippingMethod> {
    return this.http.patch<ShippingMethod>(`${this.apiUrl}/methods/${id}`, data);
  }

  deleteMethod(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/methods/${id}`);
  }

  // --- ZONES ---
  getZones(): Observable<ShippingZone[]> {
    return this.http.get<ShippingZone[]>(`${this.apiUrl}/zones`);
  }

  getZoneStats(): Observable<ShippingZoneStats> {
    const now = Date.now();

    if (shippingZoneStatsCache && (now - shippingZoneStatsCache.lastFetch) < this.CACHE_TTL) {
      return shippingZoneStatsCache.observable;
    }

    const observable$ = this.http
      .get<ShippingZoneStats>(`${this.apiUrl}/zones/stats`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        tap(() => {
          if (shippingZoneStatsCache) {
            shippingZoneStatsCache.lastFetch = Date.now();
          }
        }),
      );

    shippingZoneStatsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
  }

  createZone(data: Partial<ShippingZone>): Observable<ShippingZone> {
    return this.http.post<ShippingZone>(`${this.apiUrl}/zones`, data);
  }

  updateZone(id: number, data: Partial<ShippingZone>): Observable<ShippingZone> {
    return this.http.patch<ShippingZone>(`${this.apiUrl}/zones/${id}`, data);
  }

  deleteZone(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/zones/${id}`);
  }

  // --- RATES ---
  getRates(zoneId: number): Observable<ShippingRate[]> {
    return this.http.get<ShippingRate[]>(`${this.apiUrl}/zones/${zoneId}/rates`);
  }

  createRate(data: Partial<ShippingRate>): Observable<ShippingRate> {
    return this.http.post<ShippingRate>(`${this.apiUrl}/rates`, data);
  }

  updateRate(id: number, data: Partial<ShippingRate>): Observable<ShippingRate> {
    return this.http.patch<ShippingRate>(`${this.apiUrl}/rates/${id}`, data);
  }

  deleteRate(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/rates/${id}`);
  }

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar métodos o zonas de envío
   */
  invalidateCache(): void {
    shippingMethodStatsCache = null;
    shippingZoneStatsCache = null;
  }
}
