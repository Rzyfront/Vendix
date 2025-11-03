export declare enum CategoryStatus {
    ACTIVE = "active",
    INACTIVE = "inactive"
}
export declare class CreateCategoryDto {
    name: string;
    description?: string;
    slug?: string;
    store_id: number;
    parent_id?: number;
    image_url?: string;
    meta_title?: string;
    meta_description?: string;
    meta_keywords?: string[];
    sort_order?: number;
    is_featured?: boolean;
    status?: CategoryStatus;
}
declare const UpdateCategoryDto_base: import("@nestjs/mapped-types").MappedType<Partial<CreateCategoryDto>>;
export declare class UpdateCategoryDto extends UpdateCategoryDto_base {
    store_id?: number;
}
export declare class CategoryQueryDto {
    page?: number;
    limit?: number;
    search?: string;
    store_id?: number;
    parent_id?: number;
    status?: CategoryStatus;
    is_featured?: boolean;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    include_inactive?: boolean;
}
export declare class AssignProductToCategoryDto {
    product_id: number;
    sort_order?: number;
}
export declare class CategoryTreeDto {
    id: number;
    name: string;
    slug: string;
    description?: string;
    image_url?: string;
    is_featured: boolean;
    sort_order: number;
    status: CategoryStatus;
    children?: CategoryTreeDto[];
    product_count?: number;
}
export {};
