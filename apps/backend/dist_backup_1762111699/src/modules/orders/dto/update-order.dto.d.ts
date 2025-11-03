import { CreateOrderDto } from './create-order.dto';
import { order_state_enum, payments_state_enum } from '@prisma/client';
declare const UpdateOrderDto_base: import("@nestjs/mapped-types").MappedType<Partial<CreateOrderDto>>;
export declare class UpdateOrderDto extends UpdateOrderDto_base {
    status?: order_state_enum;
    payment_status?: payments_state_enum;
    shipped_at?: string;
    delivered_at?: string;
    estimated_delivery_date?: string;
}
export {};
