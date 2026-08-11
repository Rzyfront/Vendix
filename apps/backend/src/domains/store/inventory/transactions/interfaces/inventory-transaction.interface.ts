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
  /**
   * Optional explicit organization_id for tenant isolation on inventory_transactions.
   * If omitted, the service resolves it from RequestContextService, falling back to
   * the product's store organization. Required at the DB level (NOT NULL).
   */
  organizationId?: number;
  /**
   * QUI-651 — sesión de la estación de KDS que consumió el insumo.
   *
   * Es un responsable DISTINTO de `userId`: `userId` es quién PIDIÓ que se
   * cocine (el mesero o cajero del POS), `kdsSessionId` es quién COCINÓ. Ambos
   * son reales y ambos se persisten.
   *
   * `undefined`/null es un caso VÁLIDO: el fire consume al disparar, que puede
   * ocurrir antes de que la estación abra sesión.
   */
  kdsSessionId?: number | null;
  /**
   * QUI-651 — costo del movimiento, persistido POR FILA.
   *
   * Antes el costo solo existía en memoria: `StockLevelManager.updateStock` lo
   * devolvía en `cost_snapshot` y nunca lo guardaba. Sin estas dos columnas el
   * historial y el resumen de consumo por turno no se pueden construir, y
   * recomputar en lectura no sirve porque las capas FIFO ya se movieron.
   */
  unitCost?: number | null;
  totalCost?: number | null;
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
