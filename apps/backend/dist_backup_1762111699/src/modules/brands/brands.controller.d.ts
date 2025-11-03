import { BrandsService } from './brands.service';
import { CreateBrandDto, UpdateBrandDto, BrandQueryDto } from './dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class BrandsController {
    private readonly brandsService;
    private readonly responseService;
    constructor(brandsService: BrandsService, responseService: ResponseService);
    create(createBrandDto: CreateBrandDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(query: BrandQueryDto): Promise<import("../../common").ErrorResponse | import("../../common").PaginatedResponse<unknown> | import("../../common").SuccessResponse<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>>;
    findByStore(storeId: number, query: BrandQueryDto): Promise<import("../../common").ErrorResponse | import("../../common").PaginatedResponse<unknown> | import("../../common").SuccessResponse<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>>;
    findOne(id: number, includeInactive?: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findBySlug(slug: string, storeId: number, includeInactive?: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: number, updateBrandDto: UpdateBrandDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    activate(id: number, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    deactivate(id: number, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
    remove(id: number, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
}
