import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  Currency,
  CreateCurrencyDto,
  UpdateCurrencyDto,
  CurrencyQueryDto,
  CurrencyStats,
  PaginatedCurrenciesResponse,
} from '../interfaces';

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let currenciesStatsCache: CacheEntry<Observable<CurrencyStats>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class CurrenciesService {
  private http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000; // 30 segundos

  getCurrencies(query: CurrencyQueryDto = {}): Observable<PaginatedCurrenciesResponse> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.state) params = params.set('state', query.state);

    return this.http.get<any>(`${this.apiUrl}/superadmin/currencies`, { params });
  }

  getCurrencyStats(): Observable<CurrencyStats> {
    const now = Date.now();

    if (currenciesStatsCache && (now - currenciesStatsCache.lastFetch) < this.CACHE_TTL) {
      return currenciesStatsCache.observable;
    }

    const observable$ = this.http
      .get<any>(`${this.apiUrl}/superadmin/currencies/dashboard`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        tap(() => {
          if (currenciesStatsCache) {
            currenciesStatsCache.lastFetch = Date.now();
          }
        }),
      );

    currenciesStatsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
  }

  getCurrencyByCode(code: string): Observable<Currency> {
    return this.http.get<any>(`${this.apiUrl}/superadmin/currencies/${code}`);
  }

  createCurrency(currencyData: CreateCurrencyDto): Observable<Currency> {
    return this.http.post<any>(`${this.apiUrl}/superadmin/currencies`, currencyData);
  }

  updateCurrency(code: string, currencyData: UpdateCurrencyDto): Observable<Currency> {
    return this.http.patch<any>(`${this.apiUrl}/superadmin/currencies/${code}`, currencyData);
  }

  activateCurrency(code: string): Observable<Currency> {
    return this.http.post<any>(`${this.apiUrl}/superadmin/currencies/${code}/activate`, {});
  }

  deactivateCurrency(code: string): Observable<Currency> {
    return this.http.post<any>(`${this.apiUrl}/superadmin/currencies/${code}/deactivate`, {});
  }

  deprecateCurrency(code: string): Observable<Currency> {
    return this.http.post<any>(`${this.apiUrl}/superadmin/currencies/${code}/deprecate`, {});
  }

  deleteCurrency(code: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/superadmin/currencies/${code}`);
  }

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar monedas
   */
  invalidateCache(): void {
    currenciesStatsCache = null;
  }
}
