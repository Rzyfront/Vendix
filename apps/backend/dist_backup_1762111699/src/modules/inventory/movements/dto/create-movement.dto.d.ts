import { movement_type_enum } from '@prisma/client';
export declare class CreateMovementDto {
    product_id: number;
    product_variant_id?: number;
    from_location_id: number;
    to_location_id?: number;
    movement_type: movement_type_enum;
    quantity: number;
    unit_cost?: number;
    reference_number?: string;
    reason: string;
    notes?: string;
    batch_number?: string;
    serial_number?: string;
    expiration_date?: string;
}
