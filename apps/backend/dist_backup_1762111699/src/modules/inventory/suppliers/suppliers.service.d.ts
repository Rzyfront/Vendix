import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
export declare class SuppliersService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createSupplierDto: CreateSupplierDto): any;
    findAll(query: SupplierQueryDto): any;
    findActive(query: SupplierQueryDto): any;
    findOne(id: number): any;
    findSupplierProducts(supplierId: number): any;
    update(id: number, updateSupplierDto: UpdateSupplierDto): any;
    remove(id: number): any;
    addProductToSupplier(supplierId: number, productId: number, data: any): Promise<any>;
    removeProductFromSupplier(supplierId: number, productId: number): Promise<any>;
}
