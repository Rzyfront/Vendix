import { movement_type_enum } from '@prisma/client';
export declare class MovementQueryDto {
    organization_id?: number;
    store_id?: number;
    product_id?: number;
    product_variant_id?: number;
    from_location_id?: number;
    to_location_id?: number;
    movement_type?: movement_type_enum;
    user_id?: number;
    start_date?: string;
    end_date?: string;
    search?: string;
}
