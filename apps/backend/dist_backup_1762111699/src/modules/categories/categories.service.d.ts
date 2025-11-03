import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto, CategoryQueryDto } from './dto';
export declare class CategoriesService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createCategoryDto: CreateCategoryDto, user: any): Promise<any>;
    findAll(query: CategoryQueryDto): Promise<{
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
    update(id: number, updateCategoryDto: UpdateCategoryDto, user: any): Promise<any>;
    remove(id: number, user: any): Promise<void>;
    private validateStoreAccess;
    private validateUniqueSlug;
}
