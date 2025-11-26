export interface SalesOrder {
  id: number;
  orderNumber: string;
  customerId: number;
  storeId: number;
  status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'INVOICED' | 'CANCELLED';
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  expectedDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  customer?: Customer;
  store?: Store;
  items?: SalesOrderItem[];
}

export interface SalesOrderItem {
  id: number;
  salesOrderId: number;
  productId: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  product?: Product;
}

export interface PurchaseOrder {
  id: number;
  orderNumber: string;
  supplierId: number;
  locationId: number;
  status: 'draft' | 'sent' | 'received' | 'cancelled';
  totalAmount: number;
  expectedDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  supplier?: Supplier;
  location?: InventoryLocation;
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: number;
  purchaseOrderId: number;
  productId: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  product?: Product;
}

export interface StockTransfer {
  id: number;
  transferNumber: string;
  fromLocationId: string;
  toLocationId: string;
  status: 'PENDING' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
  expectedDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  fromLocation?: InventoryLocation;
  toLocation?: InventoryLocation;
  items?: StockTransferItem[];
}

export interface StockTransferItem {
  id: number;
  stockTransferId: number;
  productId: number;
  quantity: number;
  notes?: string;
  product?: Product;
}

// Interfaces auxiliares
export interface Customer {
  id: number;
  name: string;
  email: string;
  phone?: string;
}

export interface Supplier {
  id: number;
  name: string;
  email: string;
  phone?: string;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  price: number;
  stock: number;
  description?: string;
}

export interface Store {
  id: number;
  name: string;
}

export interface InventoryLocation {
  id: string;
  name: string;
  type: string;
  address?: string;
  isActive?: boolean;
}

// Interfaces para creación/actualización
export interface CreateSalesOrderRequest {
  customer_id: number;
  location_id: number;
  expected_date?: string;
  notes?: string;
  items: {
    product_id: number;
    quantity: number;
    unit_price: number;
  }[];
}

export interface CreatePurchaseOrderRequest {
  supplier_id: number;
  location_id: number;
  expected_date?: string;
  notes?: string;
  items: {
    product_id: number;
    quantity: number;
    unit_price: number;
  }[];
}

export interface CreateStockTransferRequest {
  fromLocationId: string;
  toLocationId: string;
  expectedDate?: string;
  notes?: string;
  items: {
    productId: string;
    quantity: number;
    notes?: string;
  }[];
}
