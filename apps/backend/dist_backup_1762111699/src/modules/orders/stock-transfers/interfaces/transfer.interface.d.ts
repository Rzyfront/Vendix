export interface StockTransfer {
    id: number;
    organization_id: number;
    transfer_number: string;
    from_location_id: number;
    to_location_id: number;
    status: 'draft' | 'approved' | 'in_transit' | 'completed' | 'cancelled';
    transfer_date?: Date;
    expected_completion_date?: Date;
    actual_completion_date?: Date;
    notes?: string;
    internal_notes?: string;
    created_by: number;
    approved_by?: number;
    approved_at?: Date;
    completed_by?: number;
    completed_at?: Date;
    created_at: Date;
    updated_at: Date;
}
export interface StockTransferItem {
    id: number;
    stock_transfer_id: number;
    product_id: number;
    product_variant_id?: number;
    quantity_requested: number;
    quantity_shipped: number;
    quantity_received: number;
    cost_per_unit?: number;
    notes?: string;
    created_at: Date;
    updated_at: Date;
}
export interface CreateTransferDto {
    from_location_id: number;
    to_location_id: number;
    expected_completion_date?: Date;
    notes?: string;
    internal_notes?: string;
    items: {
        product_id: number;
        product_variant_id?: number;
        quantity_requested: number;
        cost_per_unit?: number;
        notes?: string;
    }[];
}
export interface UpdateTransferDto {
    status?: 'draft' | 'approved' | 'in_transit' | 'completed' | 'cancelled';
    transfer_date?: Date;
    expected_completion_date?: Date;
    actual_completion_date?: Date;
    notes?: string;
    internal_notes?: string;
}
export interface TransferQueryDto {
    page?: number;
    limit?: number;
    status?: 'draft' | 'approved' | 'in_transit' | 'completed' | 'cancelled';
    from_location_id?: number;
    to_location_id?: number;
    transfer_date_from?: Date;
    transfer_date_to?: Date;
    created_by?: number;
    search?: string;
    sort_by?: 'transfer_date' | 'created_at' | 'transfer_number';
    sort_order?: 'asc' | 'desc';
}
