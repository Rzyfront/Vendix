import { order_state_enum, payments_state_enum } from '@prisma/client';
export declare class OrderQueryDto {
    page?: number;
    limit?: number;
    search?: string;
    status?: order_state_enum;
    payment_status?: payments_state_enum;
    customer_id?: number;
    store_id?: number;
    sort?: string;
    date_from?: string;
    date_to?: string;
}
