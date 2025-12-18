export interface CreateTransactionDto {
  productId: number;
  variantId?: number;
  type:
    | 'stock_in'
    | 'sale'
    | 'return'
    | 'adjustment_damage'
    | 'initial'
    | 'stock_out'
    | 'transfer'
    | 'damage'
    | 'expiration';
  quantityChange: number;
  reason?: string;
  transactionDate?: Date;
  userId?: number;
  orderItemId?: number;
}

export interface TransactionQueryDto {
  variantId?: number;
  type?:
    | 'stock_in'
    | 'sale'
    | 'return'
    | 'adjustment_damage'
    | 'initial'
    | 'stock_out'
    | 'transfer'
    | 'damage'
    | 'expiration';
  userId?: number;
  startDate?: Date;
  endDate?: Date;
  offset?: number;
  limit?: number;
}

export interface InventoryTransaction {
  id: number;
  product_id: number;
  product_variant_id: number | null;
  user_id: number | null;
  order_item_id: number | null;
  type: 'stock_in' | 'sale' | 'return' | 'adjustment_damage' | 'initial';
  notes: string | null;
  transaction_date: Date;
  quantity_change: number;
  created_at: Date;
  products?: {
    id: number;
    name: string;
    sku: string | null;
  };
  product_variants?: {
    id: number;
    sku: string;
  } | null;
  users?: {
    id: number;
    username: string;
    first_name: string | null;
    last_name: string | null;
  } | null;
  order_items?: {
    id: number;
    quantity: number;
    unit_price: number;
  } | null;
}

export interface TransactionHistoryResponse {
  transactions: InventoryTransaction[];
  total: number;
  hasMore: boolean;
}

export interface TransactionSummary {
  type: string;
  totalQuantity: number;
  transactionCount: number;
}
