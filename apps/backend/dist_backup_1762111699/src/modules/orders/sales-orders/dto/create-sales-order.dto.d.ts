import { sales_order_status_enum } from '@prisma/client';
export declare class SalesOrderItemDto {
    product_id: number;
    product_variant_id?: number;
    quantity: number;
    unit_price: number;
    discount_percentage?: number;
    tax_rate?: number;
    location_id?: number;
    notes?: string;
}
export declare class CreateSalesOrderDto {
    customer_id?: number;
    customer_email?: string;
    customer_name?: string;
    status?: sales_order_status_enum;
    order_date?: string;
    expected_delivery_date?: string;
    shipping_address_id?: number;
    billing_address_id?: number;
    payment_method?: string;
    payment_status?: string;
    shipping_method?: string;
    shipping_cost?: number;
    tax_amount?: number;
    discount_amount?: number;
    notes?: string;
    internal_reference?: string;
    customer_reference?: string;
    items: SalesOrderItemDto[];
}
