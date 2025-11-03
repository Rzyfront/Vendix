import { SalesOrdersService } from './sales-orders.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { SalesOrderQueryDto } from './dto/sales-order-query.dto';
export declare class SalesOrdersController {
    private readonly salesOrdersService;
    constructor(salesOrdersService: SalesOrdersService);
    create(createSalesOrderDto: CreateSalesOrderDto): Promise<any>;
    findAll(query: SalesOrderQueryDto): any;
    findDrafts(query: SalesOrderQueryDto): any;
    findConfirmed(query: SalesOrderQueryDto): any;
    findShipped(query: SalesOrderQueryDto): any;
    findByCustomer(customerId: string, query: SalesOrderQueryDto): any;
    findOne(id: string): any;
    update(id: string, updateSalesOrderDto: UpdateSalesOrderDto): Promise<any>;
    confirm(id: string): Promise<any>;
    ship(id: string, shipData: {
        items: Array<{
            id: number;
            quantity_shipped: number;
        }>;
    }): Promise<any>;
    invoice(id: string): Promise<any>;
    cancel(id: string): Promise<any>;
    remove(id: string): any;
}
