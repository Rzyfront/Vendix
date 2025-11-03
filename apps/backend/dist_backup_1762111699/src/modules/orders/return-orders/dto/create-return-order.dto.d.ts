export declare class CreateReturnOrderItemDto {
    order_item_id?: number;
    product_id: number;
    product_variant_id?: number;
    quantity_returned: number;
    return_reason: 'defective' | 'wrong_item' | 'damaged_shipping' | 'customer_dissatisfaction' | 'expired' | 'other';
    condition_on_return: 'new' | 'used' | 'damaged' | 'defective' | 'missing_parts';
    refund_amount?: number;
    restock: boolean;
    notes?: string;
}
export declare class CreateReturnOrderDto {
    customer_id: number;
    order_id?: number;
    store_id?: number;
    partner_id?: number;
    type?: 'refund' | 'replacement' | 'credit';
    return_date?: Date;
    total_refund_amount?: number;
    reason: 'defective' | 'wrong_item' | 'damaged_shipping' | 'customer_dissatisfaction' | 'expired' | 'other';
    notes?: string;
    internal_notes?: string;
    refund_method?: 'original_payment' | 'store_credit' | 'cash' | 'bank_transfer';
    items: CreateReturnOrderItemDto[];
}
