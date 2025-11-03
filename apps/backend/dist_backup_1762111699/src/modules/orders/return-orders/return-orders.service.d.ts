import { PrismaService } from '../../../prisma/prisma.service';
import { CreateReturnOrderDto } from './dto/create-return-order.dto';
import { UpdateReturnOrderDto } from './dto/update-return-order.dto';
import { ReturnOrderQueryDto } from './dto/return-order-query.dto';
import { return_order_status_enum } from '@prisma/client';
export declare class ReturnOrdersService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createReturnOrderDto: CreateReturnOrderDto): Promise<any>;
    findAll(query: ReturnOrderQueryDto): any;
    findByStatus(status: return_order_status_enum, query: ReturnOrderQueryDto): any;
    findByType(type: 'refund' | 'replacement' | 'credit', query: ReturnOrderQueryDto): any;
    findByPartner(partnerId: number, query: ReturnOrderQueryDto): any;
    findOne(id: number): any;
    update(id: number, updateReturnOrderDto: UpdateReturnOrderDto): Promise<any>;
    process(id: number, items: Array<{
        id: number;
        action: string;
        location_id?: number;
    }>): Promise<any>;
    cancel(id: number): Promise<any>;
    remove(id: number): any;
    private restockItem;
    private writeOffItem;
    private repairItem;
    private generateReturnNumber;
    private updateStockLevel;
}
