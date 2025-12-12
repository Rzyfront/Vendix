import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
    Customer,
    CreateCustomerRequest,
    UpdateCustomerRequest,
    CustomerStats,
    CustomerFilters,
} from '../models/customer.model';

export interface PaginatedResponse<T> {
    data: T[];
    meta: {
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
    private apiUrl = `${environment.apiUrl}/store/customers`;

    constructor(private http: HttpClient) { }

    getStats(): Observable<CustomerStats> {
        // Mock implementation until endpoint exists
        return of({
            total_customers: 1250,
            active_customers: 980,
            new_customers_this_month: 45,
            total_revenue: 154000,
        });
        // return this.http.get<CustomerStats>(`${this.apiUrl}/stats`);
    }

    getCustomers(
        page: number = 1,
        limit: number = 10,
        filters?: CustomerFilters
    ): Observable<PaginatedResponse<Customer>> {
        let params = new HttpParams()
            .set('page', page.toString())
            .set('limit', limit.toString());

        if (filters?.search) {
            params = params.set('search', filters.search);
        }

        // Example fitlers
        // if (filters?.state) {
        //   params = params.set('state', filters.state);
        // }

        return this.http.get<PaginatedResponse<Customer>>(this.apiUrl, { params });
    }

    getCustomer(id: number): Observable<Customer> {
        return this.http.get<Customer>(`${this.apiUrl}/${id}`);
    }

    createCustomer(data: CreateCustomerRequest): Observable<Customer> {
        return this.http.post<Customer>(this.apiUrl, data);
    }

    updateCustomer(id: number, data: UpdateCustomerRequest): Observable<Customer> {
        return this.http.patch<Customer>(`${this.apiUrl}/${id}`, data);
    }

    deleteCustomer(id: number): Observable<void> {
        return this.http.delete<void>(`${this.apiUrl}/${id}`);
    }
}
