import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import { purchase_order_status_enum } from '@prisma/client';
export declare class PurchaseOrdersService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createPurchaseOrderDto: CreatePurchaseOrderDto): Promise<any>;
    findAll(query: PurchaseOrderQueryDto): any;
    findByStatus(status: purchase_order_status_enum, query: PurchaseOrderQueryDto): any;
    findPending(query: PurchaseOrderQueryDto): any;
    findBySupplier(supplierId: number, query: PurchaseOrderQueryDto): any;
    findOne(id: number): any;
    update(id: number, updatePurchaseOrderDto: UpdatePurchaseOrderDto): Promise<any>;
    approve(id: number): Promise<any>;
    cancel(id: number): Promise<any>;
    receive(id: number, items: Array<{
        id: number;
        quantity_received: number;
    }>): Promise<any>;
    remove(id: number): any;
    private updateStockLevel;
}
