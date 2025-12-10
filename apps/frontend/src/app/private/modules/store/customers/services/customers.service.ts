import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { Customer, CustomerStats, CustomerQueryDto } from '../interfaces';
import { StoreContextService } from '../../../../../core/services/store-context.service';

@Injectable({
  providedIn: 'root',
})
export class CustomersService {
  private readonly http = inject(HttpClient);
  private readonly storeContextService = inject(StoreContextService);
  private readonly API_URL = `${environment.apiUrl}/stores/customers`;

  // BehaviorSubjects para estado real-time
  private customers_subject = new BehaviorSubject<Customer[]>([]);
  private loading_subject = new BehaviorSubject<boolean>(false);
  private stats_subject = new BehaviorSubject<CustomerStats | null>(null);

  customers$ = this.customers_subject.asObservable();
  loading$ = this.loading_subject.asObservable();
  stats$ = this.stats_subject.asObservable();

  /**
   * Get customers with pagination and filtering
   */
  getCustomers(query: CustomerQueryDto): Observable<any> {
    this.loading_subject.next(true);
    return this.http.get<any>(this.API_URL, {
      params: this.buildQueryParams(query),
    });
  }

  /**
   * Get customer by ID
   */
  getCustomerById(id: number): Observable<Customer> {
    return this.http.get<Customer>(`${this.API_URL}/${id}`);
  }

  /**
   * Create new customer
   */
  createCustomer(customerData: any): Observable<Customer> {
    // Store context is automatically handled by backend
    return this.http.post<Customer>(this.API_URL, customerData);
  }

  /**
   * Update existing customer
   */
  updateCustomer(id: number, customerData: any): Observable<Customer> {
    return this.http.patch<Customer>(`${this.API_URL}/${id}`, customerData);
  }

  /**
   * Delete customer (soft delete)
   */
  deleteCustomer(id: number): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/${id}`);
  }

  /**
   * Get customer statistics
   */
  getCustomerStats(): Observable<CustomerStats> {
    return this.http.get<CustomerStats>(`${this.API_URL}/stats`);
  }

  /**
   * Search customers
   */
  searchCustomers(search: string): Observable<any> {
    return this.http.get<any>(`${this.API_URL}/search`, {
      params: { search },
    });
  }

  /**
   * Change customer status
   */
  changeCustomerStatus(id: number, state: any): Observable<Customer> {
    return this.http.patch<Customer>(`${this.API_URL}/${id}/status`, { state });
  }

  /**
   * Build query parameters
   */
  private buildQueryParams(query: CustomerQueryDto): any {
    const params: any = {};

    if (query.page) params.page = query.page;
    if (query.limit) params.limit = query.limit;
    if (query.search) params.search = query.search;
    if (query.state) params.state = query.state;
    if (query.email_verified !== undefined)
      params.email_verified = query.email_verified;
    if (query.created_from)
      params.created_from = query.created_from.toISOString();
    if (query.created_to) params.created_to = query.created_to.toISOString();

    return params;
  }
}
