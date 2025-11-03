import { PrismaService } from '../../prisma/prisma.service';
import { CreateBrandDto, UpdateBrandDto, BrandQueryDto } from './dto';
export declare class BrandsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createBrandDto: CreateBrandDto, user: any): Promise<any>;
    findAll(query: BrandQueryDto): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findByStore(storeId: number, query: BrandQueryDto): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: number, options?: {
        includeInactive?: boolean;
    }): Promise<any>;
    findBySlug(slug: string, storeId: number, options?: {
        includeInactive?: boolean;
    }): Promise<any>;
    activate(id: number, user: any): Promise<any>;
    deactivate(id: number, user: any): Promise<any>;
    update(id: number, updateBrandDto: UpdateBrandDto, user: any): Promise<any>;
    remove(id: number, user: any): Promise<void>;
    private validateUniqueName;
}
