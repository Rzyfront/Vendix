import { TaxesService } from './taxes.service';
import { CreateTaxCategoryDto, UpdateTaxCategoryDto, TaxCategoryQueryDto } from './dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class TaxesController {
    private readonly taxesService;
    private readonly responseService;
    constructor(taxesService: TaxesService, responseService: ResponseService);
    create(createTaxCategoryDto: CreateTaxCategoryDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(query: TaxCategoryQueryDto): Promise<import("../../common").ErrorResponse | import("../../common").PaginatedResponse<unknown> | import("../../common").SuccessResponse<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>>;
    findOne(id: number, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: number, updateTaxCategoryDto: UpdateTaxCategoryDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    remove(id: number, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
}
