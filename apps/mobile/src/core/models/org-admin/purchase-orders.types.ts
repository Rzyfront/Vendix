import type { ISODateString, MoneyAmount } from './common.types';

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'IN_TRANSIT'
  | 'PARTIAL'
  | 'RECEIVED'
  | 'CANCELLED';

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string;
  store_id: string;
  store_name: string;
  status: PurchaseOrderStatus;
  order_date: ISODateString;
  expected_date?: ISODateString;
  received_date?: ISODateString;
  total_items: number;
  total_quantity: number;
  subtotal: MoneyAmount;
  tax_total: MoneyAmount;
  total: MoneyAmount;
  notes?: string;
  approved_at?: ISODateString;
  approved_by?: string;
  received_at?: ISODateString;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface PurchaseOrderItem {
  id?: string;
  product_id: string;
  product_name?: string;
  product_sku?: string;
  quantity: number;
  received_quantity?: number;
  unit_cost: MoneyAmount;
  discount?: number;
  tax_rate?: number;
  subtotal: MoneyAmount;
  total: MoneyAmount;
}

export interface PurchaseOrderCreate {
  supplier_id: string;
  store_id: string;
  expected_date?: ISODateString;
  notes?: string;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_cost: number;
    tax_rate?: number;
  }>;
}
