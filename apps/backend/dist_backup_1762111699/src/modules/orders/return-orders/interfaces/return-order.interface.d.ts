export interface ReturnOrder {
    id: number;
    organization_id: number;
    store_id: number;
    customer_id: number;
    order_id?: number;
    return_number: string;
    status: 'requested' | 'approved' | 'received' | 'processed' | 'refunded' | 'rejected' | 'cancelled';
    return_date: Date;
    received_date?: Date;
    processed_date?: Date;
    refund_date?: Date;
    reason: 'defective' | 'wrong_item' | 'damaged_shipping' | 'customer_dissatisfaction' | 'expired' | 'other';
    notes?: string;
    internal_notes?: string;
    refund_method?: 'original_payment' | 'store_credit' | 'cash' | 'bank_transfer';
    refund_amount?: number;
    tax_refund_amount?: number;
    restocking_fee?: number;
    created_by: number;
    approved_by?: number;
    approved_at?: Date;
    received_by?: number;
    processed_by?: number;
    refunded_by?: number;
    created_at: Date;
    updated_at: Date;
}
export interface ReturnOrderItem {
    id: number;
    return_order_id: number;
    order_item_id?: number;
    product_id: number;
    product_variant_id?: number;
    quantity_returned: number;
    quantity_received: number;
    quantity_approved: number;
    return_reason: 'defective' | 'wrong_item' | 'damaged_shipping' | 'customer_dissatisfaction' | 'expired' | 'other';
    condition_on_return: 'new' | 'used' | 'damaged' | 'defective' | 'missing_parts';
    refund_amount?: number;
    restock: boolean;
    notes?: string;
    created_at: Date;
    updated_at: Date;
}
export interface CreateReturnOrderDto {
    customer_id: number;
    order_id?: number;
    reason: 'defective' | 'wrong_item' | 'damaged_shipping' | 'customer_dissatisfaction' | 'expired' | 'other';
    notes?: string;
    internal_notes?: string;
    refund_method?: 'original_payment' | 'store_credit' | 'cash' | 'bank_transfer';
    items: {
        order_item_id?: number;
        product_id: number;
        product_variant_id?: number;
        quantity_returned: number;
        return_reason: 'defective' | 'wrong_item' | 'damaged_shipping' | 'customer_dissatisfaction' | 'expired' | 'other';
        condition_on_return: 'new' | 'used' | 'damaged' | 'defective' | 'missing_parts';
        refund_amount?: number;
        restock: boolean;
        notes?: string;
    }[];
}
export interface UpdateReturnOrderDto {
    status?: 'requested' | 'approved' | 'received' | 'processed' | 'refunded' | 'rejected' | 'cancelled';
    received_date?: Date;
    processed_date?: Date;
    refund_date?: Date;
    notes?: string;
    internal_notes?: string;
    refund_method?: 'original_payment' | 'store_credit' | 'cash' | 'bank_transfer';
    refund_amount?: number;
    tax_refund_amount?: number;
    restocking_fee?: number;
}
export interface ReturnOrderQueryDto {
    page?: number;
    limit?: number;
    status?: 'requested' | 'approved' | 'received' | 'processed' | 'refunded' | 'rejected' | 'cancelled';
    customer_id?: number;
    order_id?: number;
    store_id?: number;
    reason?: 'defective' | 'wrong_item' | 'damaged_shipping' | 'customer_dissatisfaction' | 'expired' | 'other';
    return_date_from?: Date;
    return_date_to?: Date;
    refund_amount_min?: number;
    refund_amount_max?: number;
    search?: string;
    sort_by?: 'return_date' | 'refund_amount' | 'created_at';
    sort_order?: 'asc' | 'desc';
}
