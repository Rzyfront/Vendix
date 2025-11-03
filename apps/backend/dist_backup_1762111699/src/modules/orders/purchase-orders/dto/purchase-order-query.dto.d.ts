import { purchase_order_status_enum } from '@prisma/client';
export declare class PurchaseOrderQueryDto {
    organization_id?: number;
    store_id?: number;
    supplier_id?: number;
    location_id?: number;
    status?: purchase_order_status_enum;
    start_date?: string;
    end_date?: string;
    search?: string;
    min_total?: number;
    max_total?: number;
}
