import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';

export interface PaymentMethod {
    id: number;
    name: string;
    type: string;
    provider: string;
    logo_url: string | null;
    min_amount: number | null;
    max_amount: number | null;
}

export interface CheckoutRequest {
    shipping_address_id?: number;
    shipping_address?: {
        address_line1: string;
        address_line2?: string;
        city: string;
        state_province?: string;
        country_code: string;
        postal_code?: string;
        phone_number?: string;
    };
    payment_method_id: number;
    notes?: string;
}

export interface CheckoutResponse {
    order_id: number;
    order_number: string;
    total: number;
    state: string;
    message: string;
}

@Injectable({
    providedIn: 'root',
})
export class CheckoutService {
    private api_url = '/api/ecommerce/checkout';

    constructor(
        private http: HttpClient,
        private domain_service: TenantFacade,
    ) { }

    private getHeaders(): HttpHeaders {
        const storeConfig = this.domain_service.getCurrentStore();
        return new HttpHeaders({
            'x-store-id': storeConfig?.id?.toString() || '',
        });
    }

    getPaymentMethods(): Observable<{ success: boolean; data: PaymentMethod[] }> {
        return this.http.get<{ success: boolean; data: PaymentMethod[] }>(
            `${this.api_url}/payment-methods`,
            { headers: this.getHeaders() },
        );
    }

    checkout(request: CheckoutRequest): Observable<{ success: boolean; data: CheckoutResponse }> {
        return this.http.post<{ success: boolean; data: CheckoutResponse }>(
            this.api_url,
            request,
            { headers: this.getHeaders() },
        );
    }
}
