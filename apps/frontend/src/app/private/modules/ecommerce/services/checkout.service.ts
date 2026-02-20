import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';

export interface PaymentMethod {
    id: number;
    name: string;
    type: string;
    provider: string;
    processing_mode: 'DIRECT' | 'ONLINE' | 'ON_DELIVERY';
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
    shipping_method_id?: number;
    shipping_rate_id?: number;
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

export interface WhatsappCheckoutResponse extends CheckoutResponse {
    subtotal: number;
    tax: number;
    item_count: number;
    items: Array<{
        name: string;
        variant_sku: string | null;
        quantity: number;
        unit_price: number;
        total_price: number;
    }>;
    customer?: {
        first_name: string;
        last_name: string;
        phone: string | null;
        address: {
            address_line1: string;
            address_line2: string | null;
            city: string;
            state_province: string | null;
            country_code: string;
            postal_code: string | null;
            phone_number: string | null;
        } | null;
    } | null;
}

@Injectable({
    providedIn: 'root',
})
export class CheckoutService {
    private api_url = `${environment.apiUrl}/ecommerce/checkout`;

    constructor(
        private http: HttpClient,
        private domain_service: TenantFacade,
    ) { }

    private getHeaders(): HttpHeaders {
        const domainConfig = this.domain_service.getCurrentDomainConfig();
        const storeId = domainConfig?.store_id;
        return new HttpHeaders({
            'x-store-id': storeId?.toString() || '',
        });
    }

    getPaymentMethods(shippingType?: string): Observable<{ success: boolean; data: PaymentMethod[] }> {
        let params: { [key: string]: string } = {};
        if (shippingType) {
            params['shipping_type'] = shippingType;
        }
        return this.http.get<{ success: boolean; data: PaymentMethod[] }>(
            `${this.api_url}/payment-methods`,
            { headers: this.getHeaders(), params },
        );
    }

    checkout(request: CheckoutRequest): Observable<{ success: boolean; data: CheckoutResponse }> {
        return this.http.post<{ success: boolean; data: CheckoutResponse }>(
            this.api_url,
            request,
            { headers: this.getHeaders() },
        );
    }

    whatsappCheckout(
        notes?: string,
        items?: Array<{ product_id: number; product_variant_id?: number; quantity: number }>,
    ): Observable<{ success: boolean; data: WhatsappCheckoutResponse }> {
        return this.http.post<{ success: boolean; data: WhatsappCheckoutResponse }>(
            `${this.api_url}/whatsapp`,
            { notes, items },
            { headers: this.getHeaders() },
        );
    }
}
