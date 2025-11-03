export declare enum StoreType {
    PHYSICAL = "physical",
    ONLINE = "online",
    HYBRID = "hybrid",
    POPUP = "popup",
    KIOSKO = "kiosko"
}
export declare enum StoreState {
    ACTIVE = "active",
    INACTIVE = "inactive",
    SUSPENDED = "suspended",
    ARCHIVED = "archived"
}
export declare class CreateStoreDto {
    organization_id: number;
    name: string;
    slug?: string;
    store_code?: string;
    logo_url?: string;
    color_primary?: string;
    color_secondary?: string;
    domain?: string;
    timezone?: string;
    currency_code?: string;
    operating_hours?: any;
    store_type?: StoreType;
    is_active?: boolean;
    manager_user_id?: number;
}
export declare class UpdateStoreDto {
    name?: string;
    slug?: string;
    store_code?: string;
    logo_url?: string;
    color_primary?: string;
    color_secondary?: string;
    domain?: string;
    timezone?: string;
    currency_code?: string;
    operating_hours?: any;
    store_type?: StoreType;
    is_active?: boolean;
    manager_user_id?: number;
}
export declare class StoreQueryDto {
    page?: number;
    limit?: number;
    search?: string;
    store_type?: StoreType;
    is_active?: boolean;
    organization_id?: number;
}
export declare class AddStaffToStoreDto {
    user_id: number;
    role_id: number;
    permissions?: any;
    hire_date?: string;
    is_active?: boolean;
}
export declare class UpdateStoreSettingsDto {
    settings: any;
}
export declare class StoreDashboardDto {
    start_date?: Date;
    end_date?: Date;
}
export declare class AdminStoreQueryDto {
    page?: number;
    limit?: number;
    search?: string;
    store_type?: StoreType;
    is_active?: boolean;
    organization_id?: number;
}
