export declare enum AddressStatus {
    ACTIVE = "active",
    INACTIVE = "inactive"
}
export declare enum AddressType {
    BILLING = "billing",
    SHIPPING = "shipping",
    HEADQUARTERS = "headquarters",
    BRANCH_OFFICE = "branch_office",
    WAREHOUSE = "warehouse",
    LEGAL = "legal",
    STORE_PHYSICAL = "store_physical"
}
export declare class CreateAddressDto {
    address_line_1: string;
    address_line_2?: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
    type?: AddressType;
    customer_id?: number;
    store_id?: number;
    organization_id?: number;
    user_id?: number;
    is_primary?: boolean;
    latitude?: string;
    longitude?: string;
    landmark?: string;
    delivery_instructions?: string;
    status?: AddressStatus;
}
declare const UpdateAddressDto_base: import("@nestjs/mapped-types").MappedType<Partial<CreateAddressDto>>;
export declare class UpdateAddressDto extends UpdateAddressDto_base {
}
export declare class AddressQueryDto {
    page?: number;
    limit?: number;
    search?: string;
    customer_id?: number;
    store_id?: number;
    type?: AddressType;
    status?: AddressStatus;
    is_primary?: boolean;
    city?: string;
    state?: string;
    country?: string;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    include_inactive?: boolean;
}
export declare class UpdateGPSCoordinatesDto {
    latitude: string;
    longitude: string;
}
export {};
