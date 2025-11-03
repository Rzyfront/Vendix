export declare enum OrganizationState {
    ACTIVE = "active",
    INACTIVE = "inactive",
    SUSPENDED = "suspended",
    ARCHIVED = "archived"
}
export declare class CreateOrganizationDto {
    name: string;
    slug?: string;
    legal_name?: string;
    tax_id?: string;
    email: string;
    phone?: string;
    website?: string;
    logo_url?: string;
    description?: string;
    state?: OrganizationState;
}
export declare class UpdateOrganizationDto {
    name?: string;
    slug?: string;
    legal_name?: string;
    tax_id?: string;
    email?: string;
    phone?: string;
    website?: string;
    logo_url?: string;
    description?: string;
    state?: OrganizationState;
}
export declare class OrganizationQueryDto {
    page?: number;
    limit?: number;
    search?: string;
    state?: OrganizationState;
}
export declare class AddUserToOrganizationDto {
    user_id: number;
    role_id: number;
    permissions?: any;
}
export declare class OrganizationDashboardDto {
    start_date?: Date;
    end_date?: Date;
}
export declare class UsersDashboardDto {
    store_id?: string;
    search?: string;
    role?: string;
    page?: number;
    limit?: number;
    include_inactive?: boolean;
}
export declare class AdminOrganizationQueryDto {
    page?: number;
    limit?: number;
    search?: string;
    status?: OrganizationState;
    is_active?: boolean;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
}
export declare class OrganizationsDashboardStatsDto {
    total_organizations: number;
    active: number;
    inactive: number;
    suspended: number;
}
