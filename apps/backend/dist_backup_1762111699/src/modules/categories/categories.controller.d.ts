import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto, CategoryQueryDto } from './dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class CategoriesController {
    private readonly categoriesService;
    private readonly responseService;
    constructor(categoriesService: CategoriesService, responseService: ResponseService);
    create(createCategoryDto: CreateCategoryDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(query: CategoryQueryDto): Promise<import("../../common").ErrorResponse | import("../../common").PaginatedResponse<unknown> | import("../../common").SuccessResponse<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>>;
    findOne(id: number, includeInactive?: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: number, updateCategoryDto: UpdateCategoryDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    remove(id: number, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
}
