import { location_type_enum } from '@prisma/client';
export declare class CreateLocationDto {
    organization_id: number;
    store_id?: number;
    name: string;
    code: string;
    type?: location_type_enum;
    is_active?: boolean;
    address_id?: number;
}
