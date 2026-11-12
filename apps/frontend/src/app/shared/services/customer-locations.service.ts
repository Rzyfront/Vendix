import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CustomerAddressPickerAddress } from '../components/customer-address-picker/customer-address-picker.component';

/**
 * Lists the saved locations (shipping addresses) of a customer in the current
 * store. Shared by quotations, dispatch notes, order shipping and other sales
 * documents so all of them offer the same location choices.
 */
@Injectable({ providedIn: 'root' })
export class CustomerLocationsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/addresses`;

  /** Primary location first; empty list on error so forms keep working. */
  listByCustomer(customerId: number): Observable<CustomerAddressPickerAddress[]> {
    const params = new HttpParams()
      .set('customer_id', String(customerId))
      .set('type', 'shipping')
      .set('limit', '100');
    return this.http
      .get<{ data?: CustomerAddressPickerAddress[] }>(this.baseUrl, { params })
      .pipe(
        map((res) => {
          const rows = res?.data ?? [];
          return [...rows].sort(
            (a, b) => Number(!!b.is_primary) - Number(!!a.is_primary),
          );
        }),
        catchError(() => of([] as CustomerAddressPickerAddress[])),
      );
  }
}
