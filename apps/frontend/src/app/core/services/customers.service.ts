import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Customer {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    document_number?: string;
    document_type?: string;
    // Add other fields as needed
}

export interface CreateCustomerDto {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    document_number: string;
    document_type?: string;
}

@Injectable({
    providedIn: 'root',
})
export class CustomersService {
    private apiUrl = `${environment.apiUrl}/store/customers`;

    constructor(private http: HttpClient) { }

    getAll(storeId?: number): Observable<Customer[]> {
        let params = new HttpParams();
        // Assuming backend handles store context via token, but if needed we can pass param.
        // The previous implementation used context token, so params might not be strictly needed for storeId if token has it.
        return this.http.get<Customer[]>(this.apiUrl, { params });
    }

    getById(id: number): Observable<Customer> {
        return this.http.get<Customer>(`${this.apiUrl}/${id}`);
    }

    create(customer: CreateCustomerDto): Observable<Customer> {
        return this.http.post<Customer>(this.apiUrl, customer);
    }

    update(id: number, customer: Partial<CreateCustomerDto>): Observable<Customer> {
        return this.http.patch<Customer>(`${this.apiUrl}/${id}`, customer);
    }

    delete(id: number): Observable<void> {
        return this.http.delete<void>(`${this.apiUrl}/${id}`);
    }
}
