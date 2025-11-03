import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { SalesOrderQueryDto } from './dto/sales-order-query.dto';
import { sales_order_status_enum } from '@prisma/client';
export declare class SalesOrdersService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createSalesOrderDto: CreateSalesOrderDto): Promise<any>;
    findAll(query: SalesOrderQueryDto): any;
    findByStatus(status: sales_order_status_enum, query: SalesOrderQueryDto): any;
    findByCustomer(customerId: number, query: SalesOrderQueryDto): any;
    findOne(id: number): any;
    update(id: number, updateSalesOrderDto: UpdateSalesOrderDto): Promise<any>;
    confirm(id: number): Promise<any>;
    ship(id: number, items: Array<{
        id: number;
        quantity_shipped: number;
    }>): Promise<any>;
    invoice(id: number): Promise<any>;
    cancel(id: number): Promise<any>;
    remove(id: number): any;
    private reserveStock;
    private releaseStock;
    private updateStockLevel;
}
