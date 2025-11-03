export declare class TransferQueryDto {
    page?: number;
    limit?: number;
    status?: 'draft' | 'approved' | 'in_transit' | 'completed' | 'cancelled';
    from_location_id?: number;
    to_location_id?: number;
    transfer_date_from?: Date;
    transfer_date_to?: Date;
    created_by?: number;
    product_id?: number;
    search?: string;
    sort_by?: 'transfer_date' | 'created_at' | 'transfer_number';
    sort_order?: 'asc' | 'desc';
}
