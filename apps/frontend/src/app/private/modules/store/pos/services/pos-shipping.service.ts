import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { StoreContextService } from '../../../../../core/services/store-context.service';
import {
  PosShippingMethod,
  PosShippingOption,
} from '../models/shipping.model';

@Injectable({
  providedIn: 'root',
})
export class PosShippingService {
  private readonly apiUrl = `${environment.apiUrl}/shipping`;

  constructor(
    private http: HttpClient,
    private storeContextService: StoreContextService,
  ) {}

  getShippingMethods(): Observable<PosShippingMethod[]> {
    return this.http.get<any>(`${this.apiUrl}/methods`).pipe(
      map((response) => {
        const methods = response.data || response;
        if (Array.isArray(methods)) {
          return methods.filter((m: PosShippingMethod) => m.is_active);
        }
        return [];
      }),
      catchError((error) => {
        console.warn('Error fetching shipping methods:', error);
        return of([]);
      }),
    );
  }

  calculateShipping(
    items: Array<{ product_id: number; quantity: number; weight?: number; price: number }>,
    address: {
      country_code: string;
      state_province?: string;
      city?: string;
      address_line1?: string;
    },
  ): Observable<PosShippingOption[]> {
    const storeId = this.storeContextService.getStoreIdOrThrow();

    return this.http
      .post<any>(`${this.apiUrl}/calculate?store_id=${storeId}`, {
        items,
        address,
      })
      .pipe(
        map((response) => {
          const options = response.data || response;
          return Array.isArray(options) ? options : [];
        }),
        catchError((error) => {
          console.warn('Error calculating shipping:', error);
          return of([]);
        }),
      );
  }
}
