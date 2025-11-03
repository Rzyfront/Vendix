export declare class ReturnOrderQueryDto {
    page?: number;
    limit?: number;
    status?: 'draft' | 'requested' | 'approved' | 'received' | 'processed' | 'refunded' | 'rejected' | 'cancelled';
    customer_id?: number;
    order_id?: number;
    product_id?: number;
    partner_id?: number;
    store_id?: number;
    reason?: 'defective' | 'wrong_item' | 'damaged_shipping' | 'customer_dissatisfaction' | 'expired' | 'other';
    return_date_from?: Date;
    return_date_to?: Date;
    refund_amount_min?: number;
    refund_amount_max?: number;
    type?: 'refund' | 'replacement' | 'credit';
    search?: string;
    sort_by?: 'return_date' | 'refund_amount' | 'created_at';
    sort_order?: 'asc' | 'desc';
}
