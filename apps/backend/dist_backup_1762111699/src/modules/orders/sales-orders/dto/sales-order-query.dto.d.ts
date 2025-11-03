import { sales_order_status_enum } from '@prisma/client';
export declare class SalesOrderQueryDto {
    organization_id?: number;
    store_id?: number;
    customer_id?: number;
    location_id?: number;
    status?: sales_order_status_enum;
    payment_status?: string;
    start_date?: string;
    end_date?: string;
    search?: string;
    min_total?: number;
    max_total?: number;
}
