import { PrismaService } from '../../prisma/prisma.service';
import { CreateStoreDto, UpdateStoreDto, AdminStoreQueryDto } from '../stores/dto';
export declare class AdminStoresService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createStoreDto: CreateStoreDto): Promise<any>;
    findAll(query: AdminStoreQueryDto): Promise<{
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
    getDashboardStats(): Promise<{
        totalStores: any;
        activeStores: any;
        storesByType: any;
        storesByState: any;
        recentStores: any;
    }>;
}
