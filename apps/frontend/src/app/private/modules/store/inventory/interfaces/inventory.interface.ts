// Inventory Module - Core Interfaces
// Following snake_case for properties as per Context.md

// ============================================================
// SUPPLIER INTERFACES
// ============================================================

export interface Supplier {
    id: number;
    organization_id?: number;
    name: string;
    code: string;
    contact_person?: string;
    email?: string;
    phone?: string;
    mobile?: string;
    website?: string;
    tax_id?: string;
    payment_terms?: string;
    currency?: string;
    lead_time_days?: number;
    notes?: string;
    is_active: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface CreateSupplierDto {
    organization_id?: number;
    name: string;
    code: string;
    contact_person?: string;
    email?: string;
    phone?: string;
    mobile?: string;
    website?: string;
    tax_id?: string;
    payment_terms?: string;
    currency?: string;
    lead_time_days?: number;
    notes?: string;
    is_active?: boolean;
}

export interface UpdateSupplierDto extends Partial<CreateSupplierDto> { }

export interface SupplierQueryDto {
    search?: string;
    is_active?: boolean;
    limit?: number;
    offset?: number;
}

// ============================================================
// ============================================================
// LOCATION INTERFACES
// ============================================================

export type LocationType = 'warehouse' | 'store' | 'virtual' | 'transit';

export interface Address {
    id?: number;
    address_line_1: string;
    address_line_2?: string;
    city: string;
    state: string;
    country: string;
    postal_code: string;
    phone_number?: string;
    type?: string;
    is_primary?: boolean;
}

export interface InventoryLocation {
    id: number;
    organization_id: number;
    store_id?: number;
    name: string;
    code: string;
    type?: LocationType;
    is_active: boolean;
    address_id?: number;
    address?: Address;
    created_at?: string;
    updated_at?: string;
}

export interface CreateLocationDto {
    organization_id?: number;
    store_id?: number;
    name: string;
    code: string;
    type?: LocationType;
    is_active?: boolean;
    address_id?: number;
    address?: Omit<Address, 'id'>;
}

export interface UpdateLocationDto extends Partial<CreateLocationDto> { }

// ============================================================
// PURCHASE ORDER INTERFACES
// ============================================================

export type PurchaseOrderStatus =
    | 'draft'
    | 'submitted'
    | 'approved'
    | 'ordered'
    | 'partial'
    | 'received'
    | 'cancelled';

export interface PurchaseOrderItem {
    id?: number;
    purchase_order_id?: number;
    product_id: number;
    product_variant_id?: number;
    quantity: number;
    quantity_ordered?: number;
    quantity_received?: number;
    unit_price: number;
    unit_cost?: number;
    discount_percentage?: number;
    tax_rate?: number;
    expected_delivery_date?: string;
    notes?: string;
    // Populated fields
    product?: {
        id: number;
        name: string;
        sku?: string;
    };
    products?: {
        id: number;
        name: string;
        sku?: string;
    };
}

export interface PurchaseOrder {
    id: number;
    organization_id: number;
    order_number?: string;
    supplier_id: number;
    location_id: number;
    status: PurchaseOrderStatus;
    order_date?: string;
    expected_date?: string;
    received_date?: string;
    payment_terms?: string;
    shipping_method?: string;
    shipping_cost?: number;
    subtotal_amount?: number;
    tax_amount?: number;
    total_amount?: number;
    discount_amount?: number;
    notes?: string;
    created_by_user_id?: number;
    approved_by_user_id?: number;
    created_at?: string;
    updated_at?: string;
    // Populated fields
    supplier?: Supplier;
    suppliers?: Supplier;
    location?: InventoryLocation;
    items?: PurchaseOrderItem[];
    purchase_order_items?: PurchaseOrderItem[];
}

export interface CreatePurchaseOrderDto {
    organization_id?: number;
    supplier_id: number;
    location_id: number;
    status?: PurchaseOrderStatus;
    order_date?: string;
    expected_date?: string;
    payment_terms?: string;
    shipping_method?: string;
    shipping_cost?: number;
    subtotal_amount?: number;
    tax_amount?: number;
    total_amount?: number;
    discount_amount?: number;
    notes?: string;
    created_by_user_id?: number;
    approved_by_user_id?: number;
    items: CreatePurchaseOrderItemDto[];
}

export interface CreatePurchaseOrderItemDto {
    product_id: number;
    product_variant_id?: number;
    quantity: number;
    unit_price: number;
    discount_percentage?: number;
    tax_rate?: number;
    expected_delivery_date?: string;
    notes?: string;
}

export interface UpdatePurchaseOrderDto extends Partial<CreatePurchaseOrderDto> { }

export interface ReceivePurchaseOrderItemDto {
    id: number;
    quantity_received: number;
}

export interface PurchaseOrderQueryDto {
    status?: PurchaseOrderStatus;
    supplier_id?: number;
    location_id?: number;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
}

// ============================================================
// INVENTORY ADJUSTMENT INTERFACES
// ============================================================

export type AdjustmentType =
    | 'damage'
    | 'loss'
    | 'theft'
    | 'expiration'
    | 'count_variance'
    | 'manual_correction';

export interface InventoryAdjustment {
    id: number;
    organization_id: number;
    product_id: number;
    product_variant_id?: number;
    location_id: number;
    adjustment_type: AdjustmentType;
    quantity_before: number;
    quantity_after: number;
    quantity_change: number;
    reason_code?: string;
    description?: string;
    created_by_user_id?: number;
    approved_by_user_id?: number;
    approved_at?: string;
    created_at?: string;
    // Populated fields
    product?: {
        id: number;
        name: string;
        sku?: string;
    };
    location?: InventoryLocation;
}

export interface CreateAdjustmentDto {
    organization_id: number;
    product_id: number;
    product_variant_id?: number;
    location_id: number;
    type: AdjustmentType;
    quantity_after: number;
    reason_code?: string;
    description?: string;
    created_by_user_id?: number;
    approved_by_user_id?: number;
}

export interface AdjustmentQueryDto {
    organization_id?: number;
    product_id?: number;
    variant_id?: number;
    location_id?: number;
    type?: AdjustmentType;
    status?: 'pending' | 'approved';
    created_by_user_id?: number;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
}

// ============================================================
// INVENTORY MOVEMENT INTERFACES
// ============================================================

export type MovementType =
    | 'inbound'
    | 'outbound'
    | 'transfer'
    | 'adjustment'
    | 'return';

export interface InventoryMovement {
    id: number;
    product_id: number;
    product_variant_id?: number;
    from_location_id: number;
    to_location_id?: number;
    movement_type: MovementType;
    quantity: number;
    unit_cost?: number;
    reference_number?: string;
    reason: string;
    notes?: string;
    batch_number?: string;
    serial_number?: string;
    expiration_date?: string;
    created_at?: string;
    // Populated fields
    product?: {
        id: number;
        name: string;
        sku?: string;
    };
    from_location?: InventoryLocation;
    to_location?: InventoryLocation;
}

export interface CreateMovementDto {
    product_id: number;
    product_variant_id?: number;
    from_location_id: number;
    to_location_id?: number;
    movement_type: MovementType;
    quantity: number;
    unit_cost?: number;
    reference_number?: string;
    reason: string;
    notes?: string;
    batch_number?: string;
    serial_number?: string;
    expiration_date?: string;
}

export interface MovementQueryDto {
    product_id?: number;
    location_id?: number;
    movement_type?: MovementType;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
}

// ============================================================
// STOCK LEVEL INTERFACES
// ============================================================

export interface StockLevel {
    id: number;
    product_id: number;
    product_variant_id?: number;
    location_id: number;
    quantity_on_hand: number;
    quantity_reserved: number;
    quantity_available: number;
    reorder_point?: number;
    reorder_quantity?: number;
    last_counted_at?: string;
    updated_at?: string;
    // Populated fields
    product?: {
        id: number;
        name: string;
        sku?: string;
    };
    location?: InventoryLocation;
}

// ============================================================
// DASHBOARD / STATS INTERFACES
// ============================================================

export interface InventoryStats {
    total_products: number;
    total_stock_value: number;
    low_stock_items: number;
    out_of_stock_items: number;
    pending_orders: number;
    incoming_stock: number;
}

// ============================================================
// API RESPONSE WRAPPERS
// ============================================================

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    has_more: boolean;
}
