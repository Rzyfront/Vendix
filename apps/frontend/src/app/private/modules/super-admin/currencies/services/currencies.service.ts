import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  Currency,
  CreateCurrencyDto,
  UpdateCurrencyDto,
  CurrencyQueryDto,
  CurrencyStats,
  PaginatedCurrenciesResponse,
} from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class CurrenciesService {
  private http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getCurrencies(query: CurrencyQueryDto = {}): Observable<PaginatedCurrenciesResponse> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.state) params = params.set('state', query.state);

    return this.http.get<any>(`${this.apiUrl}/superadmin/currencies`, { params });
  }

  getCurrencyStats(): Observable<CurrencyStats> {
    return this.http.get<any>(`${this.apiUrl}/superadmin/currencies/dashboard`);
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
}
