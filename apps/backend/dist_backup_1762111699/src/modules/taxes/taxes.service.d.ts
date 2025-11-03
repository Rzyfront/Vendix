import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaxCategoryDto, UpdateTaxCategoryDto, TaxCategoryQueryDto } from './dto';
export declare class TaxesService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createTaxCategoryDto: CreateTaxCategoryDto, user: any): Promise<any>;
    findAll(query: TaxCategoryQueryDto): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: number, user: any): Promise<any>;
    update(id: number, updateTaxCategoryDto: UpdateTaxCategoryDto, user: any): Promise<any>;
    remove(id: number, user: any): Promise<any>;
    private validateStoreAccess;
}
