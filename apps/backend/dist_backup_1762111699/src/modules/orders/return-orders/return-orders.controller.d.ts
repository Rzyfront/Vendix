import { ReturnOrdersService } from './return-orders.service';
import { CreateReturnOrderDto } from './dto/create-return-order.dto';
import { UpdateReturnOrderDto } from './dto/update-return-order.dto';
import { ReturnOrderQueryDto } from './dto/return-order-query.dto';
export declare class ReturnOrdersController {
    private readonly returnOrdersService;
    constructor(returnOrdersService: ReturnOrdersService);
    create(createReturnOrderDto: CreateReturnOrderDto): Promise<any>;
    findAll(query: ReturnOrderQueryDto): any;
    findDrafts(query: ReturnOrderQueryDto): any;
    findProcessed(query: ReturnOrderQueryDto): any;
    findPurchaseReturns(query: ReturnOrderQueryDto): any;
    findSalesReturns(query: ReturnOrderQueryDto): any;
    findByPartner(partnerId: string, query: ReturnOrderQueryDto): any;
    findOne(id: string): any;
    update(id: string, updateReturnOrderDto: UpdateReturnOrderDto): Promise<any>;
    process(id: string, processData: {
        items: Array<{
            id: number;
            action: string;
            location_id?: number;
        }>;
    }): Promise<any>;
    cancel(id: string): Promise<any>;
    remove(id: string): any;
}
