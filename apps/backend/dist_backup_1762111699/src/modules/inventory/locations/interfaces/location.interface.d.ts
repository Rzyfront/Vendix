export interface Location {
    id: number;
    organization_id: number;
    store_id?: number;
    name: string;
    code: string;
    type: 'warehouse' | 'store' | 'production_area' | 'receiving_area' | 'shipping_area' | 'quarantine' | 'damaged_goods';
    is_active: boolean;
    address_id?: number;
    created_at: Date;
    updated_at: Date;
}
export interface CreateLocationRequest {
    name: string;
    code: string;
    type: Location['type'];
    store_id?: number;
    address_id?: number;
}
export interface UpdateLocationRequest {
    name?: string;
    code?: string;
    type?: Location['type'];
    is_active?: boolean;
    store_id?: number;
    address_id?: number;
}
export interface LocationQuery {
    store_id?: number;
    type?: Location['type'];
    is_active?: boolean;
    search?: string;
}
