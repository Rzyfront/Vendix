import { purchase_order_status_enum } from '@prisma/client';
export declare class PurchaseOrderItemDto {
    product_id: number;
    product_variant_id?: number;
    quantity: number;
    unit_price: number;
    discount_percentage?: number;
    tax_rate?: number;
    expected_delivery_date?: string;
    notes?: string;
}
export declare class CreatePurchaseOrderDto {
    supplier_id: number;
    location_id: number;
    status?: purchase_order_status_enum;
    expected_delivery_date?: string;
    payment_terms?: string;
    shipping_method?: string;
    shipping_cost?: number;
    tax_amount?: number;
    discount_amount?: number;
    notes?: string;
    internal_reference?: string;
    supplier_reference?: string;
    items: PurchaseOrderItemDto[];
}
