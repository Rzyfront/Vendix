export declare enum TaxStatus {
    ACTIVE = "active",
    INACTIVE = "inactive"
}
export declare enum TaxType {
    PERCENTAGE = "percentage",
    FIXED = "fixed"
}
export declare class CreateTaxCategoryDto {
    name: string;
    description?: string;
    type: TaxType;
    rate: number;
    store_id: number;
    organization_id?: number;
    is_inclusive?: boolean;
    is_compound?: boolean;
    sort_order?: number;
    status?: TaxStatus;
}
declare const UpdateTaxCategoryDto_base: import("@nestjs/mapped-types").MappedType<Partial<CreateTaxCategoryDto>>;
export declare class UpdateTaxCategoryDto extends UpdateTaxCategoryDto_base {
    store_id?: number;
    organization_id?: number;
}
export declare class TaxCategoryQueryDto {
    page?: number;
    limit?: number;
    search?: string;
    store_id?: number;
    organization_id?: number;
    type?: TaxType;
    status?: TaxStatus;
    is_inclusive?: boolean;
    is_compound?: boolean;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    include_inactive?: boolean;
}
export declare class TaxCalculationDto {
    subtotal: number;
    store_id: number;
    product_id?: number;
    shipping_address_id?: number;
}
export declare class TaxCalculationResultDto {
    subtotal: number;
    total_tax: number;
    total_amount: number;
    tax_breakdown: {
        tax_category_id: number;
        name: string;
        type: TaxType;
        rate: number;
        is_inclusive: boolean;
        is_compound: boolean;
        tax_amount: number;
    }[];
}
export {};
