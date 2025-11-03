import { order_state_enum, payments_state_enum } from '@prisma/client';
export declare class CreateOrderItemDto {
    product_id: number;
    product_variant_id?: number;
    product_name: string;
    variant_sku?: string;
    variant_attributes?: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    tax_rate?: number;
    tax_amount_item?: number;
}
export declare class CreateOrderDto {
    customer_id: number;
    store_id: number;
    order_number?: string;
    status?: order_state_enum;
    payment_status?: payments_state_enum;
    subtotal: number;
    tax_amount?: number;
    shipping_amount?: number;
    discount_amount?: number;
    total_amount: number;
    currency_code?: string;
    billing_address_id?: number;
    shipping_address_id?: number;
    notes?: string;
    estimated_delivery_date?: string;
    items: CreateOrderItemDto[];
}
