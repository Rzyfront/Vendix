import { ResponseService } from '../../common/responses/response.service';
import { StoresService } from './stores.service';
import { CreateStoreDto, UpdateStoreDto, StoreQueryDto, UpdateStoreSettingsDto, StoreDashboardDto } from './dto';
export declare class StoresController {
    private readonly storesService;
    private readonly responseService;
    constructor(storesService: StoresService, responseService: ResponseService);
    create(createStoreDto: CreateStoreDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(query: StoreQueryDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").PaginatedResponse<unknown>>;
    getStats(): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        total_stores: any;
        active_stores: any;
        inactive_stores: any;
        suspended_stores: any;
        draft_stores: any;
        total_revenue: any;
        total_orders: any;
        total_products: any;
    }>>;
    findOne(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: number, updateStoreDto: UpdateStoreDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    remove(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
    updateSettings(storeId: number, settingsDto: UpdateStoreSettingsDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    getStoreStats(id: number, query: StoreDashboardDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        store_id: number;
        metrics: {
            total_orders: any;
            total_revenue: any;
            low_stock_products: any;
            active_customers: any;
            revenue_today: number;
            revenue_this_week: unknown;
            average_order_value: number;
        };
        recent_orders: any;
        top_products: any;
        sales_chart: {
            date: string;
            total: unknown;
        }[];
    }>>;
}
