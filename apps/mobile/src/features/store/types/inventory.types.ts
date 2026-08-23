export interface StockAdjustment {
  id: number;
  organization_id: number;
  product_id: number;
  product_variant_id: number | null;
  location_id: number;
  batch_id: number | null;
  adjustment_type: AdjustmentType;
  quantity_before: number;
  quantity_after: number;
  quantity_change: number;
  reason_code: string | null;
  description: string | null;
  approved_by_user_id: number | null;
  created_by_user_id: number | null;
  approved_at: string | null;
  created_at: string;
  // Relations
  products?: { id: number; name: string; sku: string | null } | null;
  product_variants?: { id: number; sku: string; name: string | null } | null;
  inventory_locations?: { id: number; name: string; store_id?: number | null } | null;
}

export interface StockTransfer {
  id: string;
  /** Web-style transfer number (e.g. "TRF-20260625-0001"). Falls back to id when absent. */
  transfer_number?: string;
  origin_location_id: string;
  origin_location_name: string;
  destination_location_id: string;
  destination_location_name: string;
  product_count: number;
  /** Date the transfer was created (ISO). */
  transfer_date?: string;
  /** Expected delivery date (ISO). */
  expected_date?: string;
  /** Count of distinct items (sometimes richer than product_count). */
  items_count?: number;
  state: 'pending' | 'in_transit' | 'completed' | 'cancelled';
  notes?: string | null;
  created_at: string;
}

export type MovementType =
  | 'stock_in'
  | 'stock_out'
  | 'transfer'
  | 'adjustment'
  | 'sale'
  | 'return'
  | 'damage'
  | 'expiration';

export interface StockMovement {
  id: number;
  product_id: number;
  product_name: string;
  movement_type: MovementType;
  quantity: number;
  location_id: number | null;
  location_name: string | null;
  store_id: number | null;
  store_name: string | null;
  reference: string | null;
  notes: string | null;
  user_id: number | null;
  user_name: string | null;
  source_module: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  code?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  tax_id?: string;
  payment_terms?: string;
  currency?: string;
  lead_time_days?: number | null;
  notes?: string;
  address?: string;
  state: SupplierState;
  created_at: string;
}

export interface Location {
  id: string;
  name: string;
  code?: string;
  type: LocationType;
  address?: string;
  is_active: boolean;
}

export type PurchaseOrderStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface PurchaseOrderItem {
  id: number;
  product_id: number;
  product_variant_id?: number | null;
  quantity_ordered: number;
  quantity_received?: number;
  unit_price: number;
  total_price?: number;
  product_name?: string;
  products?: { id: number; name: string; sku?: string | null };
  product?: { id: number; name: string; sku?: string | null };
}

export interface PurchaseOrder {
  id: number;
  order_number?: string;
  supplier_id: number;
  location_id: number;
  status: PurchaseOrderStatus;
  subtotal_amount?: number;
  tax_amount?: number;
  total_amount?: number;
  shipping_cost?: number;
  shipping_method?: string;
  payment_terms?: string;
  notes?: string;
  internal_notes?: string;
  created_at: string;
  suppliers?: { id: number; name: string };
  inventory_locations?: { id: number; name: string };
  purchase_order_items?: PurchaseOrderItem[];
}

export interface CreatePurchaseOrderItemDto {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  unit_price: number;
  tax_rate?: number;
  notes?: string;
}

/**
 * CP-PURCHASE-TRANSPARENCY A.10 — NO declara `status`, y no debe volver.
 *
 * El backend descarta cualquier `status` del cuerpo de creación y escribe
 * `draft` de oficio, así que declararlo aquí sólo servía para que la pantalla
 * creyera haber creado una orden aprobada que en la base era un borrador.
 * `approved` se alcanza únicamente con `InventoryService.approvePurchaseOrder`.
 * Además, cuando el backend retire el campo de su DTO, `forbidNonWhitelisted`
 * convertiría este envío en un 400 en cada creación.
 */
export interface CreatePurchaseOrderDto {
  supplier_id: number;
  location_id: number;
  order_date?: string;
  expected_date?: string;
  subtotal_amount?: number;
  tax_amount?: number;
  total_amount?: number;
  discount_amount?: number;
  shipping_cost?: number;
  shipping_method?: string;
  payment_terms?: string;
  notes?: string;
  internal_notes?: string;
  items: CreatePurchaseOrderItemDto[];
}

export interface ReceivePurchaseOrderItemDto {
  id: number;
  quantity_received: number;
}

export interface InventoryStats {
  totalProducts: number;
  lowStock: number;
  outOfStock: number;
  totalValue: number;
  totalLocations: number;
}

