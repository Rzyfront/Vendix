export declare enum ProductState {
    ACTIVE = "active",
    INACTIVE = "inactive",
    ARCHIVED = "archived"
}
export declare class CreateProductDto {
    store_id: number;
    categoria_id?: number;
    brand_id?: number;
    name: string;
    slug?: string;
    description?: string;
    base_price: number;
    sku?: string;
    stock_quantity?: number;
    state?: ProductState;
    category_ids?: number[];
    tax_category_ids?: number[];
    image_urls?: string[];
}
export declare class UpdateProductDto {
    categoria_id?: number;
    brand_id?: number;
    name?: string;
    slug?: string;
    description?: string;
    base_price?: number;
    sku?: string;
    stock_quantity?: number;
    state?: ProductState;
    category_ids?: number[];
    tax_category_ids?: number[];
    image_urls?: string[];
}
export declare class ProductQueryDto {
    page?: number;
    limit?: number;
    search?: string;
    state?: ProductState;
    store_id?: number;
    category_id?: number;
    brand_id?: number;
    include_inactive?: boolean;
}
export declare class CreateProductVariantDto {
    product_id: number;
    sku: string;
    price_override?: number;
    stock_quantity?: number;
    image_id?: number;
}
export declare class UpdateProductVariantDto {
    sku?: string;
    price_override?: number;
    stock_quantity?: number;
    image_id?: number;
}
export declare class ProductImageDto {
    image_url: string;
    is_main?: boolean;
}
