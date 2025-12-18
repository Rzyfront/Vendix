import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export interface Customer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  organization_id: number;
  state: 'active' | 'inactive' | 'suspended';
  created_at: string;
  updated_at: string;
  addresses?: CustomerAddress[];
}

export interface CustomerAddress {
  id: number;
  customer_id: number;
  address_line1: string;
  address_line2?: string;
  city: string;
  state_province: string;
  country_code: string;
  postal_code: string;
  is_primary: boolean;
}

export interface CustomerSearchRequest {
  search?: string;
  store_id?: number;
  organization_id?: number;
  state?: 'active' | 'inactive' | 'suspended';
  page?: number;
  limit?: number;
  sort_by?: 'first_name' | 'last_name' | 'email' | 'created_at';
  sort_order?: 'asc' | 'desc';
}

export interface CustomerSearchResponse {
  data: Customer[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable({
  providedIn: 'root',
})
export class CustomersService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  searchCustomers(
    request: CustomerSearchRequest,
  ): Observable<CustomerSearchResponse> {
    const params = new HttpParams();

    if (request.search) params.set('search', request.search);
    if (request.store_id) params.set('store_id', request.store_id.toString());
    if (request.organization_id)
      params.set('organization_id', request.organization_id.toString());
    if (request.state) params.set('state', request.state);
    if (request.page) params.set('page', request.page.toString());
    if (request.limit) params.set('limit', request.limit.toString());
    if (request.sort_by) params.set('sort_by', request.sort_by);
    if (request.sort_order) params.set('sort_order', request.sort_order);

    return this.http.get<CustomerSearchResponse>(
      `${this.baseUrl}/organization/customers`,
      {
        params,
      },
    );
  }

  getCustomerById(id: number): Observable<Customer> {
    return this.http.get<Customer>(
      `${this.baseUrl}/organization/customers/${id}`,
    );
  }

  getCustomerAddresses(customerId: number): Observable<CustomerAddress[]> {
    return this.http.get<CustomerAddress[]>(
      `${this.baseUrl}/organization/customers/${customerId}/addresses`,
    );
  }

  // Método para obtener clientes frecuentes de una tienda
  getFrequentCustomers(
    store_id: number,
    limit: number = 10,
  ): Observable<Customer[]> {
    return this.searchCustomers({
      store_id,
      state: 'active',
      sort_by: 'created_at',
      sort_order: 'desc',
      limit,
    }).pipe(map((response) => response.data));
  }

  // Método para buscar clientes por nombre o email
  searchCustomersByNameOrEmail(
    search: string,
    store_id?: number,
    limit: number = 20,
  ): Observable<Customer[]> {
    return this.searchCustomers({
      search,
      store_id,
      state: 'active',
      sort_by: 'first_name',
      sort_order: 'asc',
      limit,
    }).pipe(map((response) => response.data));
  }
}
