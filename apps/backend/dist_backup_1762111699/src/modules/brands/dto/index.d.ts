export declare enum BrandStatus {
    ACTIVE = "active",
    INACTIVE = "inactive"
}
export declare class CreateBrandDto {
    name: string;
    description?: string;
    slug?: string;
    store_id: number;
    logo_url?: string;
    website_url?: string;
    meta_title?: string;
    meta_description?: string;
    sort_order?: number;
    is_featured?: boolean;
    status?: BrandStatus;
}
declare const UpdateBrandDto_base: import("@nestjs/mapped-types").MappedType<Partial<CreateBrandDto>>;
export declare class UpdateBrandDto extends UpdateBrandDto_base {
    store_id?: number;
}
export declare class BrandQueryDto {
    page?: number;
    limit?: number;
    search?: string;
    store_id?: number;
    status?: BrandStatus;
    is_featured?: boolean;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    include_inactive?: boolean;
}
export {};
