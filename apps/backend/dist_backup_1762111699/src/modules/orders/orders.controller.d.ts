import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderDto, OrderQueryDto } from './dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class OrdersController {
    private readonly ordersService;
    private readonly responseService;
    constructor(ordersService: OrdersService, responseService: ResponseService);
    create(createOrderDto: CreateOrderDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(query: OrderQueryDto): Promise<import("../../common").ErrorResponse | import("../../common").PaginatedResponse<unknown> | import("../../common").SuccessResponse<{
        data: any;
        pagination: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>>;
    findOne(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: number, updateOrderDto: UpdateOrderDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    remove(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
}
