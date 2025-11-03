import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto, UpdateOrderDto, OrderQueryDto } from './dto';
export declare class OrdersService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createOrderDto: CreateOrderDto, creatingUser: any): Promise<any>;
    findAll(query: OrderQueryDto): Promise<{
        data: any;
        pagination: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: number): Promise<any>;
    update(id: number, updateOrderDto: UpdateOrderDto): Promise<any>;
    remove(id: number): Promise<any>;
    private generateOrderNumber;
}
