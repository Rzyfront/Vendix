import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantConfig } from '../../../../core/models/tenant-config.interface';
import { TenantFacade } from '../../../../core/store';

export interface UserProfile {
    id: number;
    email: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    document_type: string | null;
    document_number: string | null;
    avatar_url: string | null;
    created_at: string;
}

export interface Address {
    id: number;
    address_line1: string;
    address_line2: string | null;
    city: string;
    state_province: string | null;
    country_code: string;
    postal_code: string | null;
    phone_number: string | null;
    is_primary: boolean;
}

export interface Order {
    id: number;
    order_number: string;
    state: string;
    grand_total: number;
    currency: string;
    created_at: string;
    placed_at: string | null;
    completed_at: string | null;
    item_count: number;
}

export interface OrderDetail extends Order {
    subtotal_amount: number;
    discount_amount: number;
    tax_amount: number;
    shipping_cost: number;
    shipping_address: any;
    items: {
        id: number;
        product_name: string;
        variant_sku: string | null;
        variant_attributes: any;
        quantity: number;
        unit_price: number;
        total_price: number;
        image_url: string | null;
    }[];
    payments: {
        id: number;
        amount: number;
        state: string;
        method: string | null;
        paid_at: string | null;
    }[];
}

@Injectable({
    providedIn: 'root',
})
export class AccountService {
    private api_url = '/api/ecommerce/account';

    constructor(
        private http: HttpClient,
        private domain_service: TenantFacade,
    ) { }

    private getHeaders(): HttpHeaders {
        const domain_config = this.domain_service.getCurrentTenantConfig();
        return new HttpHeaders({
            'x-store-id': domain_config?.store?.id?.toString() || '',
        });
    }

    getProfile(): Observable<{ success: boolean; data: UserProfile }> {
        return this.http.get<{ success: boolean; data: UserProfile }>(this.api_url, {
            headers: this.getHeaders(),
        });
    }

    updateProfile(data: Partial<UserProfile>): Observable<{ success: boolean; data: UserProfile }> {
        return this.http.put<{ success: boolean; data: UserProfile }>(this.api_url, data, {
            headers: this.getHeaders(),
        });
    }

    changePassword(current_password: string, new_password: string): Observable<{ success: boolean; message: string }> {
        return this.http.post<{ success: boolean; message: string }>(
            `${this.api_url}/change-password`,
            { current_password, new_password },
            { headers: this.getHeaders() },
        );
    }

    getOrders(page = 1, limit = 10): Observable<{ success: boolean; data: Order[]; meta: any }> {
        return this.http.get<{ success: boolean; data: Order[]; meta: any }>(
            `${this.api_url}/orders?page=${page}&limit=${limit}`,
            { headers: this.getHeaders() },
        );
    }

    getOrderDetail(order_id: number): Observable<{ success: boolean; data: OrderDetail }> {
        return this.http.get<{ success: boolean; data: OrderDetail }>(
            `${this.api_url}/orders/${order_id}`,
            { headers: this.getHeaders() },
        );
    }

    getAddresses(): Observable<{ success: boolean; data: Address[] }> {
        return this.http.get<{ success: boolean; data: Address[] }>(
            `${this.api_url}/addresses`,
            { headers: this.getHeaders() },
        );
    }

    createAddress(address: Omit<Address, 'id'>): Observable<{ success: boolean; data: Address }> {
        return this.http.post<{ success: boolean; data: Address }>(
            `${this.api_url}/addresses`,
            address,
            { headers: this.getHeaders() },
        );
    }

    deleteAddress(address_id: number): Observable<{ success: boolean; message: string }> {
        return this.http.delete<{ success: boolean; message: string }>(
            `${this.api_url}/addresses/${address_id}`,
            { headers: this.getHeaders() },
        );
    }
}
