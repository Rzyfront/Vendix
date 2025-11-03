import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit';
import { CreateProductDto, UpdateProductDto } from './dto';
export declare class ProductsService {
    private prisma;
    private auditService;
    constructor(prisma: PrismaService, auditService: AuditService);
    create(createProductDto: CreateProductDto, userId: number): Promise<any>;
    update(id: number, updateProductDto: UpdateProductDto, userId: number): Promise<any>;
    remove(id: number, userId: number): Promise<any>;
    findOne(id: number): Promise<any>;
}
