export declare class CreateTransferItemDto {
    product_id: number;
    product_variant_id?: number;
    quantity_requested: number;
    cost_per_unit?: number;
    notes?: string;
}
export declare class CreateTransferDto {
    from_location_id: number;
    to_location_id: number;
    expected_completion_date?: Date;
    notes?: string;
    internal_notes?: string;
    items: CreateTransferItemDto[];
}
