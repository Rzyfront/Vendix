import { location_type_enum } from '@prisma/client';
export declare class LocationQueryDto {
    organization_id?: number;
    store_id?: number;
    type?: location_type_enum;
    is_active?: boolean;
}
