import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto, CreateProductVariantDto, UpdateProductVariantDto, ProductImageDto, ProductQueryDto } from './dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class ProductsController {
    private readonly productsService;
    private readonly responseService;
    constructor(productsService: ProductsService, responseService: ResponseService);
    create(createProductDto: CreateProductDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(query: ProductQueryDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").PaginatedResponse<unknown> | import("../../common").SuccessResponse<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>>;
    findOne(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findByStore(storeId: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findBySlug(slug: string, storeId: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: number, updateProductDto: UpdateProductDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    deactivate(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
    remove(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
    createVariant(productId: number, createVariantDto: CreateProductVariantDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    updateVariant(variantId: number, updateVariantDto: UpdateProductVariantDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    removeVariant(variantId: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
    addImage(productId: number, imageDto: ProductImageDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    removeImage(imageId: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
}
