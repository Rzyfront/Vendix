import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import { ResponseService } from '../../../common/responses/response.service';
export declare class PurchaseOrdersController {
    private readonly purchaseOrdersService;
    private readonly responseService;
    constructor(purchaseOrdersService: PurchaseOrdersService, responseService: ResponseService);
    create(createPurchaseOrderDto: CreatePurchaseOrderDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findAll(query: PurchaseOrderQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any> | import("../../../common").PaginatedResponse<unknown>>;
    findDrafts(query: PurchaseOrderQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findApproved(query: PurchaseOrderQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findPending(query: PurchaseOrderQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findBySupplier(supplierId: string, query: PurchaseOrderQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findOne(id: string): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    update(id: string, updatePurchaseOrderDto: UpdatePurchaseOrderDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    approve(id: string): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    cancel(id: string): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    receive(id: string, receiveData: {
        items: Array<{
            id: number;
            quantity_received: number;
        }>;
    }): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    remove(id: string): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<null>>;
}