export type AdjustmentType = 'damage' | 'loss' | 'theft' | 'expiration' | 'count_variance' | 'manual_correction';
export type AdjustmentState = 'pending' | 'applied';
export type TransferState = 'pending' | 'in_transit' | 'completed' | 'cancelled';
/**
 * Alineado con el enum del backend `location_type_enum`
 * (apps/backend/prisma/schema.prisma). Cualquier desajuste causa 400 al
 * hacer POST /locations porque el backend valida con @IsEnum.
 */
export type LocationType =
  | 'warehouse'
  | 'store'
  | 'production_area'
  | 'receiving_area'
  | 'shipping_area'
  | 'quarantine'
  | 'damaged_goods';

/**
 * Ciclo de vida del proveedor, espejo de `supplier_state_enum` en Prisma.
 *
 * - `active`: usable en flujos nuevos (OC, remisiones, rutas).
 * - `inactive`: visible en el listado pero no seleccionable.
 * - `archived`: lo que produce "Eliminar". Oculto de listados y selectores;
 *   su historia contable queda intacta.
 */
export type SupplierState = 'active' | 'inactive' | 'archived';

/** Estados asignables: archivar va por el flujo de eliminar. */
export type SupplierAssignableState = Exclude<SupplierState, 'archived'>;

export const SUPPLIER_STATE_LABELS: Record<SupplierState, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
  archived: 'Archivado',
};

/**
 * Alias legacy — solo para `inventory_locations`, cuyo contrato sigue siendo
 * `is_active: boolean`. NO usar para proveedores: usa `SupplierState`.
 */
export type LocationState = 'active' | 'inactive';

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  damage: 'Daño',
  loss: 'Pérdida',
  theft: 'Robo',
  expiration: 'Vencido',
  count_variance: 'Conteo',
  manual_correction: 'Corrección',
};

export const ADJUSTMENT_STATE_LABELS: Record<AdjustmentState, string> = {
  pending: 'Pendiente',
  applied: 'Aplicado',
};

export const TRANSFER_STATE_LABELS: Record<TransferState, string> = {
  pending: 'Pendiente',
  in_transit: 'En Tránsito',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  stock_in: 'Entrada',
  stock_out: 'Salida',
  transfer: 'Transferencia',
  adjustment: 'Ajuste',
  sale: 'Venta',
  return: 'Devolución',
  damage: 'Daño',
  expiration: 'Vencido',
};

export const MOVEMENT_INBOUND_TYPES: ReadonlySet<MovementType> = new Set<MovementType>([
  'stock_in',
  'return',
]);

export const MOVEMENT_OUTBOUND_TYPES: ReadonlySet<MovementType> = new Set<MovementType>([
  'stock_out',
  'sale',
  'damage',
  'expiration',
]);

/**
 * Labels para `LocationType`. Tipo es `Record<string, string>` (no
 * `Record<LocationType, string>`) para tolerar valores legacy
 * (`virtual`, `transit`) que pueden existir en bases de datos antiguas
 * antes del alineamiento con `location_type_enum` del backend.
 * Cualquier valor desconocido cae al raw string vía `?? item.type`.
 */
export const LOCATION_TYPE_LABELS: Record<string, string> = {
  warehouse: 'Bodega',
  store: 'Tienda',
  production_area: 'Área de Producción',
  receiving_area: 'Área de Recepción',
  shipping_area: 'Área de Despacho',
  quarantine: 'Cuarentena',
  damaged_goods: 'Mercancía Dañada',
  // Backward-compat para data legacy en DBs previas al enum alignment
  virtual: 'Virtual',
  transit: 'En Tránsito',
};

export interface ConsolidatedStock {
  product_id: number;
  totalAvailable: number;
  totalReserved: number;
  totalOnHand: number;
  stockByLocation: LocationStock[];
  product?: { name: string; sku?: string };
}

export interface LocationStock {
  locationId: number;
  locationName: string;
  available: number;
  reserved: number;
  onHand: number;
  type: string;
  lastUpdated: string;
}

export interface StockAlert {
  product_id: number;
  product_name: string;
  location_id: number;
  location_name: string;
  current_stock: number;
  reorder_point: number;
  status: 'low_stock' | 'out_of_stock' | 'optimal';
}

export interface SourcingSuggestion {
  product_id: number;
  main_location: { id: number; name: string; available: number } | null;
  other_locations: { id: number; name: string; available: number }[];
  suggestion: 'available' | 'transfer' | 'purchase';
  requested_quantity: number;
}

export type PurchaseOrderMode = 'draft' | 'create' | 'create-receive';
