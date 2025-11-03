import { PrismaService } from '../../prisma/prisma.service';
import { CreateStoreDto, UpdateStoreDto, StoreQueryDto, UpdateStoreSettingsDto, StoreDashboardDto } from './dto';
export declare class StoresService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createStoreDto: CreateStoreDto): Promise<any>;
    findAll(query: StoreQueryDto): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: number): Promise<any>;
    update(id: number, updateStoreDto: UpdateStoreDto): Promise<any>;
    remove(id: number): Promise<any>;
    updateStoreSettings(storeId: number, settingsDto: UpdateStoreSettingsDto): Promise<any>;
    getDashboard(id: number, query: StoreDashboardDto): Promise<{
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
    }>;
    getGlobalDashboard(): Promise<{
        total_stores: any;
        active_stores: any;
        inactive_stores: any;
        suspended_stores: any;
        draft_stores: any;
        total_revenue: any;
        total_orders: any;
        total_products: any;
    }>;
}
