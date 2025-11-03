import { AdminStoresService } from './admin-stores.service';
import { CreateStoreDto, UpdateStoreDto, AdminStoreQueryDto } from '../stores/dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class AdminStoresController {
    private readonly adminStoresService;
    private readonly responseService;
    constructor(adminStoresService: AdminStoresService, responseService: ResponseService);
    create(createStoreDto: CreateStoreDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(query: AdminStoreQueryDto): Promise<import("../../common").ErrorResponse | import("../../common").PaginatedResponse<unknown> | import("../../common").SuccessResponse<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>>;
    getDashboardStats(): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        totalStores: any;
        activeStores: any;
        storesByType: any;
        storesByState: any;
        recentStores: any;
    }>>;
    findOne(id: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: string, updateStoreDto: UpdateStoreDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    remove(id: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
}
